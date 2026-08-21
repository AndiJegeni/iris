/** @jsxImportSource preact */
import type { ReasoningEffort, Task, TranscriptEntry } from '@iris/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type ChatTab, ChatTabBar } from './chat-tab-bar';
import { PlusThinIcon, SendIcon, StopIcon } from './icons';
import { DEFAULT_MODEL, EFFORTS, MODELS, ModelReasoningPicker } from './model-picker';
import { Entry, WorkingRow, assistantText, chatInk, isQuietEntry } from './task-chat.transcript';
import { type OverlayTheme, SURFACE_PAD, popoverTokens, surfacePalette } from './theme';

export type { ChatTab };

type TaskChatProps = {
  task: Task;
  /** Every open chat, shown as tabs in the header. */
  tabs: ChatTab[];
  /** Structured conversation; falls back to `logsFallback` when empty. */
  entries: TranscriptEntry[];
  logsFallback: string[];
  theme?: OverlayTheme;
  /** True while the task is running / a follow-up is in flight (composer locks). */
  busy?: boolean;
  onBack: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onSend: (text: string, opts: { model: string; effort: ReasoningEffort }) => void | Promise<void>;
  onCancel?: () => void;
};

/**
 * Full-conversation chat for a background task: user/assistant turns, thinking
 * ("Thought for Ns"), and tool calls with their inputs/outputs — the way Cursor
 * / Claude Code render a transcript — plus a composer to send follow-up
 * messages that resume the task's session. Theme-aware; fills its container.
 */
export function TaskChat({
  task,
  tabs,
  entries,
  logsFallback,
  theme = 'dark',
  busy = false,
  onBack,
  onSelectTab,
  onCloseTab,
  onSend,
  onCancel,
}: TaskChatProps) {
  // Only the shared ModelReasoningPicker still takes a whole token set.
  const t = popoverTokens(theme);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // One line → compact pill; wrapped text → the two-row card. Derived from the
  // textarea's real scrollHeight (not a character count) so soft wrapping counts.
  const [multiline, setMultiline] = useState(false);
  // Model + reasoning for the follow-up — defaults to the task's model.
  //
  // Only same-backend models are offered: a follow-up resumes the task's
  // existing agent session, which belongs to the backend that started it, so
  // switching families mid-thread would mean handing a Claude session to codex.
  // (The daemon rejects a cross-backend model too — see queue.continue.)
  const models = MODELS.filter((m) => m.backend === task.backend);
  const modelChoices = models.length > 0 ? models : MODELS;
  const [model, setModel] = useState<string>(
    modelChoices.some((m) => m.value === task.model)
      ? (task.model as string)
      : (modelChoices.find((m) => m.value === DEFAULT_MODEL) ?? modelChoices[0]!).value,
  );
  const [effort, setEffort] = useState<ReasoningEffort>('high');
  const selectedModel = modelChoices.find((m) => m.value === model) ?? modelChoices[0]!;
  const effortOptions = EFFORTS[selectedModel.provider];
  const changeModel = (value: string) => {
    setModel(value);
    const next = MODELS.find((m) => m.value === value);
    if (next && !EFFORTS[next.provider].some((e) => e.value === effort)) setEffort('high');
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The input's width in the one-line pill layout, recorded while we're in it.
  // The expand/collapse decision must always be made against THIS width: the
  // flip itself changes the input's width (pill row ↔ full row), so measuring
  // in whichever layout happens to be current lets each keystroke undo the
  // previous one's decision — the composer visibly flapped between the two
  // layouts while typing, and settled collapsed on wrapped text.
  const pillWidthRef = useRef<number | null>(null);

  // Auto-scroll to the latest message as the transcript grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, logsFallback.length, busy]);

  // Grow the composer with its content up to 3 lines, then scroll — and flip
  // between the one-line pill and the expanded card off the same measurement.
  // Runs again after a flip (`multiline` in deps) so the height is re-measured
  // at the layout the input actually ends up in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize when draft changes or the layout flips
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // "Would it wrap in the pill?" — measured at the pill width even while
    // expanded (see pillWidthRef). One line measures ~18-24px; two ~36px.
    // 30 splits them cleanly.
    if (!multiline) pillWidthRef.current = el.clientWidth;
    el.style.height = 'auto';
    let wraps: boolean;
    if (multiline && pillWidthRef.current != null) {
      // flexBasis is what actually sizes the input on the expanded card's row
      // (its inline width is just '100%'), so pin both for the measurement.
      const prevWidth = el.style.width;
      const prevBasis = el.style.flexBasis;
      el.style.width = `${pillWidthRef.current}px`;
      el.style.flexBasis = `${pillWidthRef.current}px`;
      wraps = el.scrollHeight > 30;
      el.style.width = prevWidth;
      el.style.flexBasis = prevBasis;
    } else {
      wraps = el.scrollHeight > 30;
    }
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_H)}px`;
    setMultiline(wraps);
  }, [draft, multiline]);

  const locked = busy || sending;
  const canSend = !!draft.trim() && !locked;

  const submit = async () => {
    const text = draft.trim();
    if (!text || locked) return;
    setDraft('');
    setSending(true);
    try {
      await onSend(text, { model: selectedModel.value, effort });
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={shell(theme)}>
      <ChatTabBar
        tabs={tabs}
        activeId={task.id}
        theme={theme}
        onBack={onBack}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />

      <div ref={scrollRef} style={messageList}>
        {entries.length > 0
          ? entries.map((e, i) => {
              // Two consecutive quiet entries close ranks; anything else gets air.
              // This grouping is what makes a run of tool calls read as one
              // column instead of a stack of equally-loud lines.
              const prev = i > 0 ? entries[i - 1] : undefined;
              const tight = Boolean(prev && isQuietEntry(prev) && isQuietEntry(e));
              return (
                <div key={e.id} style={{ marginTop: i === 0 ? 0 : tight ? TIGHT : LOOSE }}>
                  <Entry entry={e} theme={theme} />
                </div>
              );
            })
          : logsFallback.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines are positional
              <div key={i} style={assistantText(theme)}>
                {line}
              </div>
            ))}
        {busy ? (
          // Keyed so streaming entries reconcile around it instead of rebuilding
          // it. Tight against a run of quiet rows, but a full block gap after
          // anything loud — right after your own prompt it was the one row
          // sitting 3px under a filled block.
          <div
            key="working"
            style={{
              marginTop:
                entries.length === 0
                  ? 0
                  : isQuietEntry(entries[entries.length - 1]!)
                    ? TIGHT
                    : LOOSE,
            }}
          >
            <WorkingRow theme={theme} />
          </div>
        ) : null}
      </div>

      {/* Composer. One line: a single pill row — attach · input · model · send.
          Wrapped text: the input takes a full row and everything else drops to a
          footer beneath it (picker left, attach · send right). One DOM structure
          for both, flipped with flex-wrap + `order`, so crossing the line
          boundary never remounts the textarea and typing keeps its focus. */}
      <div style={composerCard(theme, multiline)}>
        <style>{chatCss(theme)}</style>
        <button
          type="button"
          className="la-tc-icon"
          style={{ ...attachBtn(), order: multiline ? 2 : 0 }}
          onClick={() => inputRef.current?.focus()}
          aria-label="Add"
        >
          <PlusThinIcon />
        </button>
        <textarea
          ref={inputRef}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is the newline — same as the popover.
            // `isComposing` guards IME input, where Enter accepts a candidate
            // and submitting would send half a word (keyCode 229 is the older
            // spelling of the same signal, still emitted by some browsers).
            if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
            if (e.shiftKey) return;
            e.preventDefault();
            void submit();
          }}
          rows={1}
          placeholder={busy ? 'Agent is working…' : 'Reply or ask a follow-up'}
          disabled={busy}
          style={{
            ...composerInput(),
            ...(multiline
              ? { order: 0, flexBasis: '100%', width: '100%' }
              : { order: 1, flex: 1, width: 'auto', minWidth: '60px' }),
          }}
        />
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            order: multiline ? 1 : 2,
            ...(multiline ? { marginRight: 'auto' } : {}),
          }}
        >
          <ModelReasoningPicker
            softInk={surfacePalette(theme).soft}
            models={modelChoices.map((m) => ({ value: m.value, label: m.label }))}
            model={model}
            onModelSelect={changeModel}
            effortOptions={effortOptions}
            effort={effort}
            onEffortSelect={(v) => setEffort(v as ReasoningEffort)}
            modelLabel={selectedModel.label}
            effortLabel={effortOptions.find((e) => e.value === effort)?.label ?? effort}
            t={t}
          />
        </div>
        {onCancel && busy ? (
          <button
            type="button"
            className="la-tc-send la-tc-stop"
            style={{ ...stopBtn(theme), order: 3 }}
            onClick={onCancel}
            aria-label="Stop"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="la-tc-send"
            style={{ ...sendBtn(theme), order: 3, opacity: canSend ? 1 : 0.3 }}
            disabled={!canSend}
            onClick={() => void submit()}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- styles ----------

// Mirrors the transcript's scale (see task-chat.transcript.tsx) so the composer
// and the messages above it are visibly the same system.
const SIZE_META = 13;
const RADIUS = 6;
/** Within a run of agent activity. */
const TIGHT = '3px';
/** Between blocks — prompt, prose, file cards. */
const LOOSE = '14px';

/**
 * Interaction ink for the chat, lifted from the pill: a hover fill plus a
 * matching 4px box-shadow so the halo reads as a circle around the glyph rather
 * than pushing the layout. Kept in CSS (not inline) because inline styles
 * outrank rules and would kill every :hover here.
 */
const chatCss = (theme: OverlayTheme): string => {
  const p = surfacePalette(theme);
  return [
    '.la-tc-icon{background:transparent;transition:background 90ms,box-shadow 90ms}',
    `.la-tc-icon:hover{background:${p.hover};box-shadow:0 0 0 2px ${p.hover}}`,
    // `transition` is one property, so it can only be declared in one place —
    // and the circle used to declare it inline, which silently dropped the
    // background fade `.la-tc-stop` asks for below. Both circles get their
    // timing here instead; Stop comes after and widens it by one property.
    '.la-tc-send{transition:opacity 120ms,transform 120ms}',
    '.la-tc-send:hover:not(:disabled){transform:scale(1.06)}',
    `.la-tc-stop{background:${p.soft};transition:background 80ms,opacity 120ms,transform 120ms}.la-tc-stop:hover{background:${p.submitBg}}`,
    // Activity rows are full-width, so a hover *fill* would re-draw the boxes
    // this layout exists to remove. A dip in opacity reads as pressable without
    // adding a container.
    '.la-tc-act{transition:opacity 90ms}',
    '.la-tc-hit:hover{opacity:0.68}',
  ].join('');
};

// One ink for the whole subtree; anything quieter opts into `muted` explicitly.
//
// It paints its own surface rather than inheriting whatever it's dropped into.
// Inside the drawer that's a no-op (the panel is already this colour), but the
// chat used to be transparent, so a host that framed it — the gallery did,
// with a hand-picked #161619 — silently showed it on a lighter, bluer card than
// the popover's. A component that owns its background can't be mis-framed.
const shell = (theme: OverlayTheme) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
  minHeight: 0,
  background: surfacePalette(theme).surface,
  color: chatInk(theme).ink,
});

const messageList = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
  // Same gutter as the popover's card (12px), not the old 16px.
  padding: `16px ${SURFACE_PAD}px`,
  display: 'flex',
  flexDirection: 'column' as const,
  // No uniform gap: spacing is decided per-entry above, because a run of quiet
  // rows and a pair of prose blocks want very different rhythms.
};

// 12px font × 1.5 line-height × 3 lines — composer grows to here, then scrolls.
const COMPOSER_MAX_H = 54;

// Bordered like the prompt block and the file cards — the transcript's three
// containers are the same object at different jobs. Fully round while it's a
// single row; the corner squares off to match the other containers only once
// the input wraps and the card gains a second row.
const composerCard = (theme: OverlayTheme, multiline: boolean) => ({
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: '8px 6px',
  margin: `10px ${SURFACE_PAD}px 10px`,
  padding: multiline ? '12px 12px 8px' : '7px 8px',
  border: `1px solid ${chatInk(theme).stroke}`,
  borderRadius: multiline ? `${RADIUS}px` : '999px',
  transition: 'border-radius 160ms ease, padding 160ms ease',
  flexShrink: 0,
});

const composerInput = () => ({
  width: '100%',
  // Exactly one line box (13px × 1.5). A taller minimum leaves dead space
  // below the top-aligned text, floating the placeholder above the row's
  // centre next to the picker labels.
  minHeight: '20px',
  maxHeight: `${COMPOSER_MAX_H}px`,
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  padding: 0,
  margin: 0,
  fontFamily: 'inherit',
  fontSize: `${SIZE_META}px`,
  lineHeight: 1.5,
  resize: 'none' as const,
  overflowY: 'auto' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
});

// Round hit targets, like the toolbar's icon buttons — the old 4px/5px squares
// were the only sharp corners left in the panel. `.la-tc-icon` paints the hover
// halo (no inline background, or it would outrank the rule).
const attachBtn = () => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '26px',
  height: '26px',
  flexShrink: 0,
  border: 'none',
  borderRadius: '999px',
  color: 'inherit',
  cursor: 'pointer',
  padding: 0,
});

// The popover's send button — inverted against the surface, same as there.
/**
 * The composer's trailing circle — everything but the fill, which is Send's and
 * Stop's one difference.
 */
const circleBtn = (theme: OverlayTheme) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '26px',
  height: '26px',
  flexShrink: 0,
  border: 'none',
  borderRadius: '999px',
  color: surfacePalette(theme).submitText,
  cursor: 'pointer',
  padding: 0,
  // 2px on top of the card's 6px column gap. The picker is a wide, quiet label
  // and the button a small, loud circle; at 6px flat they read as one welded
  // control rather than a control and its trailing action.
  marginLeft: '2px',
  // No inline `transition` — `.la-tc-send` owns the timing (see chatCss).
});

/** Send: the composer's one inverted, primary control. */
const sendBtn = (theme: OverlayTheme) => ({
  ...circleBtn(theme),
  background: surfacePalette(theme).submitBg,
});

/**
 * Stop, wearing the running row's circle rather than Send's.
 *
 * Send is the composer's one inverted, primary control. Stop isn't primary —
 * it undoes — and it already exists elsewhere as `.la-tp-circle` in a running
 * row's corner: a `soft` fill that inverts on hover. Painting it white here
 * made the busy composer louder than the idle one, which is backwards.
 *
 * The fill lives in CSS (`.la-tc-stop`), not inline, so the hover can win.
 * Geometry stays Send's 26 — the row's 24 is sized to the pills beside it, and
 * changing width here would jog the composer every time a run starts.
 */
const stopBtn = (theme: OverlayTheme) => circleBtn(theme);
