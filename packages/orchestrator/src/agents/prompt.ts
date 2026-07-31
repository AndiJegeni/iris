import type { TranscriptEntry } from '@iris/shared';
import type { RunRequest } from './types';

/** How much of a single prior transcript entry we replay into a follow-up prompt. */
const REPLAY_ENTRY_MAX = 2000;

/**
 * Compose the prompt the agent sees from the user's annotation: the context we
 * auto-captured from the browser, then what the user actually asked for.
 */
export function buildPrompt(req: RunRequest): string {
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

/**
 * Render prior turns as plain text, for a backend that cannot resume its own
 * session. Only the conversation is replayed — tool calls and their output are
 * the previous run's mechanics, not shared context worth re-reading, and they
 * dwarf the actual dialogue.
 */
function replayTranscript(entries: TranscriptEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.role !== 'user' && e.role !== 'assistant') continue;
    const text = e.text?.trim();
    if (!text) continue;
    const who = e.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${who}: ${text.slice(0, REPLAY_ENTRY_MAX)}`);
  }
  return lines.join('\n\n');
}

/**
 * Prompt for a follow-up turn on a backend with no native session resume: the
 * earlier conversation, then the new message. Without this the follow-up would
 * reach the agent as a bare sentence with no memory of what it just did.
 *
 * Falls back to a fresh prompt when there is nothing to replay.
 */
export function buildFollowUpPrompt(req: RunRequest): string {
  const history = replayTranscript(req.priorTranscript ?? []);
  if (!history) return buildPrompt(req);
  return [
    'Earlier in this conversation (you are continuing the same task):',
    '',
    history,
    '',
    '---',
    '',
    `Follow-up request:\n${req.prompt}`,
  ].join('\n');
}
