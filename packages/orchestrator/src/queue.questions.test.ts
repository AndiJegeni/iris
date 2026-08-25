import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentQuestion, Annotation } from '@iris/shared';
import type { AgentRunner, QuestionAnswer } from './agents/types';
import { EventBus } from './events';
import { TaskQueue } from './queue';

const dirs: string[] = [];
function stateDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'iris-queue-q-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const annotation = {
  prompt: 'add auth',
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

const ONE: AgentQuestion[] = [
  {
    question: 'Which auth method?',
    header: 'Auth',
    options: [
      { label: 'OAuth', description: 'Delegate to a provider' },
      { label: 'Sessions', description: 'Cookies we own' },
    ],
  },
];

const TWO: AgentQuestion[] = [
  ...ONE,
  {
    question: 'Which database?',
    header: 'DB',
    options: [
      { label: 'Postgres', description: '' },
      { label: 'SQLite', description: '' },
    ],
  },
];

/**
 * A runner that asks, then reports whatever answer reaches it. `delivered` is
 * the assertion surface for the round trip the daemon can't otherwise prove
 * without a live agent.
 */
function askingRunner(questions: AgentQuestion[]): {
  runner: AgentRunner;
  delivered: QuestionAnswer[];
  finish: () => void;
} {
  const delivered: QuestionAnswer[] = [];
  let release: () => void = () => {};
  const runner: AgentRunner = async function* (req) {
    yield { kind: 'question', id: 'tool-1', questions };
    // Stand in for the agent process sitting on the pending promise.
    req.answers!.deliver = (answer) => {
      delivered.push(answer);
      release();
    };
    await new Promise<void>((r) => {
      release = r;
    });
    req.answers!.deliver = null;
    yield { kind: 'done', summary: 'done' };
  };
  return { runner, delivered, finish: () => release() };
}

async function settle(ms = 40): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

test('a question parks the task in awaiting-input, carrying what was asked', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, finish } = askingRunner(ONE);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();

  const parked = q.list().find((t) => t.id === task.id);
  expect(parked?.status).toBe('awaiting-input');
  expect(parked?.question?.questions[0]?.question).toBe('Which auth method?');
  expect(parked?.question?.answers).toEqual({});
  finish();
  await settle();
});

test('a follow-up message is routed to the pending question, not a new turn', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, delivered } = askingRunner(ONE);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();

  const res = q.continue(task.id, 'OAuth');
  expect(res.ok).toBe(true);
  await settle();

  expect(delivered).toEqual([{ id: 'tool-1', answers: { 'Which auth method?': 'OAuth' } }]);
  // Same run, not a second one: the task carries straight on to done.
  expect(q.list().find((t) => t.id === task.id)?.status).toBe('done');
  // The answer reads back as an ordinary turn in the conversation.
  expect(q.getTranscript(task.id).some((e) => e.role === 'user' && e.text === 'OAuth')).toBe(true);
});

test('free text that matches an option label is normalised to that label', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, delivered } = askingRunner(ONE);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();

  q.continue(task.id, '  oauth  ');
  await settle();
  expect(delivered[0]?.answers).toEqual({ 'Which auth method?': 'OAuth' });
});

test('free text that matches nothing is passed through verbatim', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, delivered } = askingRunner(ONE);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();

  q.continue(task.id, 'neither — use the existing SSO');
  await settle();
  expect(delivered[0]?.answers).toEqual({
    'Which auth method?': 'neither — use the existing SSO',
  });
});

test('a multi-question set stays parked until every question is answered', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, delivered } = askingRunner(TWO);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();

  q.continue(task.id, 'OAuth');
  await settle();
  const midway = q.list().find((t) => t.id === task.id);
  expect(midway?.status).toBe('awaiting-input');
  expect(midway?.question?.answers).toEqual({ 'Which auth method?': 'OAuth' });
  expect(delivered).toEqual([]);

  q.continue(task.id, 'Postgres');
  await settle();
  expect(delivered).toEqual([
    { id: 'tool-1', answers: { 'Which auth method?': 'OAuth', 'Which database?': 'Postgres' } },
  ]);
  expect(q.list().find((t) => t.id === task.id)?.status).toBe('done');
});

test('answering clears the question — a done row is not still asking', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner } = askingRunner(ONE);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();
  q.continue(task.id, 'OAuth');
  await settle();
  expect(q.list().find((t) => t.id === task.id)?.question).toBeUndefined();
});

test('a blocked task cannot be archived — its worktree is mid-edit', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, finish } = askingRunner(ONE);
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();

  expect(q.archive(task.id)).toEqual({ ok: false, error: 'task is still running' });
  finish();
  await settle();
});

test('cancelling while a question is up lands on cancelled, with no question left', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  // Tears down the way the real runner does: the abort kills the child, so the
  // generator returns without a done/error of its own.
  const runner: AgentRunner = async function* (req) {
    yield { kind: 'question', id: 'tool-1', questions: ONE };
    await new Promise<void>((r) => req.signal.addEventListener('abort', () => r(), { once: true }));
  };
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();
  expect(q.list().find((t) => t.id === task.id)?.status).toBe('awaiting-input');

  expect(q.cancel(task.id)).toBe(true);
  await settle();
  const done = q.list().find((t) => t.id === task.id);
  expect(done?.status).toBe('cancelled');
  expect(done?.question).toBeUndefined();
});

test('a blocked task holds its worktree slot — the next task waits', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const { runner, finish } = askingRunner(ONE);
  const first = q.enqueue(annotation, runner, { prompt: 'first' } as never, 'wt-1');
  let secondStarted = false;
  const secondRunner: AgentRunner = async function* () {
    secondStarted = true;
    yield { kind: 'done', summary: 'ok' };
  };
  const second = q.enqueue(annotation, secondRunner, { prompt: 'second' } as never, 'wt-1');
  await settle();

  expect(q.list().find((t) => t.id === first.id)?.status).toBe('awaiting-input');
  expect(secondStarted).toBe(false);
  expect(q.list().find((t) => t.id === second.id)?.status).toBe('queued');

  finish();
  await settle();
  expect(secondStarted).toBe(true);
});

test('a run that ends with its question open fails rather than reporting done', async () => {
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  // Asks and then exits, which is what a worker crashing mid-question looks
  // like from here. Nothing it asked about was decided, so "done" would be a lie.
  const runner: AgentRunner = async function* () {
    yield { kind: 'question', id: 'tool-1', questions: ONE };
  };
  const task = q.enqueue(annotation, runner, { prompt: 'x' } as never, 'main');
  await settle();
  const t = q.list().find((x) => x.id === task.id);
  expect(t?.status).toBe('failed');
  expect(t?.message).toContain('waiting for your answer');
  expect(t?.question).toBeUndefined();
});

test('a question does not survive a reload — the row comes back interrupted', () => {
  const dir = stateDir();
  writeFileSync(
    join(dir, 'blocked.json'),
    JSON.stringify({
      task: {
        id: 'blocked',
        worktreeSlug: 'main',
        backend: 'claude',
        prompt: 'p',
        source: null,
        status: 'awaiting-input',
        question: { id: 'tool-1', questions: ONE, answers: {} },
        createdAt: 1,
        updatedAt: 1,
      },
      transcript: [],
      request: { prompt: 'p' },
    }),
  );
  const q = new TaskQueue(new EventBus(), undefined, dir);
  q.load(() => async function* () {});
  const t = q.list().find((x) => x.id === 'blocked');
  // The promise it was waiting on died with the daemon, so neither the status
  // nor the question may claim otherwise.
  expect(t?.status).toBe('failed');
  expect(t?.message).toContain('interrupted');
  expect(t?.question).toBeUndefined();
});
