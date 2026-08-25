import type { TranscriptEntry } from '@iris/shared';
import type { RunRequest } from './types';

/** How much of a single prior transcript entry we replay into a follow-up prompt. */
const REPLAY_ENTRY_MAX = 2000;
/**
 * Total budget for the replayed history. Prompt size drives per-turn latency
 * for every turn of the follow-up run, so an unbounded replay makes long
 * threads slower the longer they get. A follow-up refers back to recent turns,
 * not the whole history — keep whole entries from the end until the budget is
 * spent and say that older ones were dropped, so the agent knows the thread is
 * longer than what it sees rather than assuming it saw everything.
 */
const REPLAY_TOTAL_MAX = 16_000;
const REPLAY_ELISION = '[Earlier turns omitted — this is the most recent part of the thread.]';

/**
 * Told to the agent because nothing else does. `AskUserQuestion` is wired up
 * and blocks the run until the user answers (see claude-worker), but the tool's
 * own guidance is conservative and a request picked off a page — "make this
 * green", pointing at one element — is exactly the shape that hides an
 * ambiguity worth one question. Without this the agent guesses silently, and a
 * wrong guess costs the whole run.
 *
 * Deliberately two-sided: asking is cheap, but a question the user has to read
 * before anything happens is not free either, so the bar is "the answer changes
 * what I do", not "I could imagine alternatives".
 */
const ASK_NOTE = [
  'If this request is ambiguous in a way that changes what you would build,',
  'use AskUserQuestion before starting — the user is at the page and will',
  'answer. Ask only when the answer changes your approach; if a sensible',
  'default exists, take it and say what you assumed.',
  '',
  '',
].join('\n');

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
  return `${header}${ASK_NOTE}User request:\n${req.prompt}`;
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
    const clipped = text.length > REPLAY_ENTRY_MAX ? `${text.slice(0, REPLAY_ENTRY_MAX)}…` : text;
    lines.push(`${who}: ${clipped}`);
  }
  // Newest-first accumulation: the entries a follow-up actually references are
  // the recent ones, so when the thread outgrows the budget it is the oldest
  // that go.
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    if (total + line.length > REPLAY_TOTAL_MAX) break;
    kept.unshift(line);
    total += line.length;
  }
  if (kept.length < lines.length) kept.unshift(REPLAY_ELISION);
  return kept.join('\n\n');
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
