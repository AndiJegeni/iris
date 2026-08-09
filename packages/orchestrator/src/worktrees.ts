import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { Worktree } from '@iris/shared';
import type { EventBus } from './events';
import { defaultDevCmd, detectPackageManager } from './project';
import { type PullRequestOutcome, openPullRequest } from './pull-request';
import { sleep } from './util';

const WORKTREE_DIR_NAME = '.iris-worktrees';
const FIRST_AGENT_PORT = 3001;
const MAX_PORT = 3199;
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_INTERVAL_MS = 400;

/** Longest slug we'll produce, suffixes included. Keeps branch/dir names sane. */
const MAX_SLUG_LEN = 40;
/** How many prompt words survive into the slug. */
const MAX_SLUG_WORDS = 4;

/**
 * Filler that carries no information about *what* the task is about. Dropping
 * these is what turns "change the landing text to blue" into "landing-text-blue"
 * rather than "change-the-landing-text".
 */
const STOPWORDS = new Set(
  (
    'a an and are can change could do for i in is it make my of on our please pls ' +
    'set the this to u update with you your'
  ).split(' '),
);

type ManagedWorktree = {
  worktree: Worktree;
  proc: ChildProcess | null;
  ready: Promise<void> | null;
};

/**
 * Owns the lifecycle of git worktrees and the dev servers running inside them.
 *
 * The "main" worktree is the user's repo at `repoRoot` with their own external
 * dev server (we don't manage it). Additional worktrees, named after the task
 * that spawned them ("landing-text-blue"), are created on demand for parallel
 * tasks; each gets its own `next dev` on a dedicated port (3001, 3002, …).
 *
 * Worktrees themselves are created under `<repoParent>/.iris-worktrees/`
 * (sibling to the repo) to keep the user's repo directory tidy.
 */
export type WorktreeManagerOptions = {
  /**
   * Command to spawn a dev server in a worktree. `%PORT%` is replaced with the
   * allocated port. Defaults to the dev script of whichever package manager the
   * repo's lockfile implies. Use this when your app isn't at the repo root,
   * e.g. `cd app && npm run dev -- --port %PORT%`.
   */
  devCmd?: string | undefined;
};

export class WorktreeManager {
  private worktrees = new Map<string, ManagedWorktree>();
  /** In-flight createPullRequest calls, keyed by slug. See that method. */
  private pullRequests = new Map<string, Promise<PullRequestOutcome>>();
  private nextSlugNum = 1;
  private readonly worktreeRoot: string;
  /** Resolved dev command, exposed so the CLI banner can print it up front. */
  readonly devCmd: string;

  constructor(
    private readonly repoRoot: string,
    private readonly bus: EventBus,
    private readonly mainPort: number = 3000,
    options: WorktreeManagerOptions = {},
  ) {
    this.worktreeRoot = join(dirname(repoRoot), WORKTREE_DIR_NAME);
    this.devCmd = options.devCmd ?? defaultDevCmd(detectPackageManager(repoRoot));

    const main: Worktree = {
      slug: 'main',
      path: repoRoot,
      branch: 'main',
      port: mainPort,
      devServerStatus: 'ready', // user-managed; we assume it's up
    };
    this.worktrees.set('main', { worktree: main, proc: null, ready: null });
  }

  list(): Worktree[] {
    return Array.from(this.worktrees.values()).map((w) => w.worktree);
  }

  get(slug: string): Worktree | null {
    return this.worktrees.get(slug)?.worktree ?? null;
  }

  /**
   * Create a new worktree + dev server. Returns immediately with the worktree
   * record (status="booting"); the dev server boots asynchronously. Use
   * `waitForReady(slug)` to await readiness before enqueueing tasks.
   *
   * `nameHint` is usually the task prompt — it's slugified into the worktree's
   * name so the shell dropdown and branch list say what each one is doing.
   */
  async spawnWorktree(nameHint?: string): Promise<Worktree> {
    if (!existsSync(this.worktreeRoot)) {
      mkdirSync(this.worktreeRoot, { recursive: true });
    }

    const slug = this.allocateSlug(nameHint);
    const branch = `la/${slug}`;
    const path = join(this.worktreeRoot, slug);
    const port = await this.allocatePort();

    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }

    // Standalone local clone — NOT a `git worktree`. Linked worktrees share the
    // primary repo's git-common-dir, and Claude Code resolves file edits to the
    // PRIMARY worktree regardless of cwd — so worktree tasks would edit main.
    // A clone is its own primary repo, so the agent edits stay isolated here.
    // `--local` hardlinks git objects (fast, no object copy); only the working
    // tree is checked out.
    execSync(`git clone --local --quiet ${quote(this.repoRoot)} ${quote(path)}`, {
      cwd: dirname(path),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execSync(`git checkout -B ${quote(branch)}`, {
      cwd: path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Copy node_modules from main so the dev server starts without install.
    this.linkNodeModules(path);

    // Carry main's UNCOMMITTED changes into the clone (clone only has committed
    // state). Tracked edits via patch; untracked files copied best-effort. This
    // is what brings <Iris /> and your current work-in-progress along.
    this.carryUncommittedChanges(path);

    const worktree: Worktree = {
      slug,
      path,
      branch,
      port,
      devServerStatus: 'booting',
    };
    const managed: ManagedWorktree = { worktree, proc: null, ready: null };
    this.worktrees.set(slug, managed);
    this.bus.broadcast({ type: 'worktree:created', worktree });

    // Spawn the dev command via /bin/sh so users can chain (`cd subdir && …`).
    const cmd = this.devCmd.replace(/%PORT%/g, String(port));
    managed.proc = spawn('sh', ['-c', cmd], {
      cwd: path,
      env: { ...process.env, PORT: String(port), BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    managed.proc.on('exit', (code) => {
      if (managed.worktree.devServerStatus !== 'stopped') {
        this.updateStatus(slug, code === 0 ? 'stopped' : 'crashed');
      }
    });

    // Pipe child output to console for debuggability (prefixed by slug).
    managed.proc.stdout?.on('data', (chunk) => {
      process.stdout.write(`[${slug}] ${chunk}`);
    });
    managed.proc.stderr?.on('data', (chunk) => {
      process.stderr.write(`[${slug}] ${chunk}`);
    });

    managed.ready = this.waitUntilHttpReady(port).then(
      () => this.updateStatus(slug, 'ready'),
      () => this.updateStatus(slug, 'crashed'),
    );

    return worktree;
  }

  /** Resolve when the worktree's dev server responds, or throw on timeout/crash. */
  async waitForReady(slug: string): Promise<void> {
    const m = this.worktrees.get(slug);
    if (!m) throw new Error(`unknown worktree: ${slug}`);
    if (m.worktree.devServerStatus === 'ready') return;
    if (!m.ready) return; // main worktree, user-managed
    await m.ready;
    if (this.worktrees.get(slug)?.worktree.devServerStatus !== 'ready') {
      throw new Error(`worktree ${slug} failed to become ready`);
    }
  }

  async remove(slug: string): Promise<void> {
    if (slug === 'main') return; // we don't own main
    const m = this.worktrees.get(slug);
    if (!m) return;

    if (m.proc && m.proc.exitCode === null) {
      m.proc.kill('SIGTERM');
      // Give it a moment, then SIGKILL.
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      if (m.proc.exitCode === null) m.proc.kill('SIGKILL');
    }

    // Standalone clone — just delete the directory.
    if (existsSync(m.worktree.path)) {
      rmSync(m.worktree.path, { recursive: true, force: true });
    }

    this.worktrees.delete(slug);
    this.bus.broadcast({ type: 'worktree:removed', slug });
  }

  /**
   * `git add -A` in a worktree, then commit if that staged anything. Shared by
   * "Ship it" and "Create PR", which both need the agent's edits to be a commit
   * before they can do anything with them.
   */
  private commitPending(
    path: string,
    message: string,
  ): { ok: true; committed: boolean } | { ok: false; error: string } {
    try {
      execSync('git add -A', { cwd: path, stdio: ['ignore', 'pipe', 'pipe'] });
      // Empty index → `git commit` would error. Check first.
      let hasChanges = true;
      try {
        execSync('git diff --cached --quiet', { cwd: path });
        hasChanges = false;
      } catch {
        hasChanges = true;
      }
      if (hasChanges) {
        execSync(`git commit -m ${quote(message)}`, {
          cwd: path,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
      return { ok: true, committed: hasChanges };
    } catch (err) {
      return { ok: false, error: `commit failed: ${String(err)}` };
    }
  }

  /**
   * Merge a worktree's branch into main and tear down the worktree. Used by
   * the "Ship it" button.
   */
  async shipIt(slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (slug === 'main') return { ok: false, error: 'cannot ship main into itself' };
    const m = this.worktrees.get(slug);
    if (!m) return { ok: false, error: `unknown worktree ${slug}` };

    const committed = this.commitPending(m.worktree.path, `iris: changes from ${slug}`);
    if (!committed.ok) return committed;

    // The agent branch lives in the CLONE (a separate repo), so fetch+merge it
    // into main from the clone's path rather than a local `git merge`.
    try {
      execSync(
        `git pull --no-edit --no-rebase ${quote(m.worktree.path)} ${quote(m.worktree.branch)}`,
        { cwd: this.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      return {
        ok: false,
        error: `merge into main failed (resolve conflicts manually): ${String(err)}`,
      };
    }

    await this.remove(slug);
    return { ok: true };
  }

  /**
   * Push this worktree's branch to the real remote and open a pull request.
   *
   * Unlike `shipIt`, the worktree and its dev server SURVIVE: a PR is a
   * checkpoint you keep iterating on, not the end of the work. Pushing again
   * after more commits fast-forwards the same branch and updates the open PR.
   *
   * Concurrent calls for one slug share a single in-flight promise — a
   * double-clicked button must not run two pushes at once.
   */
  async createPullRequest(
    slug: string,
    opts: { title?: string | undefined; body?: string | undefined } = {},
  ): Promise<PullRequestOutcome> {
    if (slug === 'main') return { ok: false, error: 'cannot open a PR from main' };
    const m = this.worktrees.get(slug);
    if (!m) return { ok: false, error: `unknown worktree ${slug}` };

    const inFlight = this.pullRequests.get(slug);
    if (inFlight) return inFlight;

    const run = (async (): Promise<PullRequestOutcome> => {
      const committed = this.commitPending(m.worktree.path, `iris: changes from ${slug}`);
      if (!committed.ok) return committed;
      return openPullRequest({
        repoRoot: this.repoRoot,
        clonePath: m.worktree.path,
        branch: m.worktree.branch,
        slug,
        ...opts,
      });
    })().finally(() => {
      this.pullRequests.delete(slug);
    });

    this.pullRequests.set(slug, run);
    return run;
  }

  /** Kill every spawned dev server. Called on daemon shutdown. */
  async cleanup(): Promise<void> {
    const slugs = Array.from(this.worktrees.keys()).filter((s) => s !== 'main');
    await Promise.all(slugs.map((s) => this.remove(s).catch(() => undefined)));
  }

  /**
   * Apply main's uncommitted tracked-file diff to the worktree, then copy over
   * untracked (non-ignored) files. Best-effort: failures are logged, not fatal.
   */
  private carryUncommittedChanges(worktreePath: string): void {
    // 1. Tracked changes (staged + unstaged) via a patch.
    try {
      const diff = execSync('git diff HEAD', {
        cwd: this.repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (diff.trim()) {
        execSync('git apply --whitespace=nowarn -', {
          cwd: worktreePath,
          input: diff,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    } catch (err) {
      process.stderr.write(
        `[iris] could not carry tracked changes into worktree: ${String(err)}\n`,
      );
    }

    // 2. Untracked, non-ignored files (e.g. brand-new components).
    try {
      const out = execSync('git ls-files --others --exclude-standard', {
        cwd: this.repoRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      const files = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const rel of files) {
        const src = join(this.repoRoot, rel);
        const dst = join(worktreePath, rel);
        try {
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
        } catch {
          // skip individual file failures
        }
      }
    } catch {
      // ls-files failed — ignore
    }
  }

  /**
   * Give the worktree a node_modules without running an install (root level +
   * every nested package or example that has its own). Walks one level deep for
   * monorepos.
   *
   * This must produce a REAL directory, not a symlink to main's. Turbopack
   * treats the project directory as a filesystem root and refuses to compile
   * anything reached through it:
   *
   *   FATAL: Symlink [project]/node_modules is invalid, it points out of the
   *          filesystem root
   *
   * It panics *after* binding the port and printing "Ready", so the symlink
   * showed up as a dev server that started and then died. Symlinking the
   * individual entries inside a real node_modules fails the same way — the
   * constraint is on the files' location, not on the shape of the link.
   *
   * So copy, cheaply: `cp -c` (macOS/APFS) and `--reflink=auto` (Linux/btrfs,
   * xfs) are copy-on-write clones that share blocks with the original, so a
   * 443MB node_modules costs ~9MB and a few seconds. Where the filesystem
   * can't clone, the flag is ignored (Linux) or the command fails and we retry
   * as a plain recursive copy — correct, just slower.
   */
  private linkNodeModules(worktreePath: string): void {
    const copyTree = (src: string, dst: string): void => {
      // `cp -c` errors rather than falling back when the FS can't clone, so try
      // the cheap form first and drop to a plain copy if it's unavailable.
      const attempts =
        process.platform === 'darwin'
          ? [`cp -Rc ${quote(src)} ${quote(dst)}`, `cp -R ${quote(src)} ${quote(dst)}`]
          : [
              `cp -R --reflink=auto ${quote(src)} ${quote(dst)}`,
              `cp -R ${quote(src)} ${quote(dst)}`,
            ];

      for (const cmd of attempts) {
        try {
          execSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
          return;
        } catch {
          // A partial copy would shadow main's modules with an incomplete tree,
          // which fails far more confusingly than having none at all.
          rmSync(dst, { recursive: true, force: true });
        }
      }

      // Last resort: the old symlink. Wrong for Turbopack, but vite/webpack
      // projects resolve through it fine, so it beats no node_modules at all.
      try {
        symlinkSync(src, dst, 'dir');
      } catch {
        // ignore — the dev server will report the missing dependency itself
      }
    };

    const tryLink = (subdir: string): void => {
      const src = join(this.repoRoot, subdir, 'node_modules');
      if (!existsSync(src)) return;
      const dst = join(worktreePath, subdir, 'node_modules');
      if (existsSync(dst)) return;
      mkdirSync(dirname(dst), { recursive: true });
      copyTree(src, dst);
    };

    tryLink('.');
    // Walk one level — packages/* and examples/* commonly have their own.
    for (const top of ['packages', 'examples', 'apps']) {
      const topPath = join(this.repoRoot, top);
      if (!existsSync(topPath)) continue;
      try {
        const entries = readdirSync(topPath, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory()) tryLink(join(top, ent.name));
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * Pick the worktree's name. A usable hint becomes the slug itself (suffixed
   * on collision); anything else falls back to the `agent-N` counter.
   */
  private allocateSlug(hint?: string): string {
    const base = hint ? slugifyPrompt(hint) : null;
    if (!base) return this.allocateNumberedSlug();

    // "main" is always a key in the map, so this also covers the reserved name:
    // a prompt that slugifies to "main" gets "main-2".
    if (!this.worktrees.has(base)) return base;

    for (let n = 2; n < 1000; n++) {
      const suffix = `-${n}`;
      // The suffix has to survive the length cap, so trim the base instead.
      const trimmed = trimHyphens(base.slice(0, MAX_SLUG_LEN - suffix.length));
      if (!trimmed) break;
      const candidate = trimmed + suffix;
      if (!this.worktrees.has(candidate)) return candidate;
    }
    return this.allocateNumberedSlug();
  }

  private allocateNumberedSlug(): string {
    while (true) {
      const candidate = `agent-${this.nextSlugNum++}`;
      if (!this.worktrees.has(candidate)) return candidate;
    }
  }

  private async allocatePort(): Promise<number> {
    const used = new Set(Array.from(this.worktrees.values()).map((w) => w.worktree.port));
    for (let p = FIRST_AGENT_PORT; p <= MAX_PORT; p++) {
      if (used.has(p)) continue;
      if (await isPortFree(p)) return p;
    }
    throw new Error('no agent port available in 3001-3199');
  }

  private async waitUntilHttpReady(port: number): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://localhost:${port}/`, {
          signal: AbortSignal.timeout(800),
          redirect: 'manual',
        });
        // Any non-5xx response means the server is listening.
        if (res.status < 500) return;
      } catch {
        // not ready
      }
      await sleep(READY_POLL_INTERVAL_MS);
    }
    throw new Error(`dev server on :${port} did not respond within ${READY_TIMEOUT_MS}ms`);
  }

  private updateStatus(slug: string, status: Worktree['devServerStatus']): void {
    const m = this.worktrees.get(slug);
    if (!m) return;
    m.worktree = { ...m.worktree, devServerStatus: status };
    this.bus.broadcast({ type: 'worktree:updated', worktree: m.worktree });
  }
}

/**
 * True if nothing is listening on `port`. Probes by attempting a TCP bind —
 * more reliable than an HTTP fetch (catches non-HTTP listeners and zombie
 * dev servers from prior runs that would otherwise cause EADDRINUSE).
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

/** Wrap a path in quotes for shell-safe command execution. */
function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function trimHyphens(s: string): string {
  return s.replace(/^-+/, '').replace(/-+$/, '');
}

/**
 * Turn a task prompt into a short, descriptive worktree name — the slug is the
 * worktree's whole identity (map key, directory, `la/` branch, URL param), so
 * the output alphabet is deliberately the intersection of what git refs,
 * filenames and URL path segments all accept: `[a-z0-9-]`, no edge hyphens.
 *
 * Returns null when the prompt has nothing nameable left in it ("do it", a
 * non-Latin prompt); the caller then uses `agent-N`.
 */
export function slugifyPrompt(prompt: string): string | null {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .slice(0, MAX_SLUG_WORDS);

  const slug = trimHyphens(words.join('-').replace(/-+/g, '-')).slice(0, MAX_SLUG_LEN);
  // Truncation can leave a trailing hyphen behind, which isn't a legal ref end.
  return trimHyphens(slug) || null;
}
