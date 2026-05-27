import { randomUUID } from 'node:crypto';
import type { Annotation, Task, TaskStatus } from '@localagents/shared';
import type { AgentRunner, RunRequest } from './agents/types';
import type { EventBus } from './events';

type QueueEntry = {
  task: Task;
  request: Omit<RunRequest, 'signal'>;
  runner: AgentRunner;
  abort: AbortController;
};

/**
 * Per-worktree FIFO task queue.
 *
 * Two queued tasks against the same worktree run strictly serially — the
 * second waits for the first to finish before starting. Tasks against
 * *different* worktrees run in parallel.
 *
 * State is in-memory; restart of the daemon drops the queue. v0 acceptable.
 */
export class TaskQueue {
  private waiting = new Map<string, QueueEntry[]>(); // by worktreeSlug
  private running = new Map<string, QueueEntry>(); // by worktreeSlug
  private byId = new Map<string, QueueEntry>();

  constructor(private readonly bus: EventBus) {}

  /** Snapshot every known task. Used to populate `hello` events. */
  list(): Task[] {
    const out: Task[] = [];
    for (const e of this.running.values()) out.push(e.task);
    for (const q of this.waiting.values()) for (const e of q) out.push(e.task);
    return out.sort((a, b) => a.createdAt - b.createdAt);
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
    void this.pump(worktreeSlug);
    return task;
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
          case 'done':
            this.updateStatus(next, 'done', ev.summary);
            break;
          case 'error':
            this.updateStatus(next, 'failed', ev.message);
            break;
        }
      }
      // Generator exited without explicit done/error.
      if (next.task.status === 'running' || next.task.status === 'editing') {
        this.updateStatus(next, 'done');
      }
    } catch (err) {
      this.updateStatus(next, 'failed', err instanceof Error ? err.message : String(err));
    } finally {
      this.running.delete(slug);
      this.byId.delete(next.task.id);
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
