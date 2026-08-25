import { expect, test } from 'bun:test';
import type { TranscriptEntry } from '@iris/shared';
import { buildFollowUpPrompt, buildPrompt } from './prompt';
import type { RunRequest } from './types';

function req(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: 'make it blue',
    source: null,
    selector: '',
    componentPath: [],
    text: null,
    images: [],
    cwd: '/tmp/worktree',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function entry(role: TranscriptEntry['role'], text: string, at = 0): TranscriptEntry {
  return { id: `${role}-${at}-${text.slice(0, 8)}`, role, at, text };
}

test('buildPrompt leads with captured context, then the request', () => {
  const p = buildPrompt(
    req({
      source: { file: 'src/App.tsx', line: 12, column: 4 },
      componentPath: ['App', 'Hero'],
      selector: '#hero',
      text: 'Get started',
    }),
  );
  expect(p).toContain('File: src/App.tsx:12:4');
  expect(p).toContain('Component path: <App/> › <Hero/>');
  expect(p).toContain('Selector: #hero');
  expect(p).toContain('Element text: "Get started"');
  expect(p.endsWith('User request:\nmake it blue')).toBe(true);
});

test('buildPrompt with no context carries the ask note and the request, no context block', () => {
  const p = buildPrompt(req());
  expect(p).not.toContain('Context (auto-captured');
  expect(p.endsWith('User request:\nmake it blue')).toBe(true);
});

test('every prompt tells the agent it may ask a clarifying question', () => {
  // The tool is wired up and blocks the run, but nothing else advertises it —
  // without this line the agent guesses at an ambiguous request instead.
  for (const p of [buildPrompt(req()), buildPrompt(req({ selector: '#hero' }))]) {
    expect(p).toContain('AskUserQuestion');
  }
});

test('follow-up with no replayable history falls back to a fresh prompt', () => {
  const r = req({
    priorTranscript: [entry('tool', 'ran a tool'), { id: 'x', role: 'assistant', at: 0 }],
  });
  expect(buildFollowUpPrompt(r)).toBe(buildPrompt(r));
});

test('follow-up replays only the user/assistant dialogue', () => {
  const p = buildFollowUpPrompt(
    req({
      prompt: 'now make it red',
      priorTranscript: [
        entry('user', 'make it blue'),
        entry('thinking', 'hmm, blue'),
        entry('tool', '$ grep blue'),
        entry('assistant', 'Done — it is blue now.'),
      ],
    }),
  );
  expect(p).toContain('User: make it blue');
  expect(p).toContain('Assistant: Done — it is blue now.');
  expect(p).not.toContain('hmm, blue');
  expect(p).not.toContain('grep blue');
  expect(p).toContain('Follow-up request:\nnow make it red');
});

test('a single oversized entry is clipped with an ellipsis', () => {
  const long = 'a'.repeat(5000);
  const p = buildFollowUpPrompt(req({ priorTranscript: [entry('assistant', long)] }));
  expect(p).toContain(`Assistant: ${'a'.repeat(2000)}…`);
  expect(p).not.toContain('a'.repeat(2001));
});

test('a long thread keeps the newest turns and marks the elision', () => {
  // 20 entries × ~2000 chars ≈ 40k — well past the 16k replay budget.
  const transcript: TranscriptEntry[] = [];
  for (let i = 0; i < 20; i++) {
    transcript.push(entry(i % 2 === 0 ? 'user' : 'assistant', `turn-${i} ${'x'.repeat(1990)}`, i));
  }
  const p = buildFollowUpPrompt(req({ priorTranscript: transcript }));
  expect(p).toContain('[Earlier turns omitted');
  expect(p).toContain('turn-19'); // newest survives
  expect(p).not.toContain('turn-0 '); // oldest dropped
  // The replayed history itself stays within the budget (the marker and the
  // follow-up scaffolding are small, fixed overhead).
  expect(p.length).toBeLessThan(17_000);
});

test('a short thread is replayed whole, with no elision marker', () => {
  const p = buildFollowUpPrompt(
    req({
      priorTranscript: [entry('user', 'make it blue'), entry('assistant', 'done')],
    }),
  );
  expect(p).not.toContain('[Earlier turns omitted');
  expect(p).toContain('User: make it blue');
  expect(p).toContain('Assistant: done');
});
