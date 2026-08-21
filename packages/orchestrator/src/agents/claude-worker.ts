/**
 * Claude agent worker — runs ONE task (or one follow-up turn) in its own process.
 *
 * Why a separate process: the Agent SDK resolves file edits against
 * `process.cwd()`, NOT the `cwd` option passed to `query()`. To isolate a task
 * to its worktree, the parent spawns this script with `{ cwd }` so this
 * process's cwd IS the worktree. Edits then land in the right place, and
 * parallel tasks (each its own process) never clobber each other's cwd.
 *
 * Protocol:
 *   - stdin:  one JSON line `{ prompt, resume?, model?, effort? }`
 *             (`resume` is a prior SDK session id, for follow-up messages;
 *             `model`/`effort` are the user's picks, already in SDK spelling)
 *   - stdout: JSON-line RunEvents — besides the legacy `log`/`edit`/`status`/
 *             `done`/`error`, we now emit structured `entry` events (one per
 *             assistant text / thinking block / tool call) and a `session`
 *             event carrying the resumable session id.
 *   ANTHROPIC_API_KEY is inherited from the spawn env.
 */
import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { TranscriptEntry } from '@iris/shared';
import { isAuthError } from '../auth-errors';
import { CLAUDE_BINARY_ENV } from '../claude-binary';
// The parent parses stdout back into this exact union, so it is the wire format
// between the two processes — import it rather than restating it here, where a
// silent drift would only surface as a dropped event at runtime.
import type { RunEvent } from './types';

function emit(ev: RunEvent): void {
  process.stdout.write(`${JSON.stringify(ev)}\n`);
}

function emitEntry(entry: TranscriptEntry): void {
  emit({ kind: 'entry', entry });
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

/**
 * The SDK's own `EffortLevel`. Our shared ReasoningEffort is the union of the
 * Claude and codex tiers, so the GPT-only top tier ("ultra") is a value this
 * backend would reject — the picker filters by provider, and this is the
 * belt-and-braces so a stale client can't 400 the run.
 */
const SDK_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

async function main(): Promise<void> {
  const input = await readStdin();
  let prompt: string;
  let resume: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  try {
    const parsed = JSON.parse(input) as {
      prompt: string;
      resume?: string;
      model?: string;
      effort?: string;
    };
    prompt = parsed.prompt;
    resume = parsed.resume;
    model = parsed.model;
    effort = parsed.effort && SDK_EFFORTS.has(parsed.effort) ? parsed.effort : undefined;
  } catch {
    emit({ kind: 'error', message: 'worker: invalid input' });
    return;
  }

  // Hoisted out of the try: the catch below decides whether a thrown turn
  // limit is a failure or a soft landing by how far the run got.
  const tracker = new TranscriptTracker();

  try {
    const iter = query({
      prompt,
      options: {
        // process.cwd() is the worktree (set by the parent's spawn cwd).
        cwd: process.cwd(),
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'bypassPermissions',
        // 25 starved real tasks — an agent that had already landed its edits
        // burned the remainder trying to verify and hit the wall mid-check,
        // which surfaced as a hard failure over finished work. 60 gives
        // verification room while still bounding a genuine runaway.
        maxTurns: 60,
        // Set when the daemon found a usable `claude` on PATH; omitted otherwise
        // so the SDK falls back to its own vendored executable.
        ...(process.env[CLAUDE_BINARY_ENV]
          ? { pathToClaudeCodeExecutable: process.env[CLAUDE_BINARY_ENV] }
          : {}),
        // Resume a prior session for follow-up messages (undefined → fresh run).
        ...(resume ? { resume } : {}),
        // The user's picks. Omitted entirely when unset so the SDK keeps its
        // own defaults rather than being handed an empty string.
        ...(model ? { model } : {}),
        ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
      },
    });

    let sessionSent = false;
    let summary: string | undefined;

    for await (const message of iter) {
      // Capture the resumable session id from the first message that carries it.
      if (!sessionSent && message && typeof message === 'object' && 'session_id' in message) {
        const sid = (message as { session_id?: unknown }).session_id;
        if (typeof sid === 'string' && sid) {
          emit({ kind: 'session', sessionId: sid });
          sessionSent = true;
        }
      }

      // Legacy events (status/edit) keep the task-panel status line working.
      const legacy = translateLegacy(message, tracker.editedFiles);
      if (legacy) emit(legacy);

      // Structured transcript entries for the chat UI.
      tracker.handle(message);

      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        (message as { type?: unknown }).type === 'result'
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: SDK message
        const m = message as any;
        summary = m.result ?? m.summary;
        const durationMs = typeof m.duration_ms === 'number' ? m.duration_ms : undefined;
        // The SDK reports some auth failures as an error *result* rather than a
        // throw; treat both as needs-auth.
        if (m.is_error === true && typeof summary === 'string' && isAuthError(summary)) {
          emit({ kind: 'needs-auth', message: summary });
          return;
        }
        // The closing line is just "Done · 12s". The SDK's `result` is the full
        // final assistant message, which the transcript already carries as its
        // own assistant entry — re-emitting it here painted the whole reply a
        // second time, in the activity row's grey, right under the real one.
        // Same guard on the error path: the SDK often surfaces a failure as an
        // assistant message AND an error result carrying identical text.
        if (m.is_error === true && summary) {
          if (String(summary).trim() !== tracker.lastAssistantText.trim()) {
            emitEntry({ id: randomUUID(), role: 'error', at: Date.now(), text: String(summary) });
          }
        } else {
          emitEntry({
            id: randomUUID(),
            role: 'result',
            at: Date.now(),
            text: 'Done',
            ...(durationMs != null ? { durationMs } : {}),
          });
        }
      }
    }

    emit({
      kind: 'done',
      summary:
        summary ??
        (tracker.editedFiles.size > 0
          ? `Edited ${tracker.editedFiles.size} file(s)`
          : 'No changes'),
    });
  } catch (err) {
    // An expired subscription session / rejected key surfaces here as a thrown
    // 401. Flag it as such so the daemon can tell the user to re-authenticate
    // rather than reporting an opaque failure.
    const message = err instanceof Error ? err.message : String(err);
    if (isAuthError(message)) {
      emit({ kind: 'needs-auth', message });
      return;
    }
    // The SDK throws when the turn cap trips, even if the agent had already
    // finished the actual work and was only mid-verification — which painted a
    // completed change as "failed" with an opaque error. If edits landed, call
    // it done and say what happened; the session is resumable, so a follow-up
    // picks up exactly where the cap cut in. With no edits at all the cap
    // really did starve the task, and failure is the honest report.
    if (/maximum number of turns/i.test(message) && tracker.editedFiles.size > 0) {
      emitEntry({
        id: randomUUID(),
        role: 'error',
        at: Date.now(),
        text: 'Ran out of turns while verifying — the edits above are in the worktree. Send a follow-up to continue.',
      });
      emit({
        kind: 'done',
        summary: `Edited ${tracker.editedFiles.size} file(s), then ran out of turns while verifying`,
      });
      return;
    }
    emit({ kind: 'error', message });
  }
}

/**
 * Walks SDK messages and emits structured transcript entries. Tracks tool-call
 * start times so a result can be matched to its call (by tool_use id) and a
 * duration computed, and the prior boundary so a thinking block's duration is
 * the wall-clock time it represents.
 */
class TranscriptTracker {
  readonly editedFiles = new Set<string>();
  /** The most recent assistant text block, for de-duplicating the result. */
  lastAssistantText = '';
  private toolStart = new Map<string, number>();
  private lastBoundaryMs = Date.now();

  // biome-ignore lint/suspicious/noExplicitAny: SDK message shape
  handle(message: any): void {
    if (!message || typeof message !== 'object') return;
    const type = message.type;

    if (type === 'assistant') {
      const content = message.message?.content ?? message.content;
      const blocks = Array.isArray(content)
        ? content
        : typeof content === 'string'
          ? [{ type: 'text', text: content }]
          : [];
      for (const block of blocks) this.handleBlock(block);
      return;
    }

    if (type === 'user') {
      const content = message.message?.content ?? message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') this.handleToolResult(block);
        }
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK content block shape
  private handleBlock(block: any): void {
    if (!block || typeof block !== 'object') return;
    const now = Date.now();

    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      emitEntry({ id: randomUUID(), role: 'assistant', at: now, text: block.text });
      this.lastAssistantText = block.text;
      this.lastBoundaryMs = now;
      return;
    }

    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      emitEntry({
        id: randomUUID(),
        role: 'thinking',
        at: now,
        text: block.thinking,
        durationMs: Math.max(0, now - this.lastBoundaryMs),
      });
      this.lastBoundaryMs = now;
      return;
    }

    if (block.type === 'tool_use') {
      const id = typeof block.id === 'string' ? block.id : randomUUID();
      const name = String(block.name ?? 'tool');
      this.toolStart.set(id, now);
      emitEntry({
        id,
        role: 'tool',
        at: now,
        toolName: name,
        toolInput: summarizeInput(name, block.input),
        toolStatus: 'running',
      });
      // Track edits so the status line / summary can mention them.
      if ((name === 'Edit' || name === 'Write') && block.input) {
        const file = block.input.file_path ?? block.input.path;
        if (file && !this.editedFiles.has(file)) this.editedFiles.add(file);
      }
      this.lastBoundaryMs = now;
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK tool_result block shape
  private handleToolResult(block: any): void {
    const id = block.tool_use_id;
    if (typeof id !== 'string') return;
    const start = this.toolStart.get(id);
    const now = Date.now();
    this.toolStart.delete(id);
    emitEntry({
      id, // same id → client updates the running tool entry in place
      role: 'tool',
      at: now,
      toolStatus: block.is_error ? 'error' : 'ok',
      toolOutput: flattenToolResult(block.content),
      ...(start != null ? { durationMs: Math.max(0, now - start) } : {}),
    });
    this.lastBoundaryMs = now;
  }
}

/** Legacy status/edit events (kept so the task-panel status line is unchanged). */
// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
function translateLegacy(message: any, edited: Set<string>): RunEvent | null {
  if (!message || typeof message !== 'object') return null;
  if (message.type !== 'assistant') return null;
  const content = message.message?.content ?? message.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'tool_use') {
      const name = block.name;
      if (name === 'Edit' || name === 'Write') {
        const file = block.input?.file_path ?? block.input?.path;
        if (file && edited.has(file)) {
          return { kind: 'edit', file, description: name === 'Write' ? 'wrote' : 'edited' };
        }
      }
      if (name) return { kind: 'status', status: 'editing' };
    }
  }
  return null;
}

const MAX_INPUT = 300;
const MAX_OUTPUT = 600;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** A short, human-readable summary of a tool's input for the chat row. */
// biome-ignore lint/suspicious/noExplicitAny: SDK tool input shape
function summarizeInput(name: string, input: any): string {
  if (input && typeof input === 'object') {
    if (name === 'Bash' && typeof input.command === 'string') {
      return truncate(`$ ${input.command}`, MAX_INPUT);
    }
    const path = input.file_path ?? input.path ?? input.pattern;
    if (typeof path === 'string') return truncate(path, MAX_INPUT);
  }
  try {
    return truncate(JSON.stringify(input ?? {}), MAX_INPUT);
  } catch {
    return '';
  }
}

/** Tool results are a string or an array of `{type:'text',text}` blocks. */
// biome-ignore lint/suspicious/noExplicitAny: SDK tool_result content shape
function flattenToolResult(content: any): string {
  if (typeof content === 'string') return truncate(content, MAX_OUTPUT);
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    return truncate(text, MAX_OUTPUT);
  }
  return '';
}

void main();
