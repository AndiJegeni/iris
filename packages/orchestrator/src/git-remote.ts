/**
 * Pure parsing helpers for git remote URLs and the URLs derived from them.
 *
 * Deliberately free of side effects: everything that shells out to git or `gh`
 * lives in `pull-request.ts`, so the fiddly string handling below — which is
 * where the bugs actually are — can be unit-tested without a repo or a network.
 *
 * Note we only ever *parse* a remote URL, to learn the owner/repo a PR belongs
 * to. Pushing always goes through the remote's **name** so git can apply the
 * user's `url.<base>.insteadOf` rewrites and repo-local credential config; a
 * URL we reassembled ourselves would quietly bypass both.
 */

export type GitRemote = {
  /** Hostname only, no port or userinfo: "github.com". */
  host: string;
  owner: string;
  repo: string;
};

/** `git@github.com:owner/repo.git` — scp-like syntax, which `new URL()` can't read. */
const SCP_LIKE = /^([^/@]+)@([^:/]+):(.+)$/;

/**
 * Parse a remote URL into host/owner/repo.
 *
 * Handles the four spellings git itself accepts for a hosted repo:
 * `git@host:owner/repo.git`, `ssh://git@host/owner/repo.git`,
 * `https://host/owner/repo(.git)`, and `https://user@host/owner/repo`.
 *
 * Returns null for anything without at least a two-segment path — a local
 * filesystem remote (which is exactly what an Iris clone's `origin` is) has no
 * owner/repo to speak of.
 */
export function parseRemoteUrl(url: string): GitRemote | null {
  const raw = url.trim();
  if (!raw) return null;

  // Normalise scp-like syntax to a real URL so one code path handles both.
  const scp = SCP_LIKE.exec(raw);
  const normalised = scp ? `ssh://${scp[1]}@${scp[2]}/${scp[3]}` : raw;

  let parsed: URL;
  try {
    parsed = new URL(normalised);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  if (segments.length < 2) return null;

  // Take the LAST two segments so GitLab subgroups (owner/sub/repo) still
  // resolve to something usable rather than being rejected outright.
  const repo = segments[segments.length - 1]!.replace(/\.git$/, '');
  const owner = segments[segments.length - 2]!;
  if (!owner || !repo) return null;

  return { host: parsed.hostname, owner, repo };
}

/**
 * True for github.com only. `github.example.com` is a *different* host that
 * happens to share a suffix, and GitHub Enterprise needs `gh` configured with
 * its own hostname anyway — so both take the compare-URL path instead.
 */
export function isGitHub(remote: GitRemote): boolean {
  return remote.host.toLowerCase() === 'github.com';
}

/**
 * GitHub's "open a PR from this branch" page, used when `gh` can't do it for us.
 *
 * The branch is encoded per path segment rather than whole: `la/fix-header` is a
 * path on this route, so its slash has to survive while anything else doesn't.
 */
export function compareUrl(remote: GitRemote, branch: string): string {
  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
  return `https://${remote.host}/${remote.owner}/${remote.repo}/compare/${encodedBranch}?expand=1`;
}

/**
 * Pull the PR URL out of `gh pr create` output. gh prints the URL on its own
 * line, but may precede it with update notices or warnings — so take the last
 * non-empty line and only trust it if it actually looks like a URL.
 */
export function parsePrUrl(stdout: string): string | null {
  const last = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  return last && /^https?:\/\//.test(last) ? last : null;
}
