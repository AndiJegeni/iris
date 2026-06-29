import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AgentRunner, RunEvent, RunRequest } from './types';

/**
 * Compose the prompt the agent sees from the user's annotation.
 */
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

// Dev runs this module as `.ts` under Bun; the built daemon runs as `.js` under
// Node. Spawn the matching worker with the matching runtime.
const isBuilt = import.meta.url.endsWith('.js');
const WORKER_PATH = fileURLToPath(
  new URL(isBuilt ? './claude-worker.js' : './claude-worker.ts', import.meta.url),
);
const WORKER_CMD = isBuilt ? process.execPath : 'bun';

/**
 * Drive a single Claude Code session. Spawns the worker as a child process with
 * `cwd` = the task's worktree, so the SDK's file edits land in the worktree (the
 * SDK resolves edits against process.cwd(), ignoring its own cwd option — see
 * claude-worker.ts).
 */
export function createClaudeRunner(env: { anthropicKey: string | null }): AgentRunner {
  return async function* claudeRunner(req: RunRequest): AsyncGenerator<RunEvent> {
    if (!env.anthropicKey) {
      yield {
        kind: 'error',
        message: 'ANTHROPIC_API_KEY not configured. Set the env var or pass --anthropic-key.',
      };
      return;
    }

    yield { kind: 'status', status: 'running' };

    const proc = spawn(WORKER_CMD, [WORKER_PATH], {
      cwd: req.cwd, // ← the worktree; becomes the worker's process.cwd()
      env: {
        ...process.env,
        // CRITICAL: override PWD. Claude Code resolves the project dir from
        // $PWD, not process.cwd(). The daemon inherited PWD=<main repo> from
        // the shell that started it; without this override every worktree task
        // would edit main. (OLDPWD cleared for good measure.)
        PWD: req.cwd,
        OLDPWD: req.cwd,
        ANTHROPIC_API_KEY: env.anthropicKey,
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Send the prompt (+ optional resume session id for follow-ups), then close
    // stdin. On a follow-up turn the prompt is the raw user message — the
    // worktree context was already established by the original run's session.
    const workerPrompt = req.resumeSessionId ? req.prompt : buildPrompt(req);
    proc.stdin?.write(
      JSON.stringify({
        prompt: workerPrompt,
        ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
      }),
    );
    proc.stdin?.end();

    // Bridge stdout 'data' events (JSON-lines) to the generator via a queue.
    const queue: RunEvent[] = [];
    let resolveWait: (() => void) | null = null;
    const wake = () => {
      const r = resolveWait;
      resolveWait = null;
      r?.();
    };
    let exited = false;
    let exitCode: number | null = null;
    let buffer = '';

    const pushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const ev = parseEvent(trimmed);
      if (ev) queue.push(ev);
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        pushLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
      wake();
    });
    proc.on('close', (code) => {
      if (buffer.trim()) pushLine(buffer);
      buffer = '';
      exitCode = code ?? -1;
      exited = true;
      wake();
    });
    proc.on('error', (err) => {
      queue.push({ kind: 'error', message: err.message });
      exitCode = -1;
      exited = true;
      wake();
    });

    const onAbort = () => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    };
    req.signal.addEventListener('abort', onAbort);

    try {
      let sawError = false;
      while (true) {
        if (queue.length > 0) {
          const ev = queue.shift();
          if (ev) {
            if (ev.kind === 'error') sawError = true;
            yield ev;
          }
          continue;
        }
        if (exited) break;
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
      if (!sawError && exitCode !== 0 && !req.signal.aborted) {
        yield {
          kind: 'error',
          message: `claude worker exited with code ${exitCode} (see daemon logs)`,
        };
      }
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  };
}

function parseEvent(line: string): RunEvent | null {
  try {
    return JSON.parse(line) as RunEvent;
  } catch {
    return null;
  }
}
