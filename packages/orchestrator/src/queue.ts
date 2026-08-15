import { randomUUID } from 'node:crypto';
import {
  type Annotation,
  type Backend,
  MODELS,
  type ReasoningEffort,
  type Task,
  type TaskStatus,
  type TranscriptEntry,
  mergeTranscriptEntry,
} from '@iris/shared';
import type { AgentRunner, RunRequest } from './agents/types';
import type { EventBus } from './events';

type QueueEntry = {
  task: Task;
  request: Omit<RunRequest, 'signal'>;
  runner: AgentRunner;
  abort: AbortController;
  /** Backend session id, captured on first run; replayed for follow-ups. */
  sessionId?: string;
};

/** Result of a follow-up message attempt. */
export type ContinueResult = { ok: true; task: Task } | { ok: false; error: string };

function isRunnable(status: TaskStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'editing';
}

/** Which runner a model value belongs to, or undefined if it's not in the catalog. */
function modelBackend(value: string): Backend | undefined {
  return MODELS.find((m) => m.value === value)?.backend;
}

/**
 * Per-worktree FIFO task queue.
 *
 * Two queued tasks against the same worktree run strictly serially — the
 * second waits for the first to finish before starting. Tasks against
 * *different* worktrees run in parallel.
 *
 * State is in-memory; restarting the daemon drops the queue.
 */
export class TaskQueue {
  private waiting = new Map<string, QueueEntry[]>(); // by worktreeSlug
  private running = new Map<string, QueueEntry>(); // by worktreeSlug
  private byId = new Map<string, QueueEntry>();
  /** Per-task structured conversation, retained after completion for follow-ups. */
  private transcripts = new Map<string, TranscriptEntry[]>();

  /**
   * @param onAuthResult Told, after each finished run, whether the backend's
   *   credential actually worked. A real call is the only trustworthy proof —
   *   the provider CLIs' cached login records outlive the sessions they
   *   describe (see auth-errors.ts).
   */
  constructor(
    private readonly bus: EventBus,
    private readonly onAuthResult?: (backend: Backend, ok: boolean) => void,
  ) {}

  /** The full structured transcript for a task (empty if unknown). */
  getTranscript(taskId: string): TranscriptEntry[] {
    return this.transcripts.get(taskId) ?? [];
  }

  /**
   * Snapshot every known task. Used to populate `hello` events.
   *
   * Reads `byId`, which holds finished tasks too — walking `running`/`waiting`
   * instead would drop everything already done, so a reconnecting client would
   * see its completed tasks vanish even though they're still resumable.
   */
  list(): Task[] {
    return [...this.byId.values()].map((e) => e.task).sort((a, b) => a.createdAt - b.createdAt);
  }

  enqueue(
    annotation: Annotation,
    runner: AgentRunner,
    request: Omit<RunRequest, 'signal'>,
    worktreeSlug: string,
  ): Task {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      worktreeSlug,
      backend: annotation.backend,
      // Carry the selected model value through for display (UI maps it to a label).
      ...(annotation.model ? { model: annotation.model } : {}),
      prompt: annotation.prompt,
      source: annotation.source,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    const entry: QueueEntry = {
      task,
      request,
      runner,
      abort: new AbortController(),
    };
    this.byId.set(task.id, entry);

    const q = this.waiting.get(worktreeSlug) ?? [];
    q.push(entry);
    this.waiting.set(worktreeSlug, q);

    this.bus.broadcast({ type: 'task:created', task });
    // Seed the transcript with the user's opening message (backend-agnostic).
    this.appendEntry(task.id, { id: randomUUID(), role: 'user', at: now, text: annotation.prompt });
    void this.pump(worktreeSlug);
    return task;
  }

  /**
   * Send a follow-up message to an existing task, resuming its backend session
   * so the agent keeps full context. Rejected while the task is still running.
   *
   * `opts` carries the chat composer's model/effort pickers, so a thread can
   * change either between turns. A model from a *different* backend is ignored:
   * the entry's runner and its resumable session both belong to the original
   * backend, so honouring the switch would resume a Claude session with codex.
   * (The composer only offers same-backend models — this is the guard.)
   */
  continue(
    taskId: string,
    text: string,
    opts: { model?: string; effort?: ReasoningEffort } = {},
  ): ContinueResult {
    const entry = this.byId.get(taskId);
    if (!entry) return { ok: false, error: 'task not found' };
    if (isRunnable(entry.task.status)) return { ok: false, error: 'task is still running' };

    const model =
      opts.model && modelBackend(opts.model) === entry.task.backend ? opts.model : undefined;
    if (model) entry.task.model = model;

    // Snapshot the conversation before appending the new message: it's the
    // context for this turn, and a backend that can't resume its own session
    // replays it into the prompt.
    const priorTranscript = this.getTranscript(taskId);

    // Record the follow-up, then re-arm the entry to resume with the new prompt.
    this.appendEntry(taskId, { id: randomUUID(), role: 'user', at: Date.now(), text });
    entry.abort = new AbortController();
    entry.request = {
      ...entry.request,
      prompt: text,
      ...(entry.sessionId ? { resumeSessionId: entry.sessionId } : {}),
      ...(priorTranscript.length > 0 ? { priorTranscript } : {}),
      ...(model ? { model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
    };
    this.updateStatus(entry, 'queued');

    const slug = entry.task.worktreeSlug;
    const q = this.waiting.get(slug) ?? [];
    q.push(entry);
    this.waiting.set(slug, q);
    void this.pump(slug);
    return { ok: true, task: entry.task };
  }

  /** Append a transcript entry, or update one in place when its id already exists. */
  private appendEntry(taskId: string, entry: TranscriptEntry): void {
    const { entries, merged } = mergeTranscriptEntry(this.transcripts.get(taskId) ?? [], entry);
    this.transcripts.set(taskId, entries);
    this.bus.broadcast({ type: 'task:entry', id: taskId, entry: merged });
  }

  cancel(taskId: string): boolean {
    const entry = this.byId.get(taskId);
    if (!entry) return false;
    entry.abort.abort();
    // If still in waiting queue, remove it and mark cancelled now.
    const slug = entry.task.worktreeSlug;
    const q = this.waiting.get(slug);
    if (q) {
      const idx = q.indexOf(entry);
      if (idx >= 0) {
        q.splice(idx, 1);
        this.updateStatus(entry, 'cancelled');
        this.byId.delete(taskId);
      }
    }
    return true;
  }

  private async pump(slug: string): Promise<void> {
    if (this.running.has(slug)) return;
    const q = this.waiting.get(slug);
    if (!q || q.length === 0) return;
    const next = q.shift()!;
    this.running.set(slug, next);

    this.updateStatus(next, 'running');

    const req: RunRequest = { ...next.request, signal: next.abort.signal };
    try {
      for await (const ev of next.runner(req)) {
        if (next.abort.signal.aborted) break;
        switch (ev.kind) {
          case 'status':
            this.updateStatus(next, ev.status);
            break;
          case 'edit':
            this.updateStatus(
              next,
              'editing',
              ev.description ? `${ev.description}: ${ev.file}` : `editing: ${ev.file}`,
            );
            break;
          case 'log':
            this.bus.broadcast({ type: 'task:log', id: next.task.id, line: ev.line });
            break;
          case 'entry':
            this.appendEntry(next.task.id, ev.entry);
            break;
          case 'session':
            next.sessionId = ev.sessionId;
            break;
          case 'done':
            this.updateStatus(next, 'done', ev.summary);
            this.onAuthResult?.(next.task.backend, true);
            break;
          case 'needs-auth':
            // Put the reason in the chat too — a bare "Failed" row with a 401
            // behind it is exactly what left users stuck.
            this.appendEntry(next.task.id, {
              id: randomUUID(),
              role: 'error',
              at: Date.now(),
              text: ev.message,
            });
            this.updateStatus(next, 'failed', ev.message);
            // Flag the provider first, so a client refetching /auth/status on
            // the broadcast below sees the expired state.
            this.onAuthResult?.(next.task.backend, false);
            this.bus.broadcast({ type: 'needs-auth', backend: next.task.backend });
            break;
          case 'error':
            this.updateStatus(next, 'failed', ev.message);
            break;
        }
      }
      // Generator exited without explicit done/error.
      if (next.task.status === 'running' || next.task.status === 'editing') {
        this.updateStatus(next, next.abort.signal.aborted ? 'cancelled' : 'done');
      }
    } catch (err) {
      if (next.abort.signal.aborted) {
        this.updateStatus(next, 'cancelled');
      } else {
        this.updateStatus(next, 'failed', err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.running.delete(slug);
      // Keep the entry in `byId` (and its transcript) after completion so a
      // follow-up message can resume the session. Dropped only on cancel.
      void this.pump(slug);
    }
  }

  private updateStatus(entry: QueueEntry, status: TaskStatus, message?: string): void {
    entry.task = {
      ...entry.task,
      status,
      updatedAt: Date.now(),
      ...(message !== undefined ? { message } : {}),
    };
    this.bus.broadcast({ type: 'task:updated', task: entry.task });
  }
}
