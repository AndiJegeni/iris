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
  type AttachedImage,
  type Backend,
  MODELS,
  type PendingQuestion,
  type ReasoningEffort,
  type Task,
  type TaskStatus,
  type TranscriptEntry,
  mergeTranscriptEntry,
  nextUnanswered,
} from '@iris/shared';
import type { AgentRunner, AnswerChannel, RunRequest } from './agents/types';
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
  /**
   * The live run's inbound channel. Recreated per run (see pump) because it is
   * bound to one agent process — the entry outlives many.
   */
  answers: AnswerChannel;
};

/** Result of a follow-up message attempt. */
export type ContinueResult = { ok: true; task: Task } | { ok: false; error: string };

/**
 * A task with a live run behind it — one that owns a worktree slot and cannot
 * be archived, retried, or reloaded as-is.
 *
 * `awaiting-input` belongs here even though nothing is executing: its agent
 * process is up, holding a turn open on a promise, and the worktree it is
 * halfway through editing is not free for the next task. It is the state's
 * whole point that it is *not* finished.
 */
function isRunnable(status: TaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'editing' ||
    status === 'awaiting-input'
  );
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
   * Daemon-wide "Bypass permissions" (yolo). The runtime copy: seeded from the
   * repo's saved config at startup and rewritten there on every toggle (see
   * server.ts), and read at spawn time in `pump` so flipping it applies to the
   * next run.
   */
  private bypass = false;

  /** Current bypass state, for `/health` to report to the overlay. */
  get bypassEnabled(): boolean {
    return this.bypass;
  }

  setBypass(enabled: boolean): void {
    this.bypass = enabled;
  }

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
    // 0700: task files can hold whatever the agent read (command output, file
    // contents) and the verbatim prompt, so keep the store owner-only rather
    // than the umask default that left it group/world-readable.
    if (stateDir && !existsSync(stateDir)) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
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
        // A pending question is dropped on the floor here, always. The promise
        // it was holding lived in an agent process that died with the daemon,
        // so a reloaded row still asking would be a question with nothing
        // behind it — the answer would go nowhere and the task would sit there
        // blocked forever. Its status is demoted below for the same reason.
        const { question: _dead, ...task } = { ...raw.task } as Task;
        if (isRunnable(raw.task.status)) {
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
          answers: { deliver: null },
          ...(raw.sessionId ? { sessionId: raw.sessionId } : {}),
        };
        this.byId.set(task.id, entry);
        this.transcripts.set(task.id, raw.transcript ?? []);
        // Record the demotion (and the dropped question) rather than leaving
        // the file claiming a state the daemon no longer believes.
        if (isRunnable(raw.task.status) || raw.task.question) this.persist(entry);
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
        // Owner-only: the transcript can contain secrets the agent read. Set on
        // the tmp file so the final rename never exposes a wider-mode window.
        { mode: 0o600 },
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
      answers: { deliver: null },
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
    opts: { model?: string; effort?: ReasoningEffort; images?: AttachedImage[] } = {},
  ): ContinueResult {
    const entry = this.byId.get(taskId);
    if (!entry) return { ok: false, error: 'task not found' };
    const images = opts.images ?? [];
    // A blocked run has already claimed this message: the agent is mid-turn
    // waiting on an answer, so starting a second turn would resume the same
    // session underneath the one that is still open. The composer is the only
    // way to reply in free text, so the reply has to land here. Images can't:
    // an answer resolves a promise inside the live agent process, and there is
    // no file-staging path into a turn that is already open — refusing beats
    // quietly delivering the words without the pictures they referred to.
    if (entry.task.status === 'awaiting-input') {
      if (images.length > 0) {
        return { ok: false, error: 'answer the pending question first — images go on a follow-up' };
      }
      return this.answer(entry, text);
    }
    if (isRunnable(entry.task.status)) return { ok: false, error: 'task is still running' };

    const model =
      opts.model && modelBackend(opts.model) === entry.task.backend ? opts.model : undefined;
    if (model) entry.task.model = model;

    // Snapshot the conversation before appending the new message: it's the
    // context for this turn, and a backend that can't resume its own session
    // replays it into the prompt.
    const priorTranscript = this.getTranscript(taskId);

    // Record the follow-up, then re-arm the entry to resume with the new prompt.
    // An image-only message still gets a visible transcript row — the images
    // themselves aren't in the transcript, so an empty text would read back as
    // a blank turn.
    const shown = text || `[${images.length} image${images.length === 1 ? '' : 's'} attached]`;
    this.appendEntry(taskId, { id: randomUUID(), role: 'user', at: Date.now(), text: shown });
    entry.abort = new AbortController();
    entry.request = {
      ...entry.request,
      prompt: text,
      // Always replaced, never inherited: the request still carries the
      // previous turn's images, and the backends stage whatever is present —
      // carrying them over would re-attach old screenshots to every follow-up.
      images,
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

  /**
   * Answer the question a blocked run is waiting on.
   *
   * The agent may ask up to four questions in one call and expects them all
   * back together, but a chat composer sends one message at a time — so answers
   * accumulate on the pending question and the run only resumes once the last
   * one lands. Until then the task stays `awaiting-input` and the UI moves on
   * to the next question.
   *
   * `text` is matched against the current question's option labels, so clicking
   * a choice and typing its wording are the same act; anything else is passed
   * through verbatim, which is the agent's always-available "Other".
   */
  private answer(entry: QueueEntry, text: string): ContinueResult {
    const pending = entry.task.question;
    if (!pending) return { ok: false, error: 'no question is pending' };
    const target = nextUnanswered(pending);
    if (!target) return { ok: false, error: 'no question is pending' };

    const trimmed = text.trim();
    const matched = target.options.find((o) => o.label.toLowerCase() === trimmed.toLowerCase());
    const answers = { ...pending.answers, [target.question]: matched?.label ?? trimmed };
    const next: PendingQuestion = { ...pending, answers };

    // The answer is part of the conversation, so it reads back as one — the
    // agent's question and the user's reply, in order, like any other turn.
    this.appendEntry(entry.task.id, {
      id: randomUUID(),
      role: 'user',
      at: Date.now(),
      text: matched?.label ?? trimmed,
    });

    if (nextUnanswered(next)) {
      this.setQuestion(entry, next);
      return { ok: true, task: entry.task };
    }

    const deliver = entry.answers.deliver;
    if (!deliver) {
      // The run went away between the question being asked and this answer —
      // there is no promise left to resolve, so say so rather than flipping the
      // row back to `running` over a process that no longer exists.
      this.updateStatus(entry, 'failed', 'the agent stopped before the answer reached it');
      return { ok: false, error: 'the run is no longer waiting for an answer' };
    }
    deliver({ id: pending.id, answers });
    this.updateStatus(entry, 'running');
    return { ok: true, task: entry.task };
  }

  /** Put a task into the blocked state, carrying the question it is blocked on. */
  private setQuestion(entry: QueueEntry, question: PendingQuestion): void {
    entry.task = {
      ...entry.task,
      status: 'awaiting-input',
      question,
      updatedAt: Date.now(),
    };
    this.persist(entry);
    this.bus.broadcast({ type: 'task:updated', task: entry.task });
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

    // A fresh channel per run: the old one pointed at a process that is gone,
    // and a stale `deliver` would write an answer into a closed pipe.
    next.answers = { deliver: null };
    const req: RunRequest = {
      ...next.request,
      answers: next.answers,
      signal: next.abort.signal,
      // Read live, not baked in at enqueue, so toggling Bypass affects the very
      // next run rather than only tasks submitted afterwards.
      bypass: this.bypass,
    };
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
          case 'question':
            // The run is now parked on a promise inside the agent process. The
            // worktree slot stays claimed on purpose: those files are half
            // edited, and letting the next task in would have it working over
            // the top of a turn that is still open.
            this.setQuestion(next, { id: ev.id, questions: ev.questions, answers: {} });
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
      if (next.task.status === 'awaiting-input') {
        // Ending with the question still open is not "done" — whatever it asked
        // about never got decided. Cancelled if the user did it; otherwise the
        // agent (or its process) went away mid-question, and the row has to say
        // so rather than sitting there asking on its behalf.
        if (next.abort.signal.aborted) this.updateStatus(next, 'cancelled');
        else this.updateStatus(next, 'failed', 'the agent stopped while waiting for your answer');
      } else if (next.task.status === 'running' || next.task.status === 'editing') {
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
    // The invariant every other call-site relies on: a task carries a question
    // exactly while it is `awaiting-input`. Leaving one attached through a
    // status change is how a cancelled or finished row ends up still asking.
    const { question: _resolved, ...task } = entry.task;
    entry.task = {
      ...task,
      status,
      updatedAt: Date.now(),
      ...(message !== undefined ? { message } : {}),
    };
    this.persist(entry);
    this.bus.broadcast({ type: 'task:updated', task: entry.task });
  }
}
