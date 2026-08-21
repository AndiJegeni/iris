import { type ChildProcess, execSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { Worktree } from '@iris/shared';
import type { EventBus } from './events';
import { defaultDevCmd, detectPackageManager } from './project';
import { type PullRequestOutcome, openPullRequest } from './pull-request';
import { sleep } from './util';

/**
 * Result of a "Merge locally". `replaced` names uncommitted files whose
 * contents the merge overwrote — they are in a stash, and the UI says so.
 */
/**
 * A worktree that exists as a name, a branch and a port, but whose files may
 * still be arriving.
 *
 * `spawnWorktree` hands this back the moment the worktree is *named*, which is
 * all the caller needs to enqueue a task and paint a row for it. The clone runs
 * behind `checkout`, so pressing Enter no longer buys six seconds of a frozen
 * daemon before anything appears on screen.
 */
export type PendingWorktree = {
  worktree: Worktree;
  /**
   * Resolves once the branch is checked out and your uncommitted work has been
   * carried in — the first moment an agent may safely edit. Rejects if the
   * clone failed, and the queue turns that into a failed task row.
   *
   * Deliberately NOT gated on node_modules or the dev server: an agent editing
   * source files needs neither, and waiting on a 20k-file copy would spend the
   * user's first five seconds on something the agent never touches.
   */
  checkout: Promise<void>;
};

export type ShipOutcome = { ok: true; replaced?: string[] } | { ok: false; error: string };

const WORKTREE_DIR_NAME = '.iris-worktrees';
/**
 * Per-worktree metadata, written inside `.git/` at spawn so it never shows up
 * in `git status` or rides into a commit. This is what makes a worktree
 * *adoptable*: the in-memory map dies with the daemon, and without a record of
 * `baseCommit` and the carried files, a restarted daemon could see the
 * directory but not safely merge it.
 */
const WORKTREE_META_FILE = 'iris-worktree.json';
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
  /**
   * What `carryUncommittedChanges` copied in at spawn, as repo-relative path →
   * content hash at the moment it was carried.
   *
   * This is your working state, not the agent's work: the `<Iris />` drop-in,
   * the layout line that renders it, whatever you had half-finished. It has to
   * be in the worktree so the agent sees the code you actually run — but it
   * must not end up in the commit that ship/PR creates, or a pull request
   * carries your local scaffolding out to the remote. The hash is what lets us
   * tell the two apart later: still matching means the agent never touched it.
   */
  carried: Map<string, string>;
  /**
   * The clone's progress, or null for main (which we never created). Held here
   * so a second task landing on the same worktree waits on the same promise
   * rather than racing a half-populated directory.
   */
  checkout: Promise<void> | null;
  /**
   * The commit the branch was cut from. Diffing it against the branch tip is
   * what tells us which files the agent actually changed — needed at merge time
   * to work out which of your uncommitted files are genuinely in the way.
   */
  baseCommit: string;
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
    // Main is your checkout, not a clone — nothing was carried into it, and
    // ship/PR refuse to operate on it anyway.
    this.worktrees.set('main', {
      worktree: main,
      proc: null,
      ready: null,
      // Already there — nothing to wait for, so tasks on main never gate.
      checkout: null,
      carried: new Map(),
      baseCommit: '',
    });

    // Adopt whatever a previous daemon left behind. Fire-and-forget: adoption
    // broadcasts each worktree as it lands, and clients connect after boot.
    void this.reconcile();
  }

  /**
   * Re-adopt worktrees a previous daemon run left on disk.
   *
   * The map above is memory, so a restart used to orphan every live worktree:
   * still on disk, still holding a branch (and possibly unmerged agent work),
   * but absent from the dropdown and unreachable by ship/PR/discard — several
   * hundred MB each, findable only by hand. Instead, walk the worktree root
   * and register everything that finished its checkout, so stranded work comes
   * back as a normal row the user can merge or throw away.
   */
  private async reconcile(): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(this.worktreeRoot);
    } catch {
      return; // no worktree root yet — nothing was ever spawned
    }

    for (const slug of entries) {
      if (this.worktrees.has(slug)) continue;
      const path = join(this.worktreeRoot, slug);

      if (!existsSync(join(path, '.git'))) continue; // not ours — leave it alone

      // Metadata is written after the checkout completes. Without it we're
      // looking at either a pre-metadata worktree (adoptable, with recovered
      // facts) or a crash mid-clone (delete). Git working = former.
      let meta: {
        baseCommit?: string;
        carried?: Record<string, string>;
        devPgid?: number | null;
      } | null = null;
      try {
        meta = JSON.parse(readFileSync(join(path, '.git', WORKTREE_META_FILE), 'utf8'));
      } catch {
        meta = null;
      }

      try {
        const branch = (await sh('git branch --show-current', { cwd: path })).trim();
        // Agent work stays uncommitted until ship, so for a metadata-less
        // worktree HEAD is (almost always) the commit the branch was cut from.
        // An empty carried set errs the safe way: at worst your scaffolding
        // rides into a local merge commit; nothing is ever deleted over it.
        const baseCommit =
          meta && typeof meta.baseCommit === 'string'
            ? meta.baseCommit
            : (await sh('git rev-parse HEAD', { cwd: path })).trim();
        const port = await this.allocatePort();
        const managed: ManagedWorktree = {
          worktree: { slug, path, branch, port, devServerStatus: 'booting' },
          proc: null,
          ready: null,
          checkout: null,
          carried: new Map(Object.entries(meta?.carried ?? {})),
          baseCommit,
        };
        if (!meta) this.writeMeta(managed); // upgrade in place for next time
        this.worktrees.set(slug, managed);
        this.bus.broadcast({ type: 'worktree:created', worktree: managed.worktree });
        process.stdout.write(`[iris] adopted worktree ${slug} from a previous run\n`);
        // A daemon that died without cleanup leaves its dev server running —
        // reparented to init, still holding the port and the framework's dev
        // lock, which makes the replacement below crash on boot. Clear it
        // first, verifying the group really is this worktree's before killing.
        await this.killStaleDevServer(meta?.devPgid ?? null, path).catch(() => undefined);
        void this.bootDevServer(managed);
      } catch {
        // Git itself is broken in there — a clone that died partway. The husk
        // holds nothing recoverable, and leaving it would strand disk forever.
        rmSync(path, { recursive: true, force: true });
        process.stderr.write(`[iris] removed incomplete worktree ${slug}\n`);
      }
    }
  }

  list(): Worktree[] {
    return Array.from(this.worktrees.values()).map((w) => w.worktree);
  }

  get(slug: string): Worktree | null {
    return this.worktrees.get(slug)?.worktree ?? null;
  }

  /**
   * Name a new worktree and start populating it. Returns as soon as the slug,
   * branch and port are decided — the clone, the node_modules copy and the dev
   * server all run behind the returned `checkout` promise.
   *
   * This ordering is the whole point. Doing the work first and answering after
   * meant `POST /annotate` sat on a synchronous clone plus a 20k-file copy
   * before the task existed at all, so the UI had nothing to show for the first
   * six seconds and the daemon's event loop was blocked throughout.
   *
   * `nameHint` is usually the task prompt — it's slugified into the worktree's
   * name so the shell dropdown and branch list say what each one is doing.
   */
  async spawnWorktree(nameHint?: string): Promise<PendingWorktree> {
    if (!existsSync(this.worktreeRoot)) {
      mkdirSync(this.worktreeRoot, { recursive: true });
    }

    const slug = this.allocateSlug(nameHint);
    const branch = `la/${slug}`;
    const path = join(this.worktreeRoot, slug);
    // The only await before we answer: binding a probe socket, single-digit ms.
    const port = await this.allocatePort();

    const worktree: Worktree = {
      slug,
      path,
      branch,
      port,
      devServerStatus: 'booting',
    };
    // `carried` and `baseCommit` are filled in by the checkout below. Nothing
    // reads them before then: they are merge-time inputs, and you cannot merge
    // a worktree whose agent has not run yet.
    const managed: ManagedWorktree = {
      worktree,
      proc: null,
      ready: null,
      checkout: null,
      carried: new Map(),
      baseCommit: '',
    };
    this.worktrees.set(slug, managed);
    this.bus.broadcast({ type: 'worktree:created', worktree });

    const checkout = this.checkoutClone(managed);
    managed.checkout = checkout;

    // The dev server rides behind the checkout rather than in front of the
    // agent. A failed clone already reaches the user through the task row, so
    // there is nothing to report a second time here.
    void checkout.then(
      () => this.bootDevServer(managed),
      () => {},
    );

    return { worktree, checkout };
  }

  /**
   * Clone the repo, cut the branch, and carry your uncommitted work in.
   *
   * Standalone local clone — NOT a `git worktree`. Linked worktrees share the
   * primary repo's git-common-dir, and Claude Code resolves file edits to the
   * PRIMARY worktree regardless of cwd — so worktree tasks would edit main.
   * A clone is its own primary repo, so the agent edits stay isolated here.
   * `--local` hardlinks git objects (fast, no object copy); only the working
   * tree is checked out.
   */
  private async checkoutClone(m: ManagedWorktree): Promise<void> {
    const { path, branch } = m.worktree;

    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }

    await sh(`git clone --local --quiet ${quote(this.repoRoot)} ${quote(path)}`, {
      cwd: dirname(path),
    });
    await sh(`git checkout -B ${quote(branch)}`, { cwd: path });
    m.baseCommit = (await sh('git rev-parse HEAD', { cwd: path })).trim();

    // Carry main's UNCOMMITTED changes into the clone (clone only has committed
    // state). Tracked edits via patch; untracked files copied best-effort. This
    // is what brings <Iris /> and your current work-in-progress along.
    m.carried = this.carryUncommittedChanges(path);

    // Written last, so its presence implies a complete checkout: a crash
    // mid-clone leaves no metadata, and reconcile skips the husk.
    this.writeMeta(m);
  }

  /** Persist the merge-time facts a future daemon can't recompute. */
  private writeMeta(m: ManagedWorktree): void {
    try {
      writeFileSync(
        join(m.worktree.path, '.git', WORKTREE_META_FILE),
        JSON.stringify({
          baseCommit: m.baseCommit,
          carried: Object.fromEntries(m.carried),
          // Process-group id of the dev command (pid of its `sh`, which leads
          // the group thanks to `detached`). Null until the server is spawned.
          devPgid: m.proc?.pid ?? null,
        }),
      );
    } catch (err) {
      // Non-fatal: the worktree still works for this daemon's lifetime; it just
      // won't survive a restart with full fidelity.
      process.stderr.write(`[iris] could not write worktree metadata: ${String(err)}\n`);
    }
  }

  /**
   * Copy node_modules in and start the dev command. Both are preview concerns,
   * so they happen after the agent has already been let loose on the source.
   */
  private async bootDevServer(m: ManagedWorktree): Promise<void> {
    const { slug, path, port } = m.worktree;

    // Copy node_modules from main so the dev server starts without install.
    await this.linkNodeModules(path);

    // Spawn the dev command via /bin/sh so users can chain (`cd subdir && …`).
    // `detached` gives the command its own process group, so killing `-pid`
    // reaches the actual dev server behind the `sh`/`npm` wrappers — a plain
    // SIGTERM to the wrapper is how Next processes used to outlive the daemon,
    // squatting on their port and .next lock against the next adoption.
    const cmd = this.devCmd.replace(/%PORT%/g, String(port));
    m.proc = spawn('sh', ['-c', cmd], {
      cwd: path,
      env: { ...process.env, PORT: String(port), BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    // Re-write the metadata with the group id, so a daemon that died without
    // cleanup (kill -9, crash) leaves its successor enough to clear the stale
    // server at adoption.
    this.writeMeta(m);

    m.proc.on('exit', (code) => {
      if (m.worktree.devServerStatus !== 'stopped') {
        this.updateStatus(slug, code === 0 ? 'stopped' : 'crashed');
      }
    });

    // Pipe child output to console for debuggability (prefixed by slug).
    m.proc.stdout?.on('data', (chunk) => {
      process.stdout.write(`[${slug}] ${chunk}`);
    });
    m.proc.stderr?.on('data', (chunk) => {
      process.stderr.write(`[${slug}] ${chunk}`);
    });

    m.ready = this.waitUntilHttpReady(port).then(
      () => this.updateStatus(slug, 'ready'),
      () => this.updateStatus(slug, 'crashed'),
    );
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

    await this.killDevServer(m);

    // Standalone clone — just delete the directory.
    if (existsSync(m.worktree.path)) {
      rmSync(m.worktree.path, { recursive: true, force: true });
    }

    this.worktrees.delete(slug);
    this.bus.broadcast({ type: 'worktree:removed', slug });
  }

  /**
   * `git add -A` in a worktree, then commit if that staged anything. Shared by
   * "Merge locally" and "Create PR", which both need the agent's edits to be a commit
   * before they can do anything with them.
   */
  /**
   * Drop the carried-in working state back out of the index, so the commit is
   * the agent's diff and nothing else.
   *
   * "Untouched" is decided by content, not by path: a carried file whose hash
   * still matches what we copied in is yours and gets unstaged; one the agent
   * edited (or deleted, so it no longer hashes) stays staged, because then the
   * change genuinely is the agent's work. `git reset` rather than `git restore
   * --staged` for the wider git-version range, and chunked so a repo with a lot
   * of uncommitted files can't blow past the shell's argument limit.
   *
   * Best-effort throughout: if this fails we commit everything, which is the
   * old behaviour rather than a broken ship.
   */
  private unstageUntouched(path: string, carried: Map<string, string>): void {
    if (carried.size === 0) return;
    const paths = [...carried.keys()];
    const now = this.hashFiles(path, paths);
    const untouched = paths.filter((rel) => now.get(rel) === carried.get(rel));
    for (let i = 0; i < untouched.length; i += 100) {
      const chunk = untouched
        .slice(i, i + 100)
        .map(quote)
        .join(' ');
      try {
        execSync(`git reset -q -- ${chunk}`, { cwd: path, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        // leave those staged rather than failing the whole commit
      }
    }
  }

  private commitPending(
    path: string,
    message: string,
    carried: Map<string, string> = new Map(),
  ): { ok: true; committed: boolean } | { ok: false; error: string } {
    try {
      execSync('git add -A', { cwd: path, stdio: ['ignore', 'pipe', 'pipe'] });
      this.unstageUntouched(path, carried);
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
   * Stash the uncommitted files that would block the merge, so it can proceed.
   *
   * "In the way" is the intersection of two sets: what the agent changed on its
   * branch (base..tip), and what you have dirty in your checkout. Files outside
   * that overlap are left completely alone — merging is not a reason to disturb
   * work in a file nobody else touched.
   *
   * The stash is the safety net for a deliberately destructive action: the
   * contents are recoverable with `git stash pop` even though the merge has
   * already overwritten the files. Untracked files are included (`-u`), because
   * a hand-added drop-in like Iris.tsx blocks a merge just as effectively as an
   * edit to a tracked one.
   *
   * Best-effort: if the stash fails we return empty and let the merge attempt
   * fail loudly, rather than deleting the files some other way.
   */
  private clearMergeBlockers(m: ManagedWorktree, slug: string): string[] {
    let agentFiles: string[];
    try {
      agentFiles = execSync(`git diff --name-only ${quote(m.baseCommit)} HEAD`, {
        cwd: m.worktree.path,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
    if (agentFiles.length === 0) return [];

    // Two plain path lists rather than parsing `git status --porcelain`, whose
    // fixed "XY <path>" columns don't survive the per-line trim in listPaths —
    // and whose rename entries ("R old -> new") would need special-casing too.
    const dirty = new Set([
      ...this.listPaths('git diff --name-only HEAD'), // tracked, modified or deleted
      ...this.listPaths('git ls-files --others --exclude-standard'), // untracked
    ]);
    const blockers = agentFiles.filter((f) => dirty.has(f));
    if (blockers.length === 0) return [];

    try {
      execSync(
        `git stash push -u -m ${quote(`iris: local edits replaced by ${slug}`)} -- ${blockers
          .map(quote)
          .join(' ')}`,
        { cwd: this.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      process.stderr.write(`[iris] could not stash local edits before merge: ${String(err)}\n`);
      return [];
    }
    process.stderr.write(
      `[iris] merging ${slug}: replaced your uncommitted ${blockers.join(', ')} — recover with \`git stash pop\`\n`,
    );
    return blockers;
  }

  /** Put a stash from clearMergeBlockers back, when the merge failed anyway. */
  private restoreStash(): void {
    try {
      execSync('git stash pop', { cwd: this.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      process.stderr.write('[iris] could not restore stashed edits — see `git stash list`\n');
    }
  }

  /**
   * Merge a worktree's branch into main and tear down the worktree. Used by
   * the "Merge locally" button.
   */
  async shipIt(slug: string): Promise<ShipOutcome> {
    if (slug === 'main') return { ok: false, error: 'cannot merge main into itself' };
    const m = this.worktrees.get(slug);
    if (!m) return { ok: false, error: `unknown worktree ${slug}` };

    const committed = this.commitPending(m.worktree.path, `iris: changes from ${slug}`, m.carried);
    if (!committed.ok) return committed;

    // Git refuses to merge over uncommitted changes, which is the right default
    // and the wrong one here: you pressed the button that means "take the
    // agent's version". Clear the blockers out of the way so the merge always
    // lands — but only the files actually in the way, and only after parking
    // their current contents in a stash, since uncommitted work exists nowhere
    // else and a button press shouldn't be able to evaporate it.
    const replaced = this.clearMergeBlockers(m, slug);

    // The agent branch lives in the CLONE (a separate repo), so fetch+merge it
    // into main from the clone's path rather than a local `git merge`.
    try {
      execSync(
        `git pull --no-edit --no-rebase ${quote(m.worktree.path)} ${quote(m.worktree.branch)}`,
        { cwd: this.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      // The merge died for some other reason (a real conflict between committed
      // states). Put the stashed work back rather than leaving it hidden.
      if (replaced.length > 0) this.restoreStash();
      return {
        ok: false,
        error: `merge into main failed (resolve conflicts manually): ${String(err)}`,
      };
    }

    await this.remove(slug);
    return replaced.length > 0 ? { ok: true, replaced } : { ok: true };
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
      const committed = this.commitPending(
        m.worktree.path,
        `iris: changes from ${slug}`,
        m.carried,
      );
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
  /**
   * Stop every dev server WITHOUT deleting anything.
   *
   * This is what shutdown calls. It used to call `remove()` on every worktree,
   * which deletes the directory — so a clean Ctrl-C destroyed unmerged agent
   * work, and the only worktrees that ever survived were the ones a crash
   * happened to strand. Worktrees are durable now: they outlive the daemon on
   * disk and `reconcile()` re-adopts them at the next boot; only an explicit
   * Merge or Archive deletes files.
   */
  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.worktrees.values())
        .filter((m) => m.worktree.slug !== 'main')
        .map(async (m) => {
          m.worktree.devServerStatus = 'stopped';
          await this.killDevServer(m).catch(() => undefined);
        }),
    );
  }

  /**
   * Kill a previous daemon's dev-server process group, if it's still alive AND
   * still recognisably ours. Pids get recycled, so before signalling we demand
   * a live member of the group whose command line mentions the worktree path —
   * the framework binary resolves through `<path>/node_modules/.bin`, so a
   * real survivor always matches and a reused pid essentially never does.
   */
  private async killStaleDevServer(pgid: number | null, worktreePath: string): Promise<void> {
    if (!pgid) return;
    try {
      await sh(`pgrep -g ${Math.floor(pgid)} -f ${quote(worktreePath)}`);
    } catch {
      return; // no such group, or nothing in it belongs to this worktree
    }
    try {
      process.kill(-Math.floor(pgid), 'SIGKILL');
    } catch {
      // raced its own exit
    }
    // Give the OS a beat to release the port and the dev lock.
    await sleep(200);
  }

  /** SIGTERM the dev command's whole process group, escalating to SIGKILL. */
  private async killDevServer(m: ManagedWorktree): Promise<void> {
    const pid = m.proc?.pid;
    if (!pid || m.proc?.exitCode !== null) return;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      return; // group already gone
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    if (m.proc?.exitCode === null) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // raced its own exit — fine
      }
    }
  }

  /**
   * Apply main's uncommitted tracked-file diff to the worktree, then copy over
   * untracked (non-ignored) files. Best-effort: failures are logged, not fatal.
   */
  private carryUncommittedChanges(worktreePath: string): Map<string, string> {
    const carriedPaths: string[] = [];

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
        carriedPaths.push(...this.listPaths('git diff HEAD --name-only'));
      }
    } catch (err) {
      process.stderr.write(
        `[iris] could not carry tracked changes into worktree: ${String(err)}\n`,
      );
    }

    // 2. Untracked, non-ignored files (e.g. brand-new components — this is how
    //    a hand-added Iris.tsx drop-in reaches the worktree).
    try {
      for (const rel of this.listPaths('git ls-files --others --exclude-standard')) {
        const src = join(this.repoRoot, rel);
        const dst = join(worktreePath, rel);
        try {
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
          carriedPaths.push(rel);
        } catch {
          // skip individual file failures
        }
      }
    } catch {
      // ls-files failed — ignore
    }

    return this.hashFiles(worktreePath, carriedPaths);
  }

  /** Run a git command that prints one path per line, in the main repo. */
  private listPaths(cmd: string): string[] {
    return execSync(cmd, { cwd: this.repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /**
   * Content hash per path, as the files stand in `dir` right now. Uses git's own
   * hash-object (one process, paths on stdin) so it matches how git sees the
   * content, and so a large carry doesn't fork a process per file. Paths that
   * can't be hashed — deleted, unreadable — are simply left out, which makes
   * them count as "changed" later and so get committed.
   */
  private hashFiles(dir: string, paths: string[]): Map<string, string> {
    const hashes = new Map<string, string>();
    if (paths.length === 0) return hashes;
    try {
      const out = execSync('git hash-object --stdin-paths', {
        cwd: dir,
        input: `${paths.join('\n')}\n`,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      // hash-object fails the whole batch if any path is missing, so a short
      // result means the pairing is unreliable — drop it rather than mis-map.
      if (out.length === paths.length) {
        paths.forEach((rel, i) => hashes.set(rel, out[i] as string));
      }
    } catch {
      // Nothing hashed → nothing excluded → we commit everything, as before.
    }
    return hashes;
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
  private async linkNodeModules(worktreePath: string): Promise<void> {
    const copyTree = async (src: string, dst: string): Promise<void> => {
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
          await sh(cmd);
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

    const tryLink = async (subdir: string): Promise<void> => {
      const src = join(this.repoRoot, subdir, 'node_modules');
      if (!existsSync(src)) return;
      const dst = join(worktreePath, subdir, 'node_modules');
      if (existsSync(dst)) return;
      mkdirSync(dirname(dst), { recursive: true });
      await copyTree(src, dst);
    };

    await tryLink('.');
    // Walk one level — packages/* and examples/* commonly have their own.
    for (const top of ['packages', 'examples', 'apps']) {
      const topPath = join(this.repoRoot, top);
      if (!existsSync(topPath)) continue;
      try {
        const entries = readdirSync(topPath, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory()) await tryLink(join(top, ent.name));
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
/**
 * Run a shell command and resolve with its stdout.
 *
 * The spawn path uses this rather than `execSync` because the daemon is
 * single-threaded: a synchronous `git clone` or a 20k-file copy freezes every
 * WebSocket event, every other request, and the whole overlay for as long as it
 * runs. The user-initiated paths below (ship, merge, PR) are still sync — they
 * are short and already behind an explicit click.
 */
function sh(cmd: string, opts: { cwd?: string; input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c) => {
      out += String(c);
    });
    child.stderr?.on('data', (c) => {
      err += String(c);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `command failed (exit ${code}): ${cmd}`));
    });
    child.stdin?.end(opts.input ?? '');
  });
}

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
