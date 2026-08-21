import { describe, expect, test } from 'bun:test';
import type { VNode } from 'preact';
import { renderInline } from './task-chat.transcript';

// The transcript honours exactly two markdown forms — `code` and **bold** —
// and must leave everything else, including half-closed markers and lone
// asterisks, byte-for-byte alone. These tests pin that boundary by inspecting
// the vnodes renderInline returns, because the failure mode on both sides is
// silent: eat too little and the user reads literal markers, eat too much and
// prose loses characters.

/** Collapse renderInline's output into comparable pieces, dropping the empty
 *  strings String.split leaves around leading/trailing matches. */
type Piece = string | { tag: string; text: string };
function pieces(out: unknown): Piece[] {
  const flat = (Array.isArray(out) ? out.flat() : [out]).filter((p) => p !== '');
  return flat.map((p) => {
    if (typeof p === 'string') return p;
    const v = p as VNode<{ children: string }>;
    return { tag: v.type as string, text: v.props.children };
  });
}

describe('renderInline', () => {
  test('plain text passes through as the original string', () => {
    expect(renderInline('Fixed the mismatch in three files.')).toBe(
      'Fixed the mismatch in three files.',
    );
  });

  test('**bold** becomes a strong node', () => {
    expect(pieces(renderInline('**What was wrong:** the asset'))).toEqual([
      { tag: 'strong', text: 'What was wrong:' },
      ' the asset',
    ]);
  });

  test('backticks become a code node', () => {
    expect(pieces(renderInline('see `app/page.tsx` for details'))).toEqual([
      'see ',
      { tag: 'code', text: 'app/page.tsx' },
      ' for details',
    ]);
  });

  test('bold markers inside a code span stay literal', () => {
    expect(pieces(renderInline('run `echo **not bold**` now'))).toEqual([
      'run ',
      { tag: 'code', text: 'echo **not bold**' },
      ' now',
    ]);
  });

  test('unclosed markers render literally', () => {
    expect(renderInline('**no closing marker here')).toBe('**no closing marker here');
    expect(renderInline('a stray ` backtick')).toBe('a stray ` backtick');
  });

  test('single asterisks are untouched', () => {
    expect(renderInline('2 * 3 * 4 = 24')).toBe('2 * 3 * 4 = 24');
    expect(renderInline('*emphasis* stays literal')).toBe('*emphasis* stays literal');
  });

  test('a stray backtick after a closed pair stays literal', () => {
    expect(pieces(renderInline('`a` and ` b'))).toEqual([{ tag: 'code', text: 'a' }, ' and ` b']);
  });

  test('the real transcript line renders bold then code', () => {
    const out = pieces(
      renderInline('**What was wrong:** both plates share `.about-pillar img` rules'),
    );
    expect(out).toEqual([
      { tag: 'strong', text: 'What was wrong:' },
      ' both plates share ',
      { tag: 'code', text: '.about-pillar img' },
      ' rules',
    ]);
  });

  test('code spans wear the monospace + fill treatment', () => {
    const [code] = pieces(renderInline('`x`', 'dark')) as [Piece];
    expect(code).toEqual({ tag: 'code', text: 'x' });
    const vnode = (renderInline('`x`', 'dark') as VNode[]).find(
      (p) => typeof p !== 'string',
    ) as VNode<{ style: Record<string, string> }>;
    expect(vnode.props.style.fontFamily).toContain('monospace');
    expect(vnode.props.style.background).toBeTruthy();
  });
});
