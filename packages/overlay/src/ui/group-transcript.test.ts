import { beforeEach, describe, expect, test } from 'bun:test';
import type { ToolStatus, TranscriptEntry } from '@iris/shared';
import { groupTranscript, isQuietRow, isToolRunLive } from './task-chat.transcript';

// A run of consecutive tool calls collapses to one row that shows its newest
// call, and the rest of the run hides behind it. The failure modes are quiet
// ones — a run that keeps growing past a piece of prose, a file card swallowed
// into a run, an errored call buried where nobody looks — so the boundaries of
// "what counts as one run" are pinned here rather than left to the eye.

// Ids are positional (`t1`, `a3`) so a row's key can be asserted directly — the
// key is load-bearing, since it is what keeps an expanded run from remounting.
let seq = 0;
beforeEach(() => {
  seq = 0;
});

function tool(name: string, input: string, status: ToolStatus = 'ok'): TranscriptEntry {
  return {
    id: `t${++seq}`,
    role: 'tool',
    at: seq,
    toolName: name,
    toolInput: input,
    toolStatus: status,
  };
}
function say(text: string): TranscriptEntry {
  return { id: `a${++seq}`, role: 'assistant', at: seq, text };
}

/** The shape a row assertion cares about: its kind and what it holds. */
function shape(rows: ReturnType<typeof groupTranscript>) {
  return rows.map((r) =>
    r.kind === 'tools'
      ? { kind: r.kind, key: r.key, tools: r.entries.map((e) => e.toolInput) }
      : { kind: r.kind, key: r.key, role: r.entry.role },
  );
}

describe('groupTranscript', () => {
  test('consecutive tool calls become one row, newest last', () => {
    const rows = groupTranscript([tool('Bash', 'ls'), tool('Read', 'a.tsx'), tool('Bash', 'grep')]);
    expect(rows).toHaveLength(1);
    expect(shape(rows)[0]).toEqual({ kind: 'tools', key: 't1', tools: ['ls', 'a.tsx', 'grep'] });
  });

  test('the row is keyed by where the run started, so it survives growing', () => {
    const run = [tool('Bash', 'ls'), tool('Bash', 'pwd')];
    expect(groupTranscript(run)[0]?.key).toBe(groupTranscript([run[0] as TranscriptEntry])[0]?.key);
  });

  test('prose ends a run and a later call starts a fresh one', () => {
    const rows = groupTranscript([
      tool('Bash', 'ls'),
      tool('Read', 'a.tsx'),
      say('Found it.'),
      tool('Bash', 'grep'),
    ]);
    expect(shape(rows)).toEqual([
      { kind: 'tools', key: 't1', tools: ['ls', 'a.tsx'] },
      { kind: 'entry', key: 'a3', role: 'assistant' },
      { kind: 'tools', key: 't4', tools: ['grep'] },
    ]);
  });

  test('a lone tool call is a run of one — nothing to expand', () => {
    const rows = groupTranscript([say('One moment.'), tool('Bash', 'ls')]);
    expect(rows[1]).toMatchObject({ kind: 'tools' });
    expect(rows[1]?.kind === 'tools' && rows[1].entries).toHaveLength(1);
  });

  test('an errored call stays in the run it belongs to', () => {
    const rows = groupTranscript([
      tool('Bash', 'ls'),
      tool('Bash', 'cat missing', 'error'),
      tool('Read', 'a.tsx'),
    ]);
    expect(rows).toHaveLength(1);
    const run = rows[0]?.kind === 'tools' ? rows[0].entries : [];
    expect(run.filter((e) => e.toolStatus === 'error')).toHaveLength(1);
  });

  // The card is the artifact of the turn; a run must never eat one, and the
  // entries either side of it are two runs rather than one.
  test('a file edit is its own row and splits the run', () => {
    const edit: TranscriptEntry = {
      id: 'e9',
      role: 'tool',
      at: 9,
      toolName: 'Edit',
      toolInput: 'src/app.tsx',
      toolStatus: 'ok',
    };
    expect(shape(groupTranscript([tool('Bash', 'ls'), edit, tool('Bash', 'pwd')]))).toEqual([
      { kind: 'tools', key: 't1', tools: ['ls'] },
      { kind: 'entry', key: 'e9', role: 'tool' },
      { kind: 'tools', key: 't2', tools: ['pwd'] },
    ]);
  });

  test('thinking and the closing result keep their own rows', () => {
    const rows = groupTranscript([
      { id: 'k1', role: 'thinking', at: 1, text: 'hm' },
      tool('Bash', 'ls'),
      { id: 'r1', role: 'result', at: 3, text: 'Done' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['entry', 'tools', 'entry']);
    expect(rows.every(isQuietRow)).toBe(true);
  });
});

describe('isToolRunLive', () => {
  test('a run is live until its last outstanding call lands', () => {
    // Parallel calls finish out of order, so the newest one being done says
    // nothing about the run.
    const rows = groupTranscript([tool('Bash', 'ls', 'running'), tool('Read', 'a.tsx', 'ok')]);
    expect(isToolRunLive(rows[0])).toBe(true);
  });

  test('a finished run is not live', () => {
    expect(isToolRunLive(groupTranscript([tool('Bash', 'ls'), tool('Bash', 'pwd')])[0])).toBe(
      false,
    );
  });

  test('nothing but a run of tool calls can be live', () => {
    expect(isToolRunLive(groupTranscript([say('hi')])[0])).toBe(false);
    expect(isToolRunLive(undefined)).toBe(false);
  });
});
