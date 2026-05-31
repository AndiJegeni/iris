import { execSync, spawn } from 'node:child_process';
import type { AgentRunner, RunEvent, RunRequest } from './types';

const STDOUT_LOG_PREFIX_MAX = 320;

function buildPrompt(req: RunRequest): string {
  const ctx: string[] = [];
  if (req.source) {
    const col = req.source.column != null ? `:${req.source.column}` : '';
    ctx.push(`File: ${req.source.file}:${req.source.line}${col}`);
  }
  if (req.componentPath.length > 0) {
    ctx.push(`Component path: ${req.componentPath.map((c) => `<${c}/>`).join(' › ')}`);
  }
  if (req.selector) ctx.push(`Selector: ${req.selector}`);
  if (req.text) ctx.push(`Element text: "${req.text}"`);

  const header =
    ctx.length > 0
      ? `Context (auto-captured from the browser):\n${ctx.map((l) => `  ${l}`).join('\n')}\n\n`
      : '';
  return `${header}User request:\n${req.prompt}`;
}

function codexAvailable(): boolean {
  try {
    execSync('command -v codex', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * OpenAI Codex CLI wrapper. Codex has no programmatic SDK, so we treat it as
 * a black-box subprocess: spawn `codex exec <prompt>` in the worktree, stream
 * stdout/stderr as log events, and infer success from exit code + `git status`.
 *
 * Auth: codex reads `OPENAI_API_KEY` from env. We export it before spawning.
 */
export function createCodexRunner(env: { openaiKey: string | null }): AgentRunner {
  return async function* codexRunner(req: RunRequest): AsyncGenerator<RunEvent> {
    if (!codexAvailable()) {
      yield {
        kind: 'error',
        message:
          'codex CLI not found on PATH. Install with `npm install -g @openai/codex` and retry.',
      };
      return;
    }
    if (!env.openaiKey) {
      yield {
        kind: 'error',
        message: 'OPENAI_API_KEY not configured. Set the env var or pass --openai-key.',
      };
      return;
    }

    yield { kind: 'status', status: 'running' };

    const prompt = buildPrompt(req);
    const proc = spawn('codex', ['exec', prompt], {
      cwd: req.cwd,
      env: { ...process.env, OPENAI_API_KEY: env.openaiKey },
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
    } else {
      yield { kind: 'error', message: `codex exited with code ${exitCode}` };
    }
  };
}
