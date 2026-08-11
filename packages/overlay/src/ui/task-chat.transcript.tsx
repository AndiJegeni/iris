/** @jsxImportSource preact */
import type { TranscriptEntry } from '@iris/shared';
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
          <div style={promptBlock(theme)}>{entry.text}</div>
        </div>
      );
    case 'assistant':
      return <div style={assistantText(theme)}>{renderInlineCode(entry.text ?? '')}</div>;
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
 */
export function ActivityRow({
  verb,
  arg,
  body,
  theme,
}: {
  verb: string;
  arg?: string | undefined;
  body?: string | undefined;
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
        <span style={{ color: c.muted }}>{verb}</span>
        {arg ? <span style={activityArg(c.faint)}>{arg}</span> : null}
      </button>
      {open && body ? <div style={activityBody(c.faint)}>{body}</div> : null}
    </div>
  );
}

function ToolEntry({ entry, theme }: { entry: TranscriptEntry; theme: OverlayTheme }) {
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
      theme={theme}
    />
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

export function WorkingRow({ theme }: { theme: OverlayTheme }) {
  const c = chatInk(theme);
  return (
    <div style={{ ...activityRow, cursor: 'default' }}>
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '999px',
          background: c.muted,
          animation: 'iris-pulse 1.4s ease-in-out infinite',
          flexShrink: 0,
          alignSelf: 'center',
        }}
      />
      <span style={{ color: c.muted }}>Working…</span>
    </div>
  );
}

/**
 * Backticked spans switch to monospace so filenames and symbols in prose match
 * the ones in the cards above them. Deliberately the only markdown we honour —
 * the agent's prose is short, and a full renderer would be a second design
 * system to maintain.
 */
function renderInlineCode(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional
      <code key={i} style={inlineCode}>
        {part.slice(1, -1)}
      </code>
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

// Monospace alone marks it. A chip fill here was another shade for no gain.
const inlineCode = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.9em',
};

// The one hue that isn't ink — the popover's own error red, so a failed turn
// reads the same here as it does there.
const errorRow = (theme: OverlayTheme) => ({
  color: surfacePalette(theme).error,
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});
