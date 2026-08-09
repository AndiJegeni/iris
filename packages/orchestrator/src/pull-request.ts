import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareUrl, isGitHub, parsePrUrl, parseRemoteUrl } from './git-remote';
import { hasGhCli, remoteUrl, resolveRemoteName } from './project';

/**
 * IMPORTANT: everything here is async on purpose.
 *
 * `worktrees.ts` next door is `execSync` throughout, which is fine for local
 * operations that finish in milliseconds. A `git push` talks to the network and
 * can take many seconds — under `execFileSync` that blocks the Node event loop
 * for its whole duration, freezing WebSocket transcript streaming for every
 * other task the daemon is running. Do not "make this consistent" with its
 * neighbour.
 *
 * Using execFile with an argv array (rather than execSync with a command
 * string) also means no shell is involved, so a PR title containing quotes or
 * `$(…)` is inert rather than a command-injection vector.
 */
const exec = promisify(execFile);

/** git push reaches the network; a slow remote shouldn't hang the button forever. */
const PUSH_TIMEOUT_MS = 120_000;
/** gh talks to the GitHub API — slower than local git, faster than a push. */
const GH_TIMEOUT_MS = 60_000;

export type PullRequestOutcome =
  | {
      ok: true;
      /** The branch reached the remote. True even when PR creation itself fell back. */
      pushed: true;
      /** A new PR was opened. False = one already existed, or `url` is a compare page. */
      created: boolean;
      /** PR, existing-PR, or compare URL. Null when we can't name one (non-GitHub host). */
      url: string | null;
      branch: string;
      /** Why we fell back, when we did. */
      note?: string;
    }
  | { ok: false; error: string };

export type OpenPullRequestArgs = {
  /** The user's own repo — where credentials, remotes and `gh` context live. */
  repoRoot: string;
  /** The worktree's standalone clone, which holds the branch we want to publish. */
  clonePath: string;
  branch: string;
  slug: string;
  title?: string | undefined;
  body?: string | undefined;
};

/**
 * Publish a worktree's branch and open a pull request for it.
 *
 * The branch lives in a `git clone --local` whose `origin` is a filesystem path,
 * so it can't be pushed from where it sits. We fetch it into the user's repo
 * under a private `refs/iris/*` namespace and push from there, because that's
 * the working tree where their credential helper, `insteadOf` rewrites and `gh`
 * repo resolution all already work. `refs/iris/*` touches no file, no index and
 * no HEAD, and never shows up in `git branch` or `git status` — the user's
 * checkout is as untouched as if we'd pushed from the clone.
 */
export async function openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestOutcome> {
  const { repoRoot, clonePath, branch, slug } = args;
  const localRef = `refs/iris/${slug}`;

  const remoteName = resolveRemoteName(repoRoot);
  if (!remoteName) {
    return {
      ok: false,
      error: 'no git remote configured — add one with `git remote add origin <url>`',
    };
  }
  const url = remoteUrl(repoRoot, remoteName);
  const remote = url ? parseRemoteUrl(url) : null;

  // 1. Copy the branch out of the clone into a ref only Iris uses.
  try {
    await exec('git', [
      '-C',
      repoRoot,
      'fetch',
      '--no-tags',
      '--force',
      clonePath,
      `+refs/heads/${branch}:${localRef}`,
    ]);
  } catch (err) {
    return { ok: false, error: `could not read ${branch} from the worktree: ${message(err)}` };
  }

  // Read the head commit's subject now — it's the PR title, and the ref it
  // comes from is deleted once the push succeeds.
  const headSubject = await tryExec(['-C', repoRoot, 'log', '-1', '--format=%s', localRef]);

  // 2. Refuse to open an empty PR, when we can tell. `origin/HEAD` is often
  //    unset in a clone (it's set by `git clone`, not by `git remote add`), so
  //    a missing base is normal and simply skips the check rather than failing.
  const base = await tryExec(['-C', repoRoot, 'rev-parse', '--abbrev-ref', `${remoteName}/HEAD`]);
  if (base) {
    const count = await tryExec(['-C', repoRoot, 'rev-list', '--count', `${base}..${localRef}`]);
    if (count === '0') {
      return {
        ok: false,
        error: `nothing to open a PR from — ${branch} has no commits beyond ${base}`,
      };
    }
  }

  // 3. Push by remote NAME so git applies insteadOf rewrites and the repo's own
  //    credential config. No --force: a diverged branch may already be under
  //    review, and silently rewriting it is not a call a button should make.
  try {
    await exec('git', ['-C', repoRoot, 'push', remoteName, `${localRef}:refs/heads/${branch}`], {
      timeout: PUSH_TIMEOUT_MS,
    });
  } catch (err) {
    const detail = message(err);
    if (/non-fast-forward|\[rejected\]|fetch first/i.test(detail)) {
      const diverged = `${branch} on ${remoteName} has diverged from this worktree`;
      return {
        ok: false,
        error: `push rejected — ${diverged}. Resolve it manually, or discard and re-run.`,
      };
    }
    return { ok: false, error: `push failed: ${detail}` };
  }

  // The push updated refs/remotes/<name>/<branch>, so the objects stay reachable
  // without our private ref. Leave it behind on failure — it's what makes a
  // retry cheap.
  await tryExec(['-C', repoRoot, 'update-ref', '-d', localRef]);

  const fallback = (note: string): PullRequestOutcome => ({
    ok: true,
    pushed: true,
    created: false,
    url: remote && isGitHub(remote) ? compareUrl(remote, branch) : null,
    branch,
    note,
  });

  if (!remote || !isGitHub(remote)) {
    return fallback(`pushed ${branch} to ${remoteName} — open a merge request in your git host`);
  }
  if (!hasGhCli()) {
    return fallback(`pushed ${branch} — install the GitHub CLI (\`gh\`) to open PRs from Iris`);
  }

  // 4. An existing PR already tracks this branch; the push just updated it.
  const existing = await tryGh(['pr', 'view', branch, '--json', 'url', '--jq', '.url'], repoRoot);
  if (existing.ok && existing.stdout.trim()) {
    return { ok: true, pushed: true, created: false, url: existing.stdout.trim(), branch };
  }

  // 5. Create it. --base is omitted deliberately: gh reads the repo's real
  //    default branch from the API, which beats anything we can infer locally
  //    (refs/remotes/<name>/HEAD frequently doesn't resolve at all).
  const title = args.title?.trim() || headSubject || `iris: ${slug}`;
  const body = args.body ?? `Opened by Iris from worktree \`${slug}\` (branch \`${branch}\`).`;
  const created = await tryGh(
    ['pr', 'create', '--head', branch, '--title', title, '--body', body],
    repoRoot,
  );
  if (!created.ok) {
    return fallback(`pushed ${branch}, but \`gh pr create\` failed: ${created.error}`);
  }

  return {
    ok: true,
    pushed: true,
    created: true,
    url: parsePrUrl(created.stdout) ?? (remote ? compareUrl(remote, branch) : null),
    branch,
  };
}

/** Run a git command for its stdout, treating any failure as "no answer". */
async function tryExec(argv: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec('git', argv);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Run `gh` in the user's repo. Failures here are never fatal — the push has
 * already landed, which is the valuable half — so this reports rather than throws.
 *
 * `GH_PROMPT_DISABLED` keeps gh from trying to open an interactive prompt (or
 * $EDITOR) on a daemon that has no terminal attached.
 */
async function tryGh(
  argv: string[],
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await exec('gh', argv, {
      cwd,
      timeout: GH_TIMEOUT_MS,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
    });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** execFile rejections carry the child's stderr, which is the part worth showing. */
function message(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  const stderr = typeof e?.stderr === 'string' ? e.stderr.trim() : '';
  return (stderr || e?.message || String(err)).trim();
}
