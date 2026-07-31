import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Env var carrying the resolved executable from the daemon to the agent worker
 * (a separate process — see agents/claude.ts).
 */
export const CLAUDE_BINARY_ENV = 'IRIS_CLAUDE_BINARY';

export type ClaudeBinary =
  | { kind: 'borrowed'; path: string; version: string }
  | { kind: 'bundled'; reason: string };

/** `2.1.152 (Claude Code)` → `2.1.152` */
function parseVersion(raw: string): string | null {
  const m = raw.trim().match(/(\d+\.\d+\.\d+)/);
  return m?.[1] ?? null;
}

/** Two versions are compatible when major and minor agree; patch may drift. */
function sameMajorMinor(a: string, b: string): boolean {
  const [aMaj, aMin] = a.split('.');
  const [bMaj, bMin] = b.split('.');
  return aMaj === bMaj && aMin === bMin;
}

/**
 * The Claude Code version this SDK build expects, read from its own manifest.
 * Returns null if the field is missing — in which case we don't second-guess
 * whatever binary the user has.
 */
function sdkExpectedVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    // The SDK's `exports` map doesn't expose ./package.json, so requiring it
    // directly throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the main entry
    // instead and read the manifest sitting next to it.
    const entry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const pkg = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
      claudeCodeVersion?: string;
    };
    return pkg.claudeCodeVersion ?? null;
  } catch {
    return null;
  }
}

/**
 * Prefer the `claude` already on the user's PATH over the one vendored inside
 * `@anthropic-ai/claude-agent-sdk`.
 *
 * What this does NOT do: save the download. The SDK declares its platform
 * executable as an optionalDependency (~74 MB compressed, ~255 MB unpacked),
 * so npm fetches the matching one at install time no matter which binary we
 * later run. Only dropping the SDK — shelling out to
 * `claude -p --output-format stream-json`, as the codex backend already does —
 * would remove that weight.
 *
 * What it does do: run the same Claude Code the user runs, so their version,
 * settings, and plugins are the ones in play, instead of a second copy that
 * happens to be pinned inside a transitive dependency.
 *
 * Falls back to the vendored copy whenever the local one is missing, unusable,
 * or a different major.minor than the SDK expects — a mismatch is better caught
 * here than halfway through a run.
 */
export function resolveClaudeBinary(): ClaudeBinary {
  let path: string;
  try {
    path = execFileSync('which', ['claude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return { kind: 'bundled', reason: 'no `claude` on PATH' };
  }
  if (!path) return { kind: 'bundled', reason: 'no `claude` on PATH' };

  let version: string | null;
  try {
    version = parseVersion(
      execFileSync(path, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      }),
    );
  } catch {
    return { kind: 'bundled', reason: '`claude --version` failed' };
  }
  if (!version) return { kind: 'bundled', reason: 'could not read `claude --version`' };

  const expected = sdkExpectedVersion();
  if (expected && !sameMajorMinor(version, expected)) {
    return {
      kind: 'bundled',
      reason: `local claude ${version} != SDK's ${expected}`,
    };
  }

  return { kind: 'borrowed', path, version };
}

/** One-line summary for the startup banner. */
export function describeClaudeBinary(bin: ClaudeBinary): string {
  return bin.kind === 'borrowed'
    ? `claude ${bin.version} (${bin.path})`
    : `bundled (${bin.reason})`;
}
