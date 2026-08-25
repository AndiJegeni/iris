import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentQuestion, Annotation, AttachedImage } from '@iris/shared';
import type { AgentRunner, RunRequest } from './agents/types';
import { EventBus } from './events';
import { TaskQueue } from './queue';

const dirs: string[] = [];
function stateDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'iris-queue-img-test-'));
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

const IMG: AttachedImage = { name: 'after.png', mediaType: 'image/png', dataBase64: 'aGk=' };

/** A runner that records every request it is handed, then finishes at once. */
function recordingRunner(): { runner: AgentRunner; seen: RunRequest[] } {
  const seen: RunRequest[] = [];
  const runner: AgentRunner = async function* (req) {
    seen.push(req);
    yield { kind: 'session', sessionId: 'sess-1' };
    yield { kind: 'done', summary: 'done' };
  };
  return { runner, seen };
}

async function settle(): Promise<void> {
  // The pump is fire-and-forget; a couple of macrotasks lets it drain.
  await new Promise((r) => setTimeout(r, 50));
}

test('continue() puts the follow-up images on the resumed run', async () => {
  const { runner, seen } = recordingRunner();
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const task = q.enqueue(
    annotation,
    runner,
    { prompt: annotation.prompt, images: [] } as never,
    'main',
  );
  await settle();

  const result = q.continue(task.id, 'match this mock', { images: [IMG] });
  expect(result.ok).toBe(true);
  await settle();

  expect(seen).toHaveLength(2);
  expect(seen[1]?.resumeSessionId).toBe('sess-1');
  expect(seen[1]?.images).toEqual([IMG]);
});

test('a later follow-up without images does not inherit the previous ones', async () => {
  const { runner, seen } = recordingRunner();
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const task = q.enqueue(
    annotation,
    runner,
    { prompt: annotation.prompt, images: [] } as never,
    'main',
  );
  await settle();

  q.continue(task.id, 'match this mock', { images: [IMG] });
  await settle();
  q.continue(task.id, 'now tweak the copy', {});
  await settle();

  expect(seen).toHaveLength(3);
  expect(seen[2]?.images).toEqual([]);
});

test('an image-only follow-up still records a visible transcript turn', async () => {
  const { runner } = recordingRunner();
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const task = q.enqueue(
    annotation,
    runner,
    { prompt: annotation.prompt, images: [] } as never,
    'main',
  );
  await settle();

  const result = q.continue(task.id, '', { images: [IMG] });
  expect(result.ok).toBe(true);
  await settle();

  const users = q.getTranscript(task.id).filter((e) => e.role === 'user');
  expect(users[users.length - 1]?.text).toBe('[1 image attached]');
});

test('images are refused while the task is awaiting an answer', async () => {
  const question: AgentQuestion[] = [{ question: 'Which shade?', header: 'Shade', options: [] }];
  const runner: AgentRunner = async function* (req) {
    yield { kind: 'question', id: 'tool-1', questions: question };
    await new Promise<void>((r) => {
      req.answers!.deliver = () => r();
    });
    yield { kind: 'done', summary: 'done' };
  };
  const q = new TaskQueue(new EventBus(), undefined, stateDir());
  const task = q.enqueue(
    annotation,
    runner,
    { prompt: annotation.prompt, images: [] } as never,
    'main',
  );
  await settle();

  const refused = q.continue(task.id, 'navy', { images: [IMG] });
  expect(refused.ok).toBe(false);
  // A plain-text answer still goes through afterwards.
  const answered = q.continue(task.id, 'navy', {});
  expect(answered.ok).toBe(true);
  await settle();
});
