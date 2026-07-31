import { spawn } from 'node:child_process';
import { commandExists } from './util';

/**
 * Interactive subscription-login flows. Both delegate to the official CLIs,
 * which open the user's browser for OAuth and persist the session themselves —
 * we never capture or store a token. We just spawn the flow and wait for exit:
 *   - `claude auth login --claudeai` signs into the Claude subscription via a
 *     browser localhost-redirect (no stdin paste-back). The Agent SDK then reads
 *     that cached session, so unsetting ANTHROPIC_API_KEY routes calls through it.
 *   - `codex login` completes the ChatGPT OAuth flow and writes ~/.codex/auth.json.
 *
 * The daemon runs locally on the user's machine, so spawning a browser-opening
 * CLI works. We give each flow a generous timeout in case the browser leg
 * stalls. Note that these commands are the CLIs' own login flows: the session
 * belongs to the CLI, lives wherever it already keeps it, and Iris holds no
 * credential of its own for either provider.
 */

export type LoginResult = { ok: boolean; error?: string };

const LOGIN_TIMEOUT_MS = 180_000;

/**
 * Spawn a browser-opening CLI login and resolve when it exits. We never read its
 * output for secrets — the CLI persists its own session — so exit code 0 is
 * success. stdin is ignored (these flows use a browser localhost-redirect, not a
 * terminal prompt).
 */
function runLogin(cmd: string, args: string[]): Promise<LoginResult> {
  return new Promise<LoginResult>((resolveResult) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let out = '';

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
      resolveResult({
        ok: false,
        error: 'Login timed out. Complete the browser authorization and try again.',
      });
    }, LOGIN_TIMEOUT_MS);

    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf-8');
    });
    proc.stderr?.on('data', (d: Buffer) => {
      err += d.toString('utf-8');
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolveResult({ ok: false, error: e.message });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveResult({ ok: true });
        return;
      }
      resolveResult({
        ok: false,
        error: `${cmd} ${args[0]} exited with code ${code}. ${(err || out).trim().slice(0, 200)}`,
      });
    });
  });
}

/**
 * Sign into the Claude subscription via `claude auth login --claudeai` (browser
 * OAuth). The `claude` CLI caches the session; the Agent SDK reads it directly,
 * so no token capture is needed on our side.
 */
export async function loginAnthropic(): Promise<LoginResult> {
  if (!commandExists('claude')) {
    return {
      ok: false,
      error:
        'claude CLI not found on PATH. Install with `npm install -g @anthropic-ai/claude-code`.',
    };
  }
  return runLogin('claude', ['auth', 'login', '--claudeai']);
}

export async function logoutAnthropic(): Promise<LoginResult> {
  if (!commandExists('claude')) return { ok: true };
  return new Promise<LoginResult>((resolveResult) => {
    const proc = spawn('claude', ['auth', 'logout'], { stdio: 'ignore' });
    proc.on('error', (e) => resolveResult({ ok: false, error: e.message }));
    proc.on('exit', () => resolveResult({ ok: true }));
  });
}

/**
 * Run `codex login` (browser ChatGPT OAuth). Codex persists the result itself,
 * so we just wait for a clean exit.
 */
export async function loginOpenai(): Promise<LoginResult> {
  if (!commandExists('codex')) {
    return {
      ok: false,
      error: 'codex CLI not found on PATH. Install with `npm install -g @openai/codex`.',
    };
  }
  return runLogin('codex', ['login']);
}

export async function logoutOpenai(): Promise<LoginResult> {
  if (!commandExists('codex')) return { ok: true };
  return new Promise<LoginResult>((resolveResult) => {
    const proc = spawn('codex', ['logout'], { stdio: 'ignore' });
    proc.on('error', (e) => resolveResult({ ok: false, error: e.message }));
    proc.on('exit', () => resolveResult({ ok: true }));
  });
}
