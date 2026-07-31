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
