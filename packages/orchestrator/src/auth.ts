import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthMethod } from '@iris/shared';
import { claudeSubscriptionLoggedIn, codexChatgptLoggedIn } from './credentials';

export type { AuthMethod };

export type AuthSource = 'flag' | 'env' | 'config' | 'oauth' | 'missing';

export type ProviderAuth = {
  method: AuthMethod;
  /** The API key, when method === 'api-key'. */
  apiKey: string | null;
  /**
   * The subscription OAuth token, when method === 'oauth'. Only Anthropic
   * stores one here (CLAUDE_CODE_OAUTH_TOKEN); for OpenAI the `codex` CLI owns
   * its own token store, so this stays null even when logged in.
   */
  oauthToken: string | null;
  source: AuthSource;
};

export type AuthState = {
  anthropic: ProviderAuth;
  openai: ProviderAuth;
};

export type ResolveAuthOptions = {
  repoRoot: string;
  flagAnthropic?: string | undefined;
  flagOpenai?: string | undefined;
};

type ConfigShape = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** User's chosen auth method per provider; set when they log in or save a key. */
  anthropicAuthMethod?: AuthMethod;
  openaiAuthMethod?: AuthMethod;
};

function configPath(repoRoot: string): string {
  return join(repoRoot, '.iris', 'config.json');
}

/**
 * Pre-rename config location. Read-only: we never write here, but honouring it
 * means anyone who configured a key under the old name keeps working after
 * upgrading instead of silently reverting to "not configured".
 */
function legacyConfigPath(repoRoot: string): string {
  return join(repoRoot, '.localagents', 'config.json');
}

function readConfig(repoRoot: string): ConfigShape {
  const p = existsSync(configPath(repoRoot)) ? configPath(repoRoot) : legacyConfigPath(repoRoot);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as ConfigShape;
    return parsed ?? {};
  } catch {
    return {};
  }
}

/**
 * Drop a `*` .gitignore inside `.iris/` so the directory ignores itself in the
 * user's repo. This config can hold an API key, and it lands in whatever
 * project Iris was pointed at — a project whose .gitignore we don't control and
 * shouldn't edit. Self-ignoring covers every entry point (including a user who
 * never ran `iris init`) without touching a file they own.
 */
function ignoreSelf(dir: string): void {
  const p = join(dir, '.gitignore');
  if (existsSync(p)) return;
  try {
    writeFileSync(p, '*\n');
  } catch {
    // Best-effort: a key that isn't ignored is still usable, and failing the
    // write here would break saving credentials entirely.
  }
}

/**
 * Merge a partial update into `.iris/config.json`. A key whose value is
 * `undefined` is removed from the stored config. Always writes to the current
 * path — the first write migrates a legacy config forward, since readConfig()
 * seeds the merge from whichever file exists.
 *
 * The file can hold API keys, so it is owner-only (0600 in a 0700 directory).
 * The modes are set explicitly rather than left to the umask, and re-applied on
 * every write so a file created before this was enforced gets tightened too.
 */
export function writeConfig(
  repoRoot: string,
  patch: { [K in keyof ConfigShape]?: ConfigShape[K] | undefined },
): void {
  const dir = join(repoRoot, '.iris');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  ignoreSelf(dir);
  const next: ConfigShape = { ...readConfig(repoRoot) };
  for (const [key, value] of Object.entries(patch) as [keyof ConfigShape, unknown][]) {
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  const p = configPath(repoRoot);
  writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies when it creates the file; an existing one
  // keeps its old permissions, so tighten it unconditionally.
  chmodSync(p, 0o600);
}

/**
 * Resolve the active auth method for a provider given the available
 * credentials and the user's stored preference. The preference wins when its
 * credential is present (so logging in deliberately ignores a leftover API key
 * — avoiding Anthropic's "API key silently overrides OAuth" precedence trap).
 * Otherwise we fall back to whatever credential exists, preferring a
 * subscription login.
 */
function pickMethod(
  preference: AuthMethod | undefined,
  hasOauth: boolean,
  hasApiKey: boolean,
): AuthMethod {
  if (preference === 'oauth' && hasOauth) return 'oauth';
  if (preference === 'api-key' && hasApiKey) return 'api-key';
  if (hasOauth) return 'oauth';
  if (hasApiKey) return 'api-key';
  return 'none';
}

/**
 * Pick the highest-precedence non-empty API key from flag → env → config.
 * Empty/whitespace strings count as absent (a stray `export ANTHROPIC_API_KEY=`
 * must not mask a real key in config), which a plain `??` chain wouldn't catch.
 */
function resolveApiKey(
  flag: string | undefined,
  env: string | undefined,
  config: string | undefined,
): { value: string | null; source: AuthSource } {
  if (flag?.trim()) return { value: flag, source: 'flag' };
  if (env?.trim()) return { value: env, source: 'env' };
  if (config?.trim()) return { value: config, source: 'config' };
  return { value: null, source: 'missing' };
}

export function resolveAuth(opts: ResolveAuthOptions): AuthState {
  const config = readConfig(opts.repoRoot);

  // Anthropic: API key from flag/env/config; subscription login owned by the
  // claude CLI (the Agent SDK reads its cached session — we only detect it).
  const { value: anthropicKey, source: anthropicKeySource } = resolveApiKey(
    opts.flagAnthropic,
    process.env.ANTHROPIC_API_KEY,
    config.anthropicApiKey,
  );
  const anthropicOAuth = claudeSubscriptionLoggedIn();
  const anthropicMethod = pickMethod(
    config.anthropicAuthMethod,
    anthropicOAuth,
    Boolean(anthropicKey),
  );

  // OpenAI: API key from flag/env/config, subscription login owned by codex CLI.
  const { value: openaiKey, source: openaiKeySource } = resolveApiKey(
    opts.flagOpenai,
    process.env.OPENAI_API_KEY,
    config.openaiApiKey,
  );
  const openaiOAuth = codexChatgptLoggedIn();
  const openaiMethod = pickMethod(config.openaiAuthMethod, openaiOAuth, Boolean(openaiKey));

  return {
    anthropic: {
      method: anthropicMethod,
      apiKey: anthropicMethod === 'api-key' ? anthropicKey : null,
      // No token to carry: the SDK reads the claude CLI's cached session itself.
      oauthToken: null,
      source: anthropicMethod === 'oauth' ? 'oauth' : anthropicKeySource,
    },
    openai: {
      method: openaiMethod,
      apiKey: openaiMethod === 'api-key' ? openaiKey : null,
      oauthToken: null,
      source: openaiMethod === 'oauth' ? 'oauth' : openaiKeySource,
    },
  };
}
