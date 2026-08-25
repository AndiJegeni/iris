import { describe, expect, test } from 'bun:test';
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from './events';
import { WorktreeManager, slugifyPrompt } from './worktrees';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

describe('killDevServer', () => {
  test('resolves only after the process group is actually dead', async () => {
    const mgr = newManager() as unknown as {
      killDevServer(m: { proc: ChildProcess }): Promise<void>;
    };
    // A shell that shrugs off SIGTERM and restarts its sleep forever — the
    // kill has to escalate to SIGKILL and then WAIT for the exit, not just
    // fire the signal and return. It reports readiness through a marker
    // file: signalling before the trap is installed would kill it plain.
    const base = mkdtempSync(join(tmpdir(), 'iris-kill-test-'));
    const ready = join(base, 'ready');
    const proc = spawn('sh', ['-c', `trap "" TERM; touch "${ready}"; while :; do sleep 1; done`], {
      detached: true,
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 200 && !existsSync(ready); i++) {
        await sleep(25);
      }
      expect(existsSync(ready)).toBe(true);

      await mgr.killDevServer({ proc });
      // If killDevServer returned before the exit event, signalCode is still
      // null here — exactly the window that let a dying dev server write its
      // cache into a directory remove() had already deleted.
      expect(proc.signalCode).toBe('SIGKILL');
    } finally {
      if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
      rmSync(base, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('remove', () => {
  test('a dev server that flushes state on SIGTERM cannot resurrect the directory', async () => {
    const base = mkdtempSync(join(tmpdir(), 'iris-wt-test-'));
    try {
      // A tiny real repo, because spawnWorktree does a real clone.
      const repo = join(base, 'repo');
      mkdirSync(repo);
      writeFileSync(join(repo, 'a.txt'), 'hi\n');
      execSync(
        'git init -q -b main && git add -A && ' +
          'git -c user.email=t@t -c user.name=t commit -q -m init',
        { cwd: repo, stdio: 'ignore' },
      );

      // Fake dev server that mimics the observed race: on SIGTERM it
      // recreates its original directory (cache writers resolve absolute
      // paths, so the tombstone rename doesn't redirect them), drops a
      // ".next" cache file there, and only then exits.
      const marker = join(base, 'sigterm-ran');
      const devCmd = `d="$PWD"; trap 'mkdir -p "$d/.next" && touch "$d/.next/cache" && touch "${marker}"; exit 0' TERM; sleep 60`;
      const mgr = new WorktreeManager(repo, new EventBus(), 3000, { devCmd });

      const pending = await mgr.spawnWorktree('discard race sim');
      const slug = pending.worktree.slug;
      await pending.checkout;
      // The dev server boots behind the checkout promise; wait for its pid.
      const internals = mgr as unknown as {
        worktrees: Map<string, { proc: ChildProcess | null }>;
      };
      for (let i = 0; i < 100 && !internals.worktrees.get(slug)?.proc; i++) {
        await sleep(50);
      }
      expect(internals.worktrees.get(slug)?.proc).toBeTruthy();

      await mgr.remove(slug);

      // Deletion runs behind the response; wait for it to settle.
      const worktreeRoot = join(base, '.iris-worktrees');
      const clean = () =>
        !existsSync(pending.worktree.path) &&
        readdirSync(worktreeRoot).every((e) => !e.startsWith(slug));
      for (let i = 0; i < 200 && !clean(); i++) {
        await sleep(100);
      }

      // The SIGTERM handler really did run and recreate the directory…
      expect(existsSync(marker)).toBe(true);
      // …and neither the tombstone nor the resurrected original survived.
      expect(clean()).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});
