import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeSubscriptionLoggedIn, codexChatgptLoggedIn } from './credentials';

export type AuthSource = 'flag' | 'env' | 'config' | 'oauth' | 'missing';

/** How a provider authenticates: a pay-per-use API key, a subscription login, or nothing. */
export type AuthMethod = 'api-key' | 'oauth' | 'none';

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
  return join(repoRoot, '.localagents', 'config.json');
}

function readConfig(repoRoot: string): ConfigShape {
  const p = configPath(repoRoot);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as ConfigShape;
    return parsed ?? {};
  } catch {
    return {};
  }
}

/**
 * Merge a partial update into `.localagents/config.json`. A key whose value is
 * `undefined` is removed from the stored config.
 */
export function writeConfig(
  repoRoot: string,
  patch: { [K in keyof ConfigShape]?: ConfigShape[K] | undefined },
): void {
  const dir = join(repoRoot, '.localagents');
  mkdirSync(dir, { recursive: true });
  const next: ConfigShape = { ...readConfig(repoRoot) };
  for (const [key, value] of Object.entries(patch) as [keyof ConfigShape, unknown][]) {
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  writeFileSync(configPath(repoRoot), JSON.stringify(next, null, 2));
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
