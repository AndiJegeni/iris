import { describe, expect, test } from 'bun:test';
import { EventBus } from './events';
import { WorktreeManager, slugifyPrompt } from './worktrees';

describe('slugifyPrompt', () => {
  test('drops stopwords and keeps the descriptive words', () => {
    expect(slugifyPrompt('change the landing text to blue')).toBe('landing-text-blue');
  });

  test('lowercases and strips punctuation', () => {
    expect(slugifyPrompt('Make the CTA button bigger!!')).toBe('cta-button-bigger');
  });

  test('a one-word prompt is still a usable name', () => {
    expect(slugifyPrompt('pls fix it')).toBe('fix');
  });

  test('keeps at most four words', () => {
    expect(slugifyPrompt('one two three four five six')).toBe('one-two-three-four');
  });

  test('returns null when nothing nameable survives', () => {
    expect(slugifyPrompt('do it')).toBeNull();
    expect(slugifyPrompt('')).toBeNull();
    expect(slugifyPrompt('please can you update the')).toBeNull();
    expect(slugifyPrompt('直してください')).toBeNull();
    expect(slugifyPrompt('--- !!! ---')).toBeNull();
  });

  test('truncates to 40 chars', () => {
    expect(slugifyPrompt('componentization abcdefghijklmnop qrstuvwxyz')).toBe(
      'componentization-abcdefghijklmnop-qrstuv',
    );
  });

  test('truncation never leaves a trailing hyphen', () => {
    // The 40-char cut lands exactly on the separator before the third word.
    const slug = slugifyPrompt(`${'a'.repeat(20)} ${'b'.repeat(18)} ccc`);
    expect(slug).toBe(`${'a'.repeat(20)}-${'b'.repeat(18)}`);
    expect(slug).toHaveLength(39);
  });

  test('output is safe as a branch, directory and URL segment', () => {
    const slug = slugifyPrompt('  Fix the  ***Sign-Up*** flow, ASAP  ');
    expect(slug).toBe('fix-sign-up-flow-asap');
    expect(slug).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  });
});

/** `allocateSlug` and the worktree map are internal; reach in to test them. */
type Internals = {
  worktrees: Map<string, unknown>;
  allocateSlug(hint?: string): string;
};

function newManager(): Internals {
  const mgr = new WorktreeManager('/tmp/iris-slug-test', new EventBus(), 3000, {
    devCmd: 'true',
  });
  return mgr as unknown as Internals;
}

/** Allocate a slug and record it, the way `spawnWorktree` would. */
function take(mgr: Internals, hint?: string): string {
  const slug = mgr.allocateSlug(hint);
  mgr.worktrees.set(slug, {});
  return slug;
}

describe('allocateSlug', () => {
  test('falls back to the counter with no hint', () => {
    const mgr = newManager();
    expect(take(mgr)).toBe('agent-1');
    expect(take(mgr)).toBe('agent-2');
  });

  test('falls back to the counter when the hint slugifies to nothing', () => {
    const mgr = newManager();
    expect(take(mgr, 'do it')).toBe('agent-1');
  });

  test('suffixes duplicate prompts instead of colliding', () => {
    const mgr = newManager();
    expect(take(mgr, 'fix typo')).toBe('fix-typo');
    expect(take(mgr, 'fix typo')).toBe('fix-typo-2');
    expect(take(mgr, 'fix typo')).toBe('fix-typo-3');
  });

  test('"main" is reserved', () => {
    const mgr = newManager();
    expect(take(mgr, 'update main')).toBe('main-2');
  });

  test('a maximum-length base is trimmed to make room for the suffix', () => {
    const mgr = newManager();
    const hint = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd';
    const first = take(mgr, hint);
    expect(first).toHaveLength(40);
    const second = take(mgr, hint);
    expect(second).toHaveLength(40);
    expect(second).toBe(`${first.slice(0, 38)}-2`);
  });

  test('numbered and named slugs coexist', () => {
    const mgr = newManager();
    expect(take(mgr, 'landing text blue')).toBe('landing-text-blue');
    expect(take(mgr)).toBe('agent-1');
    expect(take(mgr, 'landing text blue')).toBe('landing-text-blue-2');
  });
});
