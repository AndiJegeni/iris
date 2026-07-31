import type { Backend } from '@iris/shared';
import type { AuthMethod } from './auth';

/**
 * Recognising "this run died because the credential is bad", so the UI can say
 * "log in again" instead of surfacing a raw 401.
 *
 * This is the *authoritative* auth signal. The cached records the CLIs expose
 * (`claude auth status --json`, `~/.codex/auth.json`) only prove a login once
 * happened — `claude auth status` keeps reporting
 * `loggedIn: true, authMethod: "claude.ai"` for a session whose OAuth token has
 * expired and can no longer be refreshed, while every actual call fails. So we
 * treat a real call's failure as the truth and let it override the record.
 */

/**
 * Patterns from the shapes an expired/rejected credential actually produces:
 * the Agent SDK throws `401 Invalid authentication credentials` or
 * `OAuth session expired and could not be refreshed`; the claude CLI prints
 * `Not logged in · Please run /login`; codex reports a 401 or tells you to run
 * `codex login`.
 *
 * A bare `401` is deliberately NOT enough. Agents print that number for
 * innocent reasons — a task about auth code discusses 401s constantly — and a
 * false positive here wrongly reports the user's account as expired. So a
 * status code only counts next to something that makes it an auth failure.
 */
const AUTH_ERROR_PATTERNS: RegExp[] = [
  /invalid authentication credentials/i,
  /invalid[ _-]?x[ _-]?api[ _-]?key/i,
  /authentication[_ ]error/i,
  /\bunauthorized\b/i,
  /(?:oauth |session |token )(?:[^.\n]{0,20})?expired/i,
  /could not be refreshed/i,
  /not (?:logged in|authenticated)/i,
  /(?:please )?(?:run|use) `?(?:\/login|claude auth login|codex login)`?/i,
  // A 401/403 sitting next to auth language, in either order …
  /\b(?:401|403)\b[^\n]{0,40}(?:unauthor|forbidden|invalid|auth|credential|token|api[ _-]?key|login)/i,
  /(?:unauthor|forbidden|invalid|auth|credential|token|api[ _-]?key|login)[^\n]{0,40}\b(?:401|403)\b/i,
  // … or reported as an HTTP status ("API Error: 401", "status code 401").
  /(?:error|status(?:\s*code)?|http\S*)\W{0,3}\b(?:401|403)\b/i,
];

/** Whether an agent's failure text indicates a bad/expired credential. */
export function isAuthError(text: string): boolean {
  if (!text) return false;
  return AUTH_ERROR_PATTERNS.some((re) => re.test(text));
}

/** Provider that owns a backend's credentials ('echo' has none). */
export function backendProvider(backend: Backend): 'anthropic' | 'openai' | null {
  if (backend === 'claude') return 'anthropic';
  if (backend === 'codex') return 'openai';
  return null;
}

/**
 * What the user is told when a run fails on auth: which credential broke, and
 * the one action that fixes it.
 */
export function authFailureMessage(backend: Backend, method: AuthMethod): string {
  const inSettings = 'Open Settings › Accounts to reconnect.';
  if (backend === 'codex') {
    return method === 'api-key'
      ? `OpenAI rejected the API key. ${inSettings}`
      : `ChatGPT session expired — log in again. ${inSettings}`;
  }
  return method === 'api-key'
    ? `Anthropic rejected the API key. ${inSettings}`
    : `Claude subscription session expired — log in again. ${inSettings}`;
}
