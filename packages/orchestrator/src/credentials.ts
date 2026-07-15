import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Subscription-login detection for the agent CLIs.
 *
 * Both providers own their own credential stores, so we never persist tokens
 * ourselves — we only *detect* whether a subscription login is present and let
 * each CLI/SDK read its own session:
 *
 * Anthropic: the Claude Code login (`claude auth login`) is cached by the
 * `claude` CLI (macOS Keychain, service "Claude Code-credentials"). The Agent
 * SDK bundles the Claude Code binary and reads that session itself — so as long
 * as ANTHROPIC_API_KEY is unset, `query()` authenticates via the subscription.
 * We detect it with `claude auth status --json`.
 *
 * OpenAI/Codex: the `codex` CLI owns ~/.codex/auth.json; we detect a ChatGPT
 * login from `auth_mode: "chatgpt"`.
 */

/**
 * Whether the `claude` CLI has a Claude *subscription* login cached (as opposed
 * to Console API-key auth). Runs `claude auth status --json` and checks for a
 * logged-in first-party claude.ai session. Returns false if the CLI is missing
 * or not logged in.
 *
 * CAUTION — this proves a login *record* exists, not that it still works.
 * `claude auth status` keeps reporting `loggedIn: true, authMethod: "claude.ai"`
 * for a session whose OAuth token has expired past refresh, while every real
 * call 401s. Never present this as a verified session on its own: the daemon
 * marks a provider expired when a run is actually rejected (see auth-errors.ts).
 */
export function claudeSubscriptionLoggedIn(): boolean {
  try {
    const out = execFileSync('claude', ['auth', 'status', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const parsed = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string };
    return parsed?.loggedIn === true && parsed?.authMethod === 'claude.ai';
  } catch {
    return false;
  }
}

/** Resolve Codex's config home (CODEX_HOME or ~/.codex). */
export function codexHome(): string {
  return process.env.CODEX_HOME && process.env.CODEX_HOME.length > 0
    ? process.env.CODEX_HOME
    : join(homedir(), '.codex');
}

/**
 * Whether the `codex` CLI has a ChatGPT subscription login cached. Codex writes
 * `auth.json` with `auth_mode: "chatgpt"` and a `tokens` object; we treat either
 * signal as "logged in". (Keyring-backed stores aren't detectable from here; the
 * file store is Codex's default.)
 */
export function codexChatgptLoggedIn(): boolean {
  try {
    const p = join(codexHome(), 'auth.json');
    if (!existsSync(p)) return false;
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as {
      auth_mode?: string;
      tokens?: { access_token?: string };
    };
    return parsed?.auth_mode === 'chatgpt' || Boolean(parsed?.tokens?.access_token);
  } catch {
    return false;
  }
}
