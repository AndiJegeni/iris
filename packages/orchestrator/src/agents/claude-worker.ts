#!/usr/bin/env bun
/**
 * Claude agent worker — runs ONE task in its own process.
 *
 * Why a separate process: the Agent SDK resolves file edits against
 * `process.cwd()`, NOT the `cwd` option passed to `query()`. To isolate a task
 * to its worktree, the parent spawns this script with `Bun.spawn(..., { cwd })`
 * so this process's cwd IS the worktree. Edits then land in the right place,
 * and parallel tasks (each its own process) never clobber each other's cwd.
 *
 * Protocol:
 *   - stdin:  one JSON line `{ prompt: string }`
 *   - stdout: JSON-line RunEvents (`{kind:'log'|'edit'|'status'|'done'|'error', ...}`)
 *   ANTHROPIC_API_KEY is inherited from the spawn env.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';

type RunEvent =
  | { kind: 'status'; status: 'running' | 'editing' }
  | { kind: 'log'; line: string }
  | { kind: 'edit'; file: string; description?: string }
  | { kind: 'done'; summary?: string }
  | { kind: 'error'; message: string };

function emit(ev: RunEvent): void {
  process.stdout.write(`${JSON.stringify(ev)}\n`);
}

async function main(): Promise<void> {
  const input = await Bun.stdin.text();
  let prompt: string;
  try {
    prompt = (JSON.parse(input) as { prompt: string }).prompt;
  } catch {
    emit({ kind: 'error', message: 'worker: invalid input' });
    return;
  }

  try {
    const iter = query({
      prompt,
      options: {
        // process.cwd() is the worktree (set by the parent's Bun.spawn cwd).
        cwd: process.cwd(),
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'bypassPermissions',
        maxTurns: 25,
      },
    });

    const edited = new Set<string>();
    let summary: string | undefined;

    for await (const message of iter) {
      const ev = translate(message, edited);
      if (ev) emit(ev);
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'result'
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: SDK message
        const m = message as any;
        summary = m.result ?? m.summary;
      }
    }

    emit({
      kind: 'done',
      summary: summary ?? (edited.size > 0 ? `Edited ${edited.size} file(s)` : 'No changes'),
    });
  } catch (err) {
    emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
function translate(message: any, edited: Set<string>): RunEvent | null {
  if (!message || typeof message !== 'object') return null;
  const type = message.type;

  if (type === 'assistant') {
    const text = assistantText(message);
    return text ? { kind: 'log', line: text } : null;
  }

  if (type === 'tool_use' || type === 'tool_result' || type === 'tool_progress') {
    const name = message.name ?? message.tool_name;
    if (name === 'Edit' || name === 'Write') {
      const file = message.input?.file_path ?? message.input?.path;
      if (file && !edited.has(file)) {
        edited.add(file);
        return { kind: 'edit', file, description: name === 'Write' ? 'wrote' : 'edited' };
      }
    }
    if (name === 'Bash' && message.input?.command) {
      return { kind: 'log', line: `$ ${String(message.input.command).slice(0, 200)}` };
    }
    if (name) return { kind: 'status', status: 'editing' };
  }

  return null;
}

// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
function assistantText(m: any): string | null {
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

void main();
