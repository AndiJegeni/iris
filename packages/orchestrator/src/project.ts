import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Lockfiles in precedence order. A repo can carry more than one (a stale
 * `package-lock.json` left behind after moving to pnpm is common), so the first
 * match wins rather than the last.
 */
const LOCKFILES: [PackageManager, string][] = [
  ['bun', 'bun.lock'],
  ['bun', 'bun.lockb'],
  ['pnpm', 'pnpm-lock.yaml'],
  ['yarn', 'yarn.lock'],
  ['npm', 'package-lock.json'],
];

/**
 * Which package manager this project uses, inferred from its lockfile.
 * Defaults to npm — the safest guess for a project with no lockfile yet, and
 * the one whose binary is always present alongside Node.
 */
export function detectPackageManager(repoRoot: string): PackageManager {
  for (const [pm, file] of LOCKFILES) {
    if (existsSync(join(repoRoot, file))) return pm;
  }
  return 'npm';
}

/**
 * The command that starts a dev server in a worktree, with `%PORT%` left for
 * the caller to substitute.
 *
 * npm needs `--` to pass the flag through to the script rather than consume it
 * itself; the others forward unknown flags directly.
 */
export function defaultDevCmd(pm: PackageManager): string {
  switch (pm) {
    case 'npm':
      return 'npm run dev -- --port %PORT%';
    case 'pnpm':
      return 'pnpm dev --port %PORT%';
    case 'yarn':
      return 'yarn dev --port %PORT%';
    case 'bun':
      return 'bun run dev --port %PORT%';
  }
}

/** The command that installs a dev dependency, for `iris init`. */
export function addDevDepCmd(pm: PackageManager, pkg: string): [string, string[]] {
  switch (pm) {
    case 'npm':
      return ['npm', ['install', '--save-dev', pkg]];
    case 'pnpm':
      return ['pnpm', ['add', '--save-dev', pkg]];
    case 'yarn':
      return ['yarn', ['add', '--dev', pkg]];
    case 'bun':
      return ['bun', ['add', '--dev', pkg]];
  }
}

/**
 * True when `dir` sits inside a git working tree AND git itself is usable.
 * Worktree mode clones the repo, so both must hold; the overlay uses this to
 * disable the "new worktree" toggle instead of letting a task fail on submit.
 */
export function isGitRepo(dir: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * The repo's actual git directory. `join(dir, '.git')` is only right in a
 * primary checkout — inside a linked worktree `.git` is a pointer *file*, and
 * treating it as a directory made the daemon fail to boot there.
 */
export function gitDir(dir: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The remote we'd push a worktree branch to: "origin" if it exists, else the
 * first remote configured, else null.
 *
 * Returns a *name*, not a URL, because that's what `git push` should be given —
 * a name lets git apply the user's `url.<base>.insteadOf` rewrites and the
 * credential config attached to that remote. Callers wanting owner/repo should
 * pass the name to `remoteUrl` and parse the result.
 */
export function resolveRemoteName(dir: string): string | null {
  try {
    const out = execFileSync('git', ['remote'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const names = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) return null;
    return names.includes('origin') ? 'origin' : names[0]!;
  } catch {
    return null;
  }
}

/**
 * URL of a named remote. Used only to derive owner/repo — never to push to.
 *
 * `git remote get-url` (unlike `git config --get remote.<n>.url`) applies the
 * user's `url.<base>.insteadOf` rewrites, so this reports where a push actually
 * lands rather than what was typed. That's what we want: someone whose origin
 * is `git@github.com:o/r` but who rewrites SSH to HTTPS still resolves to
 * github.com, and the PR is opened against the host that really receives it.
 */
export function remoteUrl(dir: string, name: string): string | null {
  try {
    const out = execFileSync('git', ['remote', 'get-url', name], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether the GitHub CLI is on PATH.
 *
 * Deliberately NOT `gh auth status`: that makes a network round trip to GitHub,
 * and this runs during daemon startup. Being logged out isn't fatal anyway —
 * PR creation falls back to a compare URL — so "binary present" is the right
 * granularity for a capability flag, and auth is resolved at call time.
 */
export function hasGhCli(): boolean {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
