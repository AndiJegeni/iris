/** @jsxImportSource preact */
import type { QuestionOption, TranscriptEntry } from '@iris/shared';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { FileIcon } from './icons';
import { type OverlayTheme, surfacePalette } from './theme';

/**
 * The transcript reads as a document, not a chat log. Three treatments, total:
 *
 *   1. A bordered block for the prompt that started the turn.
 *   2. A one-line "activity" row for everything the agent did — the verb in ink,
 *      its argument in grey, no container. A run of these is a quiet column the
 *      eye skips unless it's looking for it.
 *   3. A bordered card for files the agent touched, which are the part you
 *      actually want to find again later.
 *
 * Assistant prose sits between them unadorned. Nothing is right-aligned and
 * nothing is a bubble: alignment wasn't carrying meaning, the labels are.
 *
 * The whole thing is drawn with one ink at three alphas plus one stroke, taken
 * from the picked popover so the chat is visibly the same material as the rest
 * of the overlay. Only your own message is filled — the other two containers
 * differ by job, not by shade.
 */

/**
 * Every colour here comes from SURFACE_PALETTE — the popover's palette — and
 * none from `ThemeTokens`. That's the whole point: the token set's text ramp is
 * three unrelated zinc greys (#f5f5f5 → #a3a3a3 → #737373), so the transcript's
 * three tiers used to read as three different materials stacked in one box. The
 * popover instead thins a single ink, which is what makes it hold together.
 */
export function chatInk(theme: OverlayTheme) {
  const p = surfacePalette(theme);
  return {
    /** Prose, the prompt, filenames — the things you actually read. */
    ink: p.ink,
    /** What the agent did. Thinned on purpose: a run of these is texture, not content. */
    muted: p.soft,
    /** The argument trailing a verb, and durations. Quieter still. */
    faint: p.faint,
    /** The one fill: your own messages. Everything else is drawn with a line. */
    fill: p.fill,
    stroke: p.stroke,
  };
}

/**
 * True for entries that belong to the quiet column — thinking, non-file tool
 * calls, the closing result line. The list packs a run of these tightly and
 * gives everything else room (see MessageList in task-chat.tsx); without the
 * grouping every line reads as equally important.
 */
export function isQuietEntry(entry: TranscriptEntry): boolean {
  if (entry.role === 'thinking' || entry.role === 'result') return true;
  if (entry.role === 'tool') return !isFileEdit(entry);
  return false;
}

function isFileEdit(entry: TranscriptEntry): boolean {
  return FILE_TOOLS.test(entry.toolName ?? '') && Boolean(entry.toolInput);
}

/**
 * One row of the list: an entry rendered as it always was, or a run of
 * consecutive tool calls drawn as a single line.
 */
export type TranscriptRow =
  | { kind: 'entry'; key: string; entry: TranscriptEntry }
  | { kind: 'tools'; key: string; entries: TranscriptEntry[] };

/**
 * Fold each run of consecutive tool calls into one row.
 *
 * A working agent emits a call every couple of seconds, and a line each turned
 * a minute of work into a wall the eye had to scroll past to reach the prose
 * either side of it. The run is one row that updates in place instead: what it
 * shows is what the agent is doing *now*, and the calls behind it are one click
 * away, because "which commands did it actually run" is the first question
 * asked of a task that finished wrong.
 *
 * File edits are deliberately not collapsible — the card is the artifact of the
 * turn (see FileCard), so folding one into a run would hide the one thing worth
 * finding again. A file edit therefore also *ends* a run, same as prose.
 */
export function groupTranscript(entries: TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const entry of entries) {
    if (entry.role !== 'tool' || isFileEdit(entry)) {
      rows.push({ kind: 'entry', key: entry.id, entry });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === 'tools') last.entries.push(entry);
    // Keyed by where the run started, not by its newest call: the row must
    // survive the run growing, or every appended call would remount it and
    // throw away whether the user had it expanded.
    else rows.push({ kind: 'tools', key: entry.id, entries: [entry] });
  }
  return rows;
}

/** A row's spacing tier — see isQuietEntry; a run of tool calls is always quiet. */
export function isQuietRow(row: TranscriptRow): boolean {
  return row.kind === 'tools' ? true : isQuietEntry(row.entry);
}

/**
 * True while a call in this run is still executing. Asked of the run rather
 * than of its newest call because parallel calls finish out of order, and the
 * run is live until the last of them lands.
 */
export function isToolRunLive(row: TranscriptRow | undefined): boolean {
  return row?.kind === 'tools' && row.entries.some((e) => e.toolStatus === 'running');
}

export function formatDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return '<1s';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

/** Tools whose subject is a file worth surfacing as a card rather than a line. */
const FILE_TOOLS = /^(edit|write|create|multiedit|notebookedit|update)$/i;

export function Entry({ entry, theme }: { entry: TranscriptEntry; theme: OverlayTheme }) {
  switch (entry.role) {
    case 'user':
      return (
        <div style={promptRow}>
          <div style={promptBlock(theme)}>{renderInline(entry.text ?? '', theme)}</div>
        </div>
      );
    case 'assistant':
      return <div style={assistantText(theme)}>{renderInline(entry.text ?? '', theme)}</div>;
    case 'thinking':
      return (
        <ActivityRow
          verb="Thought"
          arg={formatDuration(entry.durationMs) || 'a moment'}
          body={entry.text}
          theme={theme}
        />
      );
    case 'tool':
      return <ToolEntry entry={entry} theme={theme} />;
    case 'result':
      return (
        <ActivityRow
          verb={entry.text ?? 'Done'}
          arg={formatDuration(entry.durationMs)}
          theme={theme}
        />
      );
    case 'error':
      return <div style={errorRow(theme)}>{entry.text}</div>;
    default:
      return null;
  }
}

/**
 * One line of agent activity: `Read` `AppManager.tsx`. When the entry carries
 * output the whole row toggles it — no chevron, because a column of them turns
 * the quiet list back into a stack of controls.
 *
 * `pulse` marks the row as the thing happening right now; `failed` puts the one
 * word the row can't afford to swallow at its right edge.
 */
export function ActivityRow({
  verb,
  arg,
  body,
  pulse = false,
  failed = false,
  theme,
}: {
  verb: string;
  arg?: string | undefined;
  body?: string | undefined;
  pulse?: boolean;
  failed?: boolean;
  theme: OverlayTheme;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(body);
  const c = chatInk(theme);
  return (
    <div>
      <button
        type="button"
        className={expandable ? 'la-tc-act la-tc-hit' : 'la-tc-act'}
        style={{ ...activityRow, cursor: expandable ? 'pointer' : 'default' }}
        onClick={() => expandable && setOpen((o) => !o)}
      >
        {pulse ? <span style={pulseDot(c.muted)} /> : null}
        <span style={{ color: c.muted }}>{verb}</span>
        {arg ? <span style={activityArg(c.faint)}>{arg}</span> : null}
        {failed ? (
          <span style={trailingMeta}>
            <span style={{ color: surfacePalette(theme).error }}>failed</span>
          </span>
        ) : null}
      </button>
      {open && body ? <div style={activityBody(c.faint)}>{body}</div> : null}
    </div>
  );
}

function ToolEntry({
  entry,
  pulse = false,
  theme,
}: {
  entry: TranscriptEntry;
  pulse?: boolean;
  theme: OverlayTheme;
}) {
  const input = entry.toolInput ?? '';

  // A file edit is the one thing worth a card — it's the artifact of the turn.
  if (isFileEdit(entry)) {
    return <FileCard path={input} theme={theme} />;
  }
  return (
    <ActivityRow
      verb={entry.toolName ?? 'tool'}
      arg={input}
      body={entry.toolOutput}
      pulse={pulse}
      failed={entry.toolStatus === 'error'}
      theme={theme}
    />
  );
}

/**
 * A run of tool calls as one line: the newest call, with the rest behind it.
 *
 * `live` is the list's word for "this run is the tail of a task that is still
 * going" — without it a run interrupted by a cancel would keep the pulse of its
 * last `running` call forever, which is the one thing this row must not lie
 * about.
 *
 * The count is the whole affordance (no chevron, per ActivityRow), and a failure
 * anywhere in the run is reported on the collapsed line rather than left for the
 * user to go find: the point of hiding the run is that it is uninteresting, and
 * a call that errored is not.
 */
export function ToolRun({
  entries,
  live,
  theme,
}: {
  entries: TranscriptEntry[];
  live: boolean;
  theme: OverlayTheme;
}) {
  const [open, setOpen] = useState(false);
  const c = chatInk(theme);
  const current = entries[entries.length - 1] as TranscriptEntry;
  const running = live && entries.some((e) => e.toolStatus === 'running');

  // A lone call has no history to hide, so it stays exactly the row it was —
  // an expander that reveals nothing is worse than no expander.
  if (entries.length === 1) return <ToolEntry entry={current} pulse={running} theme={theme} />;

  const failed = entries.filter((e) => e.toolStatus === 'error').length;
  return (
    <div style={toolRun}>
      {/* Expanding inserts the run's history *above* the visible row, so the
          calls read in the order they happened and the live one stays last. */}
      {open
        ? entries.slice(0, -1).map((e) => <ToolEntry key={e.id} entry={e} theme={theme} />)
        : null}
      <button
        type="button"
        className="la-tc-act la-tc-hit"
        style={{ ...activityRow, cursor: 'pointer' }}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {running ? <span style={pulseDot(c.muted)} /> : null}
        <span style={{ color: c.muted }}>{current.toolName ?? 'tool'}</span>
        {current.toolInput ? <span style={activityArg(c.faint)}>{current.toolInput}</span> : null}
        <span style={trailingMeta}>
          {failed > 0 ? (
            <span style={{ color: surfacePalette(theme).error }}>{failed} failed</span>
          ) : null}
          <span style={{ color: c.faint }}>{entries.length} steps</span>
        </span>
      </button>
    </div>
  );
}

/**
 * A file the agent touched, shown by its full relative path — `app/page.tsx`
 * says more than `page.tsx` when three files changed.
 *
 * Diff counts (`+52 −0`) belong on the right of this row and would be the only
 * colour in the transcript, but `TranscriptEntry` carries no line stats today —
 * the daemon would have to emit them — so the card shows what we actually know.
 */
export function FileCard({ path, theme }: { path: string; theme: OverlayTheme }) {
  const c = chatInk(theme);
  return (
    <div style={fileCard(c.stroke)}>
      <span style={{ color: c.muted, display: 'inline-flex', flexShrink: 0 }}>
        <FileIcon />
      </span>
      <span style={fileName(c.ink)}>{path.trim()}</span>
    </div>
  );
}

/**
 * The agent's question, and the thing this whole feature exists to make
 * unmissable. It is the transcript's one *demand* — everything else there is a
 * record of what happened — so it is the only block that gets both a stroke and
 * a fill, and it sits at the bottom of the list where the next thing to read is.
 *
 * The options are the agent's own, and picking one sends its label as an
 * ordinary message: the composer underneath is always live too, because "Other"
 * is always a valid answer and a fixed set of buttons over a genuine question is
 * how you get a wrong answer politely.
 *
 * One question at a time. The agent may ask up to four at once; the daemon
 * hands back whichever is still outstanding, so the user is never asked to hold
 * four decisions in their head to make one.
 */
export function QuestionCard({
  question,
  options,
  header,
  remaining,
  theme,
  onAnswer,
}: {
  question: string;
  options: QuestionOption[];
  header: string;
  /** How many questions, this one included, are still unanswered. */
  remaining: number;
  theme: OverlayTheme;
  onAnswer: (label: string) => void;
}) {
  const c = chatInk(theme);
  return (
    <div style={questionCard(c.stroke, c.fill)}>
      <div style={questionHeader(c.muted)}>
        <span>{header.trim() || 'Needs your answer'}</span>
        {remaining > 1 ? <span style={{ color: c.faint }}>{remaining} questions left</span> : null}
      </div>
      <div style={questionText(c.ink)}>{renderInline(question, theme)}</div>
      {options.length > 0 ? (
        <div style={optionList}>
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className="la-tc-act la-tc-hit"
              style={optionBtn(c.stroke)}
              onClick={() => onAnswer(o.label)}
              title={o.description}
            >
              <span style={{ color: c.ink, fontWeight: 500 }}>{o.label}</span>
              {o.description ? <span style={optionWhy(c.faint)}>{o.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div style={questionHint(c.faint)}>Or reply below in your own words.</div>
    </div>
  );
}

export function WorkingRow({ theme }: { theme: OverlayTheme }) {
  const c = chatInk(theme);
  return (
    <div style={{ ...activityRow, cursor: 'default' }}>
      <span style={pulseDot(c.muted)} />
      <span style={{ color: c.muted }}>Working…</span>
    </div>
  );
}

/**
 * The two pieces of markdown the transcript honours — `` `code` `` and
 * `**bold**` — and deliberately nothing else: no headings, lists, links, or
 * italics, because the agent's prose is short and a full renderer would be a
 * second design system to maintain. Code spans get the monospace the file cards
 * already use; bold is how the agent labels its sections ("**What was
 * wrong:**").
 *
 * Code is split out first so a `**` inside backticks stays literal, and both
 * regexes demand a closed pair — an unclosed marker (or a single `*`) passes
 * through untouched. Returns plain Preact nodes; agent output must never reach
 * `dangerouslySetInnerHTML` in an overlay injected into someone's page.
 */
export function renderInline(text: string, theme: OverlayTheme = 'dark'): ComponentChildren {
  // Capture group in the split ⇒ odd indices are exactly the code spans.
  const parts = text.split(/(`[^`\n]+`)/g);
  if (parts.length === 1) return renderBold(text);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional
      <code key={i} style={inlineCode(theme)}>
        {part.slice(1, -1)}
      </code>
    ) : (
      renderBold(part)
    ),
  );
}

function renderBold(text: string): ComponentChildren {
  // `[^*]+` between the markers is what leaves single asterisks — and any
  // pair wrapping more asterisks — alone.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional
      <strong key={i} style={{ fontWeight: 600 }}>
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

// ---------- styles ----------

/**
 * One size and one corner across the whole chat.
 *
 * Prose used to be 14 against the composer's 13, so the message you were
 * reading was larger than the one you were writing. 13 is the overlay's size
 * everywhere else — the popover's composer, the drawer's rows — so the chat
 * matches rather than the composer growing to meet it.
 *
 * Prose and meta being the same size is deliberate: the palette separates them
 * by ink, one colour at three alphas, which is how the rest of the overlay
 * builds hierarchy.
 */
const SIZE_BODY = 13;
const SIZE_META = 13;
const RADIUS = 6;

/**
 * Your own message: a filled block that hugs its text on the right. Stretching
 * it full width left a ragged gap after short prompts, and a stroke made it read
 * as another of the agent's containers — the fill plus the right edge is what
 * separates "you said this" from everything the agent produced.
 */
const promptRow = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const promptBlock = (theme: OverlayTheme) => ({
  maxWidth: '88%',
  padding: '9px 12px',
  background: chatInk(theme).fill,
  borderRadius: `${RADIUS}px`,
  color: chatInk(theme).ink,
  fontSize: `${SIZE_BODY}px`,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

export const assistantText = (theme: OverlayTheme) => ({
  color: chatInk(theme).ink,
  fontSize: `${SIZE_BODY}px`,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

const activityRow = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '7px',
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.6,
  fontFamily: 'inherit',
  textAlign: 'left' as const,
};

const activityArg = (muted: string) => ({
  color: muted,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
});

/**
 * The transcript's one "right now" mark, shared by the Working… row and by a
 * run whose newest call is still executing. One signal, drawn once: two
 * different live treatments would just raise the question of what the
 * difference meant.
 */
const pulseDot = (ink: string) => ({
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  background: ink,
  animation: 'iris-pulse 1.4s ease-in-out infinite',
  flexShrink: 0,
  alignSelf: 'center',
});

// Everything a row says about itself rather than about the agent — the step
// count, a failure — pushed to the right edge so the verb + argument still read
// as one phrase and the argument keeps the room to be truncated.
const trailingMeta = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '8px',
  marginLeft: 'auto',
  flexShrink: 0,
};

// Rows within an expanded run sit at the same tight rhythm the list gives a run
// of quiet entries (TIGHT in task-chat.tsx).
const toolRun = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '3px',
};

const activityBody = (muted: string) => ({
  margin: '4px 0 2px',
  color: muted,
  fontSize: `${SIZE_META}px`,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineHeight: 1.5,
  maxHeight: '180px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

// No fill — the stroke and the icon are enough to mark it, and a bespoke tint
// was one more shade competing with the panel behind it.
const fileCard = (stroke: string) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '9px',
  padding: '10px 12px',
  border: `1px solid ${stroke}`,
  borderRadius: `${RADIUS}px`,
});

const fileName = (ink: string) => ({
  color: ink,
  fontSize: `${SIZE_META}px`,
  fontWeight: 500,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
});

// The palette's one fill, not a bespoke tint — at 0.9em with 1px of padding it
// reads as a shade of the same material, not a new container.
const inlineCode = (theme: OverlayTheme) => ({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.9em',
  background: chatInk(theme).fill,
  borderRadius: '4px',
  padding: '1px 4px',
});

/**
 * The question block. Stroke *and* fill — the transcript's other two containers
 * each carry one, so carrying both is what marks this as neither a record of
 * what you said nor a record of what the agent did, but the one thing on the
 * page still waiting on you. No hue: the palette has none, and a yellow "alert"
 * band would be the only colour in the overlay.
 */
const questionCard = (stroke: string, fill: string) => ({
  border: `1px solid ${stroke}`,
  background: fill,
  borderRadius: `${RADIUS}px`,
  padding: '12px',
});

// The agent's own chip label, and the count when it asked more than one — the
// same 13px as everything else, separated by ink rather than by size.
const questionHeader = (muted: string) => ({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '8px',
  color: muted,
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.5,
  fontWeight: 500,
});

const questionText = (ink: string) => ({
  color: ink,
  fontSize: `${SIZE_BODY}px`,
  lineHeight: 1.55,
  marginTop: '4px',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

const optionList = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '6px',
  marginTop: '10px',
};

// Stacked full-width rows rather than a row of pills: an option carries a label
// *and* the agent's explanation of it, and neither survives being squeezed into
// a pill. No inline `opacity`/`transition` — `.la-tc-hit` owns the hover dip.
const optionBtn = (stroke: string) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start',
  gap: '2px',
  width: '100%',
  textAlign: 'left' as const,
  background: 'transparent',
  border: `1px solid ${stroke}`,
  borderRadius: `${RADIUS}px`,
  padding: '8px 10px',
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.5,
  fontFamily: 'inherit',
  cursor: 'pointer',
});

const optionWhy = (faint: string) => ({
  color: faint,
  fontWeight: 400,
  whiteSpace: 'normal' as const,
});

// Says the buttons are not the whole answer. Quietest ink in the card, because
// it is the fallback rather than the offer.
const questionHint = (faint: string) => ({
  color: faint,
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.5,
  marginTop: '10px',
});

// The one hue that isn't ink — the popover's own error red, so a failed turn
// reads the same here as it does there.
const errorRow = (theme: OverlayTheme) => ({
  color: surfacePalette(theme).error,
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});
