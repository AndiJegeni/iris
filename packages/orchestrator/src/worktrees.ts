import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Worktree } from '@localagents/shared';
import type { EventBus } from './events';

const WORKTREE_DIR_NAME = '.localagents-worktrees';
const FIRST_AGENT_PORT = 3001;
const MAX_PORT = 3199;
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_INTERVAL_MS = 400;

type ManagedWorktree = {
  worktree: Worktree;
  proc: ChildProcess | null;
  ready: Promise<void> | null;
};

/**
 * Owns the lifecycle of git worktrees and the dev servers running inside them.
 *
 * The "main" worktree is the user's repo at `repoRoot` with their own external
 * dev server (we don't manage it). Additional worktrees ("agent-1", "agent-2"…)
 * are created on demand for parallel tasks; each gets its own `next dev` on a
 * dedicated port (3001, 3002, …).
 *
 * Worktrees themselves are created under `<repoParent>/.localagents-worktrees/`
 * (sibling to the repo) to keep the user's repo directory tidy.
 */
export type WorktreeManagerOptions = {
  /**
   * Command to spawn a dev server in a worktree. `%PORT%` is replaced with the
   * allocated port. Default: `bun run dev --port %PORT%`. Use this when your
   * app isn't at the repo root, e.g. `cd app && bun run dev --port %PORT%`.
   */
  devCmd?: string | undefined;
};

const DEFAULT_DEV_CMD = 'bun run dev --port %PORT%';

export class WorktreeManager {
  private worktrees = new Map<string, ManagedWorktree>();
  private nextSlugNum = 1;
  private readonly worktreeRoot: string;
  private readonly devCmd: string;

  constructor(
    private readonly repoRoot: string,
    private readonly bus: EventBus,
    private readonly mainPort: number = 3000,
    options: WorktreeManagerOptions = {},
  ) {
    this.worktreeRoot = join(dirname(repoRoot), WORKTREE_DIR_NAME);
    this.devCmd = options.devCmd ?? DEFAULT_DEV_CMD;

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
   */
  async spawnWorktree(): Promise<Worktree> {
    if (!existsSync(this.worktreeRoot)) {
      mkdirSync(this.worktreeRoot, { recursive: true });
    }

    const slug = this.allocateSlug();
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

    // Symlink node_modules from main so the dev server starts without install.
    this.linkNodeModules(path);

    // Carry main's UNCOMMITTED changes into the clone (clone only has committed
    // state). Tracked edits via patch; untracked files copied best-effort. This
    // is what brings <LocalAgents/> and your current work-in-progress along.
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
   * Merge a worktree's branch into main and tear down the worktree. Used by
   * the "Ship it" button (M7).
   */
  async shipIt(slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (slug === 'main') return { ok: false, error: 'cannot ship main into itself' };
    const m = this.worktrees.get(slug);
    if (!m) return { ok: false, error: `unknown worktree ${slug}` };

    // Commit any pending changes in the worktree first.
    try {
      execSync('git add -A', { cwd: m.worktree.path });
      // Empty index → `git commit` would error. Check first.
      let hasChanges = true;
      try {
        execSync('git diff --cached --quiet', { cwd: m.worktree.path });
        hasChanges = false;
      } catch {
        hasChanges = true;
      }
      if (hasChanges) {
        execSync(`git commit -m ${quote(`localagents: changes from ${slug}`)}`, {
          cwd: m.worktree.path,
        });
      }
    } catch (err) {
      return { ok: false, error: `commit failed: ${String(err)}` };
    }

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
        `[localagents] could not carry tracked changes into worktree: ${String(err)}\n`,
      );
    }

    // 2. Untracked, non-ignored files (e.g. brand-new components).
    try {
      const out = execSync('git ls-files --others --exclude-standard', {
        cwd: this.repoRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      const files = out.split('\n').map((l) => l.trim()).filter(Boolean);
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
   * Symlink node_modules from main into worktree (root level + every nested
   * package or example that has its own). Walks one level deep for monorepos.
   */
  private linkNodeModules(worktreePath: string): void {
    const tryLink = (subdir: string): void => {
      const src = join(this.repoRoot, subdir, 'node_modules');
      if (!existsSync(src)) return;
      const dst = join(worktreePath, subdir, 'node_modules');
      if (existsSync(dst)) return;
      try {
        symlinkSync(src, dst, 'dir');
      } catch {
        // ignore
      }
    };

    tryLink('.');
    // Walk one level — packages/* and examples/* commonly have their own.
    for (const top of ['packages', 'examples', 'apps']) {
      const topPath = join(this.repoRoot, top);
      if (!existsSync(topPath)) continue;
      try {
        const entries = require('node:fs').readdirSync(topPath, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory()) tryLink(join(top, ent.name));
        }
      } catch {
        // ignore
      }
    }
  }

  private allocateSlug(): string {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True if nothing is listening on `port`. Probes by attempting a TCP bind —
 * more reliable than an HTTP fetch (catches non-HTTP listeners and zombie
 * dev servers from prior runs that would otherwise cause EADDRINUSE).
 */
async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: '0.0.0.0',
      port,
      socket: { data() {}, open() {}, close() {} },
    });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Wrap a path in quotes for shell-safe command execution. */
function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
