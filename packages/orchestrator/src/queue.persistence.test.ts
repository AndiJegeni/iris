import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation } from '@iris/shared';
import type { AgentRunner } from './agents/types';
import { EventBus } from './events';
import { TaskQueue } from './queue';

const dirs: string[] = [];
function stateDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'iris-queue-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const annotation = {
  prompt: 'make the thing blue',
  source: null,
  selector: null,
  componentPath: [],
  nearbyText: null,
  confidence: 'low',
  worktreeMode: 'same',
  backend: 'claude',
  model: '',
  reasoningEffort: 'medium',
  images: [],
} as unknown as Annotation;

// A runner that succeeds immediately, leaving one transcript entry.
const okRunner: AgentRunner = async function* (req) {
  yield { kind: 'session', sessionId: 'sess-1' };
  yield {
    kind: 'entry',
    entry: { id: 'e1', role: 'assistant', at: Date.now(), text: `did: ${req.prompt}` },
  };
  yield { kind: 'done', summary: 'done' };
};

async function settle(): Promise<void> {
  // The pump is fire-and-forget; a couple of macrotasks lets it drain.
  await new Promise((r) => setTimeout(r, 50));
}

test('a finished task round-trips through disk', async () => {
  const dir = stateDir();
  const q1 = new TaskQueue(new EventBus(), undefined, dir);
  const task = q1.enqueue(annotation, okRunner, { prompt: annotation.prompt } as never, 'main');
  await settle();

  const q2 = new TaskQueue(new EventBus(), undefined, dir);
  q2.load(() => okRunner);
  const restored = q2.list().find((t) => t.id === task.id);
  expect(restored).toBeDefined();
  expect(restored?.status).toBe('done');
  const transcript = q2.getTranscript(task.id);
  // Both halves of the conversation survive: the prompt and the agent's reply.
  expect(transcript.some((e) => e.role === 'user' && e.text === 'make the thing blue')).toBe(true);
  expect(transcript.some((e) => e.text === 'did: make the thing blue')).toBe(true);
});

test('a task that was mid-run reloads as failed (interrupted)', () => {
  const dir = stateDir();
  writeFileSync(
    join(dir, 'dead1.json'),
    JSON.stringify({
      task: {
        id: 'dead1',
        worktreeSlug: 'main',
        backend: 'claude',
        prompt: 'p',
        source: null,
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
      },
      transcript: [{ id: 'u1', role: 'user', at: 1, text: 'p' }],
      request: { prompt: 'p' },
      sessionId: 'sess-9',
    }),
  );
  const q = new TaskQueue(new EventBus(), undefined, dir);
  q.load(() => okRunner);
  const t = q.list().find((x) => x.id === 'dead1');
  expect(t?.status).toBe('failed');
  expect(t?.message).toContain('interrupted');
  expect(q.getTranscript('dead1').length).toBe(1);
});

test('archive removes the row, the transcript, and the file', async () => {
  const dir = stateDir();
  const q = new TaskQueue(new EventBus(), undefined, dir);
  const task = q.enqueue(annotation, okRunner, { prompt: 'x' } as never, 'main');
  await settle();
  expect(readdirSync(dir).length).toBe(1);

  const res = q.archive(task.id);
  expect(res.ok).toBe(true);
  expect(q.list().length).toBe(0);
  expect(q.getTranscript(task.id).length).toBe(0);
  expect(readdirSync(dir).length).toBe(0);
  // idempotent
  expect(q.archive(task.id).ok).toBe(true);
});

test('archive refuses a running task', async () => {
  const dir = stateDir();
  const q = new TaskQueue(new EventBus(), undefined, dir);
  let release: () => void = () => {};
  const slowRunner: AgentRunner = async function* () {
    await new Promise<void>((r) => {
      release = r;
    });
    yield { kind: 'done', summary: 'done' };
  };
  const task = q.enqueue(annotation, slowRunner, { prompt: 'x' } as never, 'main');
  await new Promise((r) => setTimeout(r, 10));
  const res = q.archive(task.id);
  expect(res.ok).toBe(false);
  release();
  await settle();
});

test('removeBySlug drops every record for a discarded worktree', async () => {
  const dir = stateDir();
  const q = new TaskQueue(new EventBus(), undefined, dir);
  q.enqueue(annotation, okRunner, { prompt: 'a' } as never, 'wt-1');
  q.enqueue(annotation, okRunner, { prompt: 'b' } as never, 'wt-1');
  const keep = q.enqueue(annotation, okRunner, { prompt: 'c' } as never, 'main');
  await settle();
  expect(readdirSync(dir).length).toBe(3);

  q.removeBySlug('wt-1');
  expect(q.list().map((t) => t.id)).toEqual([keep.id]);
  expect(readdirSync(dir).length).toBe(1);
});
