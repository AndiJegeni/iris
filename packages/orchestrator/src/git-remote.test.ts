import { describe, expect, test } from 'bun:test';
import { compareUrl, isGitHub, parsePrUrl, parseRemoteUrl } from './git-remote';

// Only the pure layer is covered here. `openPullRequest` fetches, pushes, and
// shells out to `gh` — exercising it needs a real repo, a real remote and a
// network, and mocking execFile would only test the mock.

describe('parseRemoteUrl', () => {
  test('reads scp-like ssh syntax', () => {
    expect(parseRemoteUrl('git@github.com:AndiJegeni/iris.git')).toEqual({
      host: 'github.com',
      owner: 'AndiJegeni',
      repo: 'iris',
    });
  });

  test('reads ssh:// urls', () => {
    expect(parseRemoteUrl('ssh://git@github.com/AndiJegeni/iris.git')).toEqual({
      host: 'github.com',
      owner: 'AndiJegeni',
      repo: 'iris',
    });
  });

  test('reads https urls with and without the .git suffix', () => {
    const expected = { host: 'github.com', owner: 'AndiJegeni', repo: 'iris' };
    expect(parseRemoteUrl('https://github.com/AndiJegeni/iris')).toEqual(expected);
    expect(parseRemoteUrl('https://github.com/AndiJegeni/iris.git')).toEqual(expected);
    expect(parseRemoteUrl('https://github.com/AndiJegeni/iris/')).toEqual(expected);
  });

  test('ignores userinfo in https urls', () => {
    expect(parseRemoteUrl('https://user@github.com/AndiJegeni/iris.git')).toEqual({
      host: 'github.com',
      owner: 'AndiJegeni',
      repo: 'iris',
    });
  });

  test('takes the last two segments so gitlab subgroups still resolve', () => {
    expect(parseRemoteUrl('https://gitlab.com/group/sub/project.git')).toEqual({
      host: 'gitlab.com',
      owner: 'sub',
      repo: 'project',
    });
  });

  test('handles non-github hosts', () => {
    expect(parseRemoteUrl('git@bitbucket.org:team/repo.git')).toEqual({
      host: 'bitbucket.org',
      owner: 'team',
      repo: 'repo',
    });
  });

  test('returns null for anything without an owner/repo pair', () => {
    // A local clone's origin is a filesystem path — this is the case that
    // actually occurs, since every Iris worktree is a `git clone --local`.
    expect(parseRemoteUrl('/Users/andi/code/iris')).toBeNull();
    expect(parseRemoteUrl('https://github.com/AndiJegeni')).toBeNull();
    expect(parseRemoteUrl('')).toBeNull();
    expect(parseRemoteUrl('   ')).toBeNull();
  });
});

describe('isGitHub', () => {
  test('github.com is the only match', () => {
    expect(isGitHub({ host: 'github.com', owner: 'o', repo: 'r' })).toBe(true);
    expect(isGitHub({ host: 'GitHub.com', owner: 'o', repo: 'r' })).toBe(true);
  });

  test('a shared suffix is a different host, not enterprise github', () => {
    expect(isGitHub({ host: 'github.example.com', owner: 'o', repo: 'r' })).toBe(false);
    expect(isGitHub({ host: 'gitlab.com', owner: 'o', repo: 'r' })).toBe(false);
  });
});

describe('compareUrl', () => {
  const remote = { host: 'github.com', owner: 'AndiJegeni', repo: 'iris' };

  test("keeps the branch namespace's slash as a path separator", () => {
    expect(compareUrl(remote, 'la/landing-text-blue')).toBe(
      'https://github.com/AndiJegeni/iris/compare/la/landing-text-blue?expand=1',
    );
  });

  test('encodes everything else in the branch name', () => {
    expect(compareUrl(remote, 'la/fix #12')).toBe(
      'https://github.com/AndiJegeni/iris/compare/la/fix%20%2312?expand=1',
    );
  });
});

describe('parsePrUrl', () => {
  test('reads the url gh prints on its own line', () => {
    expect(parsePrUrl('https://github.com/AndiJegeni/iris/pull/7\n')).toBe(
      'https://github.com/AndiJegeni/iris/pull/7',
    );
  });

  test('skips notices gh prints before the url', () => {
    const out = 'A new release of gh is available!\n\nhttps://github.com/o/r/pull/12\n';
    expect(parsePrUrl(out)).toBe('https://github.com/o/r/pull/12');
  });

  test('returns null when the output is not a url', () => {
    expect(parsePrUrl('')).toBeNull();
    expect(parsePrUrl('pull request created')).toBeNull();
  });
});
