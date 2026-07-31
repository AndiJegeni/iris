import { execSync, spawn } from 'node:child_process';
import type { ProviderAuth } from '../auth';
import { authFailureMessage, isAuthError } from '../auth-errors';
import { commandExists } from '../util';
import { buildFollowUpPrompt, buildPrompt } from './prompt';
import type { AgentRunner, RunEvent, RunRequest } from './types';

const STDOUT_LOG_PREFIX_MAX = 320;
/** How much of codex's stderr we keep around to classify a failed exit. */
const STDERR_TAIL_MAX = 4000;

/**
 * OpenAI Codex CLI wrapper. Codex has no programmatic SDK, so we treat it as
 * a black-box subprocess: spawn `codex exec <prompt>` in the worktree, stream
 * stdout/stderr as log events, and infer success from exit code + `git status`.
 *
 * Follow-ups: codex owns its session store and we don't read it, so we don't
 * resume — the earlier conversation is replayed into the prompt (see
 * buildFollowUpPrompt). Costs tokens on long threads, but a follow-up that
 * silently forgets the task is worse.
 *
 * Auth: codex manages its own credentials. For a ChatGPT subscription login
 * (`codex login`) we let it read its cached ~/.codex/auth.json — and we strip
 * OPENAI_API_KEY from the child env so an inherited key can't override the
 * subscription. For API-key auth we pass OPENAI_API_KEY through instead.
 */
export function createCodexRunner(auth: ProviderAuth): AgentRunner {
  return async function* codexRunner(req: RunRequest): AsyncGenerator<RunEvent> {
    if (!commandExists('codex')) {
      yield {
        kind: 'error',
        message:
          'codex CLI not found on PATH. Install with `npm install -g @openai/codex` and retry.',
      };
      return;
    }
    if (auth.method === 'none') {
      yield {
        kind: 'error',
        message: 'Codex not configured. Log in with ChatGPT or set an API key in Settings.',
      };
      return;
    }

    yield { kind: 'status', status: 'running' };

    const childEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    // biome-ignore lint/performance/noDelete: must remove the var from the child env entirely so an inherited key can't override the ChatGPT subscription login; re-added below only for api-key auth.
    delete childEnv.OPENAI_API_KEY;
    if (auth.method === 'api-key' && auth.apiKey) {
      childEnv.OPENAI_API_KEY = auth.apiKey;
    }

    // `codex exec` starts a fresh session every time and we never capture its
    // session id, so a follow-up would otherwise arrive with no memory of the
    // turn it is continuing. Replay the conversation into the prompt instead.
    const prompt = req.priorTranscript?.length ? buildFollowUpPrompt(req) : buildPrompt(req);
    const proc = spawn('codex', ['exec', prompt], {
      cwd: req.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Drive an async queue between event handlers and the generator loop.
    const queue: RunEvent[] = [];
    let resolveWait: (() => void) | null = null;
    const wake = () => {
      const r = resolveWait;
      resolveWait = null;
      if (r) r();
    };

    let exitCode: number | null = null;
    // Codex reports its own failures (auth included) on stderr and just exits
    // non-zero, so we keep a stderr tail to classify the exit against. Only
    // stderr: stdout is the agent's own chatter, and an agent working on auth
    // code prints "401" all day — classifying that would report a perfectly
    // good account as expired.
    let stderrTail = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk
        .toString('utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        queue.push({ kind: 'log', line: line.slice(0, STDOUT_LOG_PREFIX_MAX) });
      }
      if (lines.length > 0) wake();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        stderrTail = `${stderrTail}${text}\n`.slice(-STDERR_TAIL_MAX);
        queue.push({ kind: 'log', line: `[stderr] ${text.slice(0, STDOUT_LOG_PREFIX_MAX)}` });
        wake();
      }
    });
    proc.on('exit', (code) => {
      exitCode = code ?? -1;
      wake();
    });
    proc.on('error', (err) => {
      queue.push({ kind: 'error', message: err.message });
      exitCode = -1;
      wake();
    });

    const onAbort = () => {
      if (proc.exitCode === null) proc.kill('SIGTERM');
    };
    req.signal.addEventListener('abort', onAbort);

    try {
      while (true) {
        if (queue.length > 0) {
          const ev = queue.shift();
          if (!ev) continue;
          yield ev;
          if (ev.kind === 'error') return;
          continue;
        }
        if (exitCode !== null) break;
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }

    // Detect file changes via `git status --porcelain` in the worktree.
    let changedCount = 0;
    try {
      const status = execSync('git status --porcelain', { cwd: req.cwd, encoding: 'utf-8' });
      changedCount = status.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
      // ignore — git may be unavailable; we still report exit-based status
    }

    if (exitCode === 0) {
      yield {
        kind: 'done',
        summary:
          changedCount > 0
            ? `Edited ${changedCount} file(s)`
            : 'codex exited cleanly but reported no changes',
      };
    } else if (isAuthError(stderrTail)) {
      yield { kind: 'needs-auth', message: authFailureMessage('codex', auth.method) };
    } else {
      yield { kind: 'error', message: `codex exited with code ${exitCode}` };
    }
  };
}
