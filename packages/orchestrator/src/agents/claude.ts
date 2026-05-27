import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner, RunEvent, RunRequest } from './types';

/**
 * Compose the prompt the agent sees from the user's annotation.
 * Structure: short context block, then the user's literal prompt.
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

  const header = ctx.length > 0 ? `Context (auto-captured from the browser):\n${ctx.map((l) => `  ${l}`).join('\n')}\n\n` : '';
  return `${header}User request:\n${req.prompt}`;
}

/**
 * Drive a single Claude Code session via the Agent SDK.
 *
 * Auth: `ANTHROPIC_API_KEY` must be in `process.env` when the daemon starts.
 *       The SDK does NOT inherit from a logged-in Claude Code CLI install.
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

    // SDK reads from process.env, not from a passed param. Make sure it's set.
    process.env.ANTHROPIC_API_KEY = env.anthropicKey;

    yield { kind: 'status', status: 'running' };

    const prompt = buildPrompt(req);

    try {
      const iter = query({
        prompt,
        options: {
          cwd: req.cwd,
          // Allow file edits + reads + a permissive bash. The user has already
          // consented by running the daemon.
          allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
          // Keep the loop bounded.
          maxTurns: 25,
        },
      });

      let editedFiles = new Set<string>();
      let lastSummary: string | undefined;

      for await (const message of iter) {
        if (req.signal.aborted) {
          yield { kind: 'error', message: 'cancelled' };
          return;
        }
        const event = translateSdkMessage(message, editedFiles);
        if (event) yield event;
        // Capture assistant text for summary if present
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'result'
        ) {
          // biome-ignore lint/suspicious/noExplicitAny: SDK message shape
          const m = message as any;
          lastSummary = m.result ?? m.summary;
        }
      }

      yield {
        kind: 'done',
        summary: lastSummary ?? (editedFiles.size > 0 ? `Edited ${editedFiles.size} file(s)` : 'No changes'),
      };
    } catch (err) {
      yield {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

/**
 * Map an SDK message to one of our RunEvents.
 * The SDK's message shape is evolving (`SDKAssistantMessage`, `SDKToolProgressMessage`,
 * `SDKResultMessage`, etc.). We pattern-match on the discriminator and emit
 * a coarse-grained event the overlay can render.
 */
function translateSdkMessage(
  // biome-ignore lint/suspicious/noExplicitAny: SDK message shape
  message: any,
  editedFiles: Set<string>,
): RunEvent | null {
  if (!message || typeof message !== 'object') return null;
  const type = message.type;

  // Assistant text (model output we want to stream as log lines)
  if (type === 'assistant') {
    const text = extractAssistantText(message);
    if (text) return { kind: 'log', line: text };
    return null;
  }

  // Tool use lifecycle
  if (type === 'tool_use' || type === 'tool_result' || type === 'tool_progress') {
    const name = message.name ?? message.tool_name;
    if (name === 'Edit' || name === 'Write') {
      const file = message.input?.file_path ?? message.input?.path;
      if (file && !editedFiles.has(file)) {
        editedFiles.add(file);
        return { kind: 'edit', file, description: name === 'Write' ? 'wrote' : 'edited' };
      }
    }
    if (name === 'Bash') {
      const cmd = message.input?.command;
      if (cmd) return { kind: 'log', line: `$ ${String(cmd).slice(0, 200)}` };
    }
    if (name) return { kind: 'status', status: 'editing' };
    return null;
  }

  if (type === 'result') {
    return null; // handled separately for summary
  }

  return null;
}

// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
function extractAssistantText(m: any): string | null {
  const content = m?.message?.content ?? m?.content;
  if (!content) return null;
  if (typeof content === 'string') return content.slice(0, 500);
  if (Array.isArray(content)) {
    const text = content
      .filter((c) => c?.type === 'text')
      .map((c) => c.text)
      .join(' ')
      .trim();
    return text ? text.slice(0, 500) : null;
  }
  return null;
}
