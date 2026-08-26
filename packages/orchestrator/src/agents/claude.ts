import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ProviderAuth } from '../auth';
import { authFailureMessage } from '../auth-errors';
import { CLAUDE_BINARY_ENV, type ClaudeBinary } from '../claude-binary';
import { imagesAppendix, stageImages } from './images';
import { buildPrompt } from './prompt';
import { type AgentRunner, LineBuffer, type RunEvent, type RunRequest } from './types';

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
export function createClaudeRunner(auth: ProviderAuth, claudeBinary?: ClaudeBinary): AgentRunner {
  return async function* claudeRunner(req: RunRequest): AsyncGenerator<RunEvent> {
    if (auth.method === 'none') {
      yield {
        kind: 'error',
        message:
          'Claude not configured. Log in with your Claude subscription or set an API key in Settings.',
      };
      return;
    }

    yield { kind: 'status', status: 'running' };

    // Base env, minus both credential vars. For 'oauth' we set NEITHER and let
    // the Claude Code binary read the user's cached `claude auth login`
    // subscription session; for 'api-key' we set exactly the key. Stripping
    // ANTHROPIC_API_KEY is essential either way — it out-precedences the
    // subscription session, so an inherited key would silently override it.
    const childEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    // biome-ignore lint/performance/noDelete: must remove the var from the child env entirely; setting it to undefined would still leak an inherited credential into the spawn.
    delete childEnv.ANTHROPIC_API_KEY;
    // biome-ignore lint/performance/noDelete: never forward a stray OAuth token; the session is read from the CLI's own store, not env.
    delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
    // CRITICAL: override PWD. Claude Code resolves the project dir from $PWD,
    // not process.cwd(). The daemon inherited PWD=<main repo> from the shell
    // that started it; without this override every worktree task would edit
    // main. (OLDPWD cleared for good measure.)
    childEnv.PWD = req.cwd;
    childEnv.OLDPWD = req.cwd;
    if (auth.method === 'api-key' && auth.apiKey) {
      childEnv.ANTHROPIC_API_KEY = auth.apiKey;
    }
    // Point the SDK at the user's own Claude Code install when we resolved one,
    // so runs use the version and settings they already have; absent this the
    // SDK falls back to the copy vendored in its platform package.
    if (claudeBinary?.kind === 'borrowed') {
      childEnv[CLAUDE_BINARY_ENV] = claudeBinary.path;
    }

    const proc = spawn(WORKER_CMD, [WORKER_PATH], {
      cwd: req.cwd, // ← the worktree; becomes the worker's process.cwd()
      env: childEnv,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Send the prompt (+ optional resume session id for follow-ups). stdin is
    // NOT closed: it stays open as a JSON-lines channel so an answer to a
    // question the agent asks can reach the live process (see claude-worker.ts).
    // On a follow-up turn the prompt is the raw user message — the worktree
    // context was already established by the original run's session.
    let workerPrompt = req.resumeSessionId ? req.prompt : buildPrompt(req);
    // Attached screenshots ride along as staged files the agent Reads. Every
    // run, resumed or fresh: the queue replaces `images` with each turn's own
    // attachments, so whatever is here belongs to exactly this message.
    // Best-effort: a full disk shouldn't kill the run, just the attachments.
    if (req.images.length > 0) {
      try {
        workerPrompt += imagesAppendix(await stageImages(req.images));
      } catch (err) {
        yield { kind: 'log', line: `[images] failed to stage attachments: ${String(err)}` };
      }
    }
    proc.stdin?.write(
      `${JSON.stringify({
        prompt: workerPrompt,
        ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
        ...(req.model ? { model: req.model } : {}),
        ...(req.effort ? { effort: req.effort } : {}),
        ...(req.bypass ? { bypass: true } : {}),
      })}\n`,
    );

    // Answers travel the other way down the same pipe. Installed for as long as
    // the child can still take one and torn down in the `finally` below, so a
    // click that lands after the run ends is dropped by the queue rather than
    // written into a closed stream.
    const channel = req.answers;
    if (channel) {
      channel.deliver = (answer) => {
        try {
          proc.stdin?.write(`${JSON.stringify({ type: 'answer', ...answer })}\n`);
        } catch {
          // child already gone; the run is unwinding anyway
        }
      };
    }

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
    const stdout = new LineBuffer();

    const pushLine = (line: string) => {
      const ev = parseEvent(line);
      if (ev) queue.push(ev);
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of stdout.push(chunk)) pushLine(line);
      wake();
    });
    proc.on('close', (code) => {
      for (const line of stdout.flush()) pushLine(line);
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
            // mapEvent rewrites a raw 'needs-auth' into the action that fixes it.
            yield* mapEvent(ev, auth);
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
      if (channel) channel.deliver = null;
      try {
        proc.stdin?.end();
      } catch {
        // already closed with the process
      }
    }
  };
}

/**
 * The worker only knows *that* auth failed; the runner knows *how* the user
 * authenticated, so it rewrites the raw 401 into the action that fixes it —
 * keeping the provider's own wording as a log line for debugging.
 */
function* mapEvent(ev: RunEvent, auth: ProviderAuth): Generator<RunEvent> {
  if (ev.kind === 'needs-auth') {
    yield { kind: 'log', line: `[auth] ${ev.message}` };
    yield { kind: 'needs-auth', message: authFailureMessage('claude', auth.method) };
    return;
  }
  yield ev;
}

function parseEvent(line: string): RunEvent | null {
  try {
    return JSON.parse(line) as RunEvent;
  } catch {
    return null;
  }
}
