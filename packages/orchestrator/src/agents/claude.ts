import { fileURLToPath } from 'node:url';
import type { ProviderAuth } from '../auth';
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

const WORKER_PATH = fileURLToPath(new URL('./claude-worker.ts', import.meta.url));

/**
 * Drive a single Claude Code session. Spawns `claude-worker.ts` as a child
 * process with `cwd` = the task's worktree, so the SDK's file edits land in the
 * worktree (the SDK resolves edits against process.cwd(), ignoring its own cwd
 * option — see claude-worker.ts).
 */
export function createClaudeRunner(auth: ProviderAuth): AgentRunner {
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
    // the bundled Claude Code binary read the user's cached `claude auth login`
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

    const proc = Bun.spawn(['bun', WORKER_PATH], {
      cwd: req.cwd, // ← the worktree; becomes the worker's process.cwd()
      env: childEnv,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
    });

    // Send the prompt (+ optional resume session id for follow-ups), then close stdin.
    // On a follow-up turn the prompt is the raw user message — the worktree
    // context was already established by the original run's session.
    const workerPrompt = req.resumeSessionId ? req.prompt : buildPrompt(req);
    proc.stdin.write(
      JSON.stringify({
        prompt: workerPrompt,
        ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
      }),
    );
    proc.stdin.end();

    const onAbort = () => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    };
    req.signal.addEventListener('abort', onAbort);

    try {
      // Read stdout as JSON-lines, yielding each RunEvent.
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            const ev = parseEvent(line);
            if (ev) yield ev;
          }
          nl = buffer.indexOf('\n');
        }
      }
      const tail = buffer.trim();
      if (tail) {
        const ev = parseEvent(tail);
        if (ev) yield ev;
      }

      const code = await proc.exited;
      if (code !== 0 && !req.signal.aborted) {
        yield {
          kind: 'error',
          message: `claude worker exited with code ${code} (see daemon logs)`,
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
