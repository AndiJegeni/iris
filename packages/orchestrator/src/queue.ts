import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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
  /**
   * Resolves when the task's worktree is ready to be edited, or undefined when
   * it already is (tasks on main, and every follow-up turn).
   *
   * A task is enqueued the instant its worktree is *named*, so the row appears
   * while the clone is still running. This is what holds the agent back until
   * the files it is about to edit actually exist — and a rejection here surfaces
   * as a failed row rather than an HTTP error nobody is still listening for.
   */
  gate?: Promise<void>;
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
 * State lives in memory and, when a state directory is given, mirrors to one
 * JSON file per task — so a restarted daemon reloads its history instead of
 * presenting an empty drawer over worktrees that plainly exist. Anything that
 * was mid-run when the daemon died reloads as `failed` ("interrupted"): the
 * row's Retry button and the chat's follow-up path both already know what to
 * do with a failed task, so an interrupted one needs no machinery of its own.
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
    /** Directory for per-task JSON files; omit (non-git repos) to stay memory-only. */
    private readonly stateDir?: string,
  ) {
    if (stateDir && !existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  }

  /**
   * Reload persisted tasks. `runnerFor` re-binds each task's backend to a live
   * runner — the one field a JSON file can't carry.
   *
   * Call once at boot, before the server accepts connections, so the hello
   * frame already carries the history.
   */
  load(runnerFor: (backend: Backend) => AgentRunner | null): void {
    if (!this.stateDir) return;
    let files: string[];
    try {
      files = readdirSync(this.stateDir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(this.stateDir, file), 'utf8')) as {
          task: Task;
          transcript: TranscriptEntry[];
          request: Omit<RunRequest, 'signal'>;
          sessionId?: string;
        };
        const task = { ...raw.task };
        if (isRunnable(task.status)) {
          task.status = 'failed';
          task.message = 'interrupted — the daemon restarted mid-run';
          task.updatedAt = Date.now();
        }
        const runner =
          runnerFor(task.backend) ??
          // Backend gone (key removed, CLI uninstalled): the history is still
          // worth showing, and retry/follow-up will fail with an honest error.
          async function* unavailable(): AsyncGenerator<
            { kind: 'error'; message: string },
            void,
            unknown
          > {
            yield { kind: 'error', message: `backend "${task.backend}" is not available` };
          };
        const entry: QueueEntry = {
          task,
          request: raw.request,
          runner: runner as AgentRunner,
          abort: new AbortController(),
          ...(raw.sessionId ? { sessionId: raw.sessionId } : {}),
        };
        this.byId.set(task.id, entry);
        this.transcripts.set(task.id, raw.transcript ?? []);
        if (isRunnable(raw.task.status)) this.persist(entry); // record the demotion
      } catch (err) {
        process.stderr.write(`[iris] could not load task ${file}: ${String(err)}\n`);
      }
    }
    if (this.byId.size > 0) {
      process.stdout.write(`[iris] restored ${this.byId.size} task(s) from a previous run\n`);
    }
  }

  /** Mirror one entry to disk. Atomic (tmp+rename) so a crash can't half-write. */
  private persist(entry: QueueEntry): void {
    if (!this.stateDir) return;
    try {
      const file = join(this.stateDir, `${entry.task.id}.json`);
      const tmp = `${file}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({
          task: entry.task,
          transcript: this.transcripts.get(entry.task.id) ?? [],
          request: entry.request,
          ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
        }),
      );
      renameSync(tmp, file);
    } catch (err) {
      process.stderr.write(`[iris] could not persist task: ${String(err)}\n`);
    }
  }

  private unpersist(taskId: string): void {
    if (!this.stateDir) return;
    rmSync(join(this.stateDir, `${taskId}.json`), { force: true });
  }

  /**
   * Archive: drop a finished task — row, transcript, and file. This is the
   * server half of the drawer's Archive; without it, persistence would turn
   * the drawer into an append-only graveyard that re-fills at every boot.
   */
  archive(taskId: string): { ok: true } | { ok: false; error: string } {
    const entry = this.byId.get(taskId);
    if (entry && isRunnable(entry.task.status)) {
      return { ok: false, error: 'task is still running' };
    }
    this.byId.delete(taskId);
    this.transcripts.delete(taskId);
    this.unpersist(taskId);
    this.bus.broadcast({ type: 'task:removed', id: taskId });
    return { ok: true }; // idempotent: archiving the already-gone succeeds
  }

  /**
   * Drop every task belonging to a worktree. Called when the worktree is
   * discarded — records that outlive their worktree would come back at the
   * next boot as rows whose every button points at deleted files.
   */
  removeBySlug(slug: string): void {
    for (const [id, entry] of this.byId) {
      if (entry.task.worktreeSlug !== slug) continue;
      entry.abort.abort();
      this.byId.delete(id);
      this.transcripts.delete(id);
      this.unpersist(id);
      this.bus.broadcast({ type: 'task:removed', id });
    }
    const q = this.waiting.get(slug);
    if (q) this.waiting.delete(slug);
  }

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
    gate?: Promise<void>,
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
      ...(gate ? { gate } : {}),
    };
    this.byId.set(task.id, entry);
    this.persist(entry);

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
    const owner = this.byId.get(taskId);
    if (owner) this.persist(owner);
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
        // It just left byId, so nothing would ever archive it — without this
        // the file resurrects a ghost row at the next boot.
        this.unpersist(taskId);
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

    const req: RunRequest = { ...next.request, signal: next.abort.signal };
    try {
      // The worktree may still be cloning. Stay 'queued' until it lands, so the
      // row reads as waiting rather than claiming an agent is already working;
      // a clone failure falls into the catch below and fails the task properly.
      if (next.gate) await next.gate;
      this.updateStatus(next, 'running');

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
            // The session id is what lets a follow-up resume after a restart,
            // so it has to reach disk the moment we learn it.
            this.persist(next);
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
    this.persist(entry);
    this.bus.broadcast({ type: 'task:updated', task: entry.task });
  }
}
