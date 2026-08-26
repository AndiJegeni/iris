/** @jsxImportSource preact */
import {
  type AttachedImage,
  MAX_IMAGES_PER_ANNOTATION,
  type ReasoningEffort,
  type Task,
  type TranscriptEntry,
  nextUnanswered,
} from '@iris/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type ChatTab, ChatTabBar } from './chat-tab-bar';
import { PlusThinIcon, SendIcon, StopIcon } from './icons';
import { DEFAULT_MODEL, EFFORTS, MODELS, ModelReasoningPicker } from './model-picker';
import { DragOverlay, ImageStrip } from './picked-popover.parts';
import {
  ACCEPTED_IMAGE_TYPES,
  dragHasFiles,
  dragLeftElement,
  fileToImage,
} from './picked-popover.styles';
import {
  Entry,
  PermissionCard,
  QuestionCard,
  ToolRun,
  WorkingRow,
  assistantText,
  chatInk,
  groupTranscript,
  isQuietRow,
  isToolRunLive,
} from './task-chat.transcript';
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
  onSend: (
    text: string,
    opts: { model: string; effort: ReasoningEffort; images: AttachedImage[] },
  ) => void | Promise<void>;
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
  // Attachments for the next follow-up, same pipeline as the popover's
  // (fileToImage → AttachedImage). Attaching is never blocked on the task's
  // state: images picked while a question is pending simply wait in the strip
  // and ride the next regular follow-up (see submit).
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [effort, setEffort] = useState<ReasoningEffort>('medium');
  const selectedModel = modelChoices.find((m) => m.value === model) ?? modelChoices[0]!;
  const effortOptions = EFFORTS[selectedModel.provider];
  const changeModel = (value: string) => {
    setModel(value);
    const next = MODELS.find((m) => m.value === value);
    if (next && !EFFORTS[next.provider].some((e) => e.value === effort)) setEffort('high');
  };
  // A blocked run arrives here as `busy` — it is still running, from the
  // drawer's point of view — but the composer is exactly what unblocks it, so
  // this is the one kind of busy that must not lock the input. Declared above
  // the effects because the auto-scroll below watches it.
  const pending = task.status === 'awaiting-input' ? task.question : undefined;
  const asked = pending ? nextUnanswered(pending) : null;
  // The list's real unit: a run of tool calls is one row, not one row per call.
  // While that run is in flight it carries the pulse itself, so the Working…
  // row stands down — two pulsing rows would claim two things were happening.
  const rows = groupTranscript(entries);
  const lastRow = rows[rows.length - 1];
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
    // `asked` too: the question card is appended below the last entry without
    // changing the entry count, so without it the one block the user must read
    // can arrive off the bottom of a scrolled-back transcript.
  }, [entries.length, logsFallback.length, busy, asked]);

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

  const addFiles = async (files: FileList | File[]) => {
    const encoded = await Promise.all(Array.from(files).map(fileToImage));
    const valid = encoded.filter((x): x is AttachedImage => x !== null);
    if (valid.length === 0) return;
    setImages((prev) => [...prev, ...valid].slice(0, MAX_IMAGES_PER_ANNOTATION));
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  // biome-ignore lint/suspicious/noExplicitAny: Preact clipboard event typed against root React types
  const handlePaste = (e: any) => {
    const items: DataTransferItemList | undefined = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const locked = (busy && !asked) || sending;
  const atImageLimit = images.length >= MAX_IMAGES_PER_ANNOTATION;
  // An image with no words is a legitimate message ("make it look like this")
  // — but not as an answer, which delivers plain text into the agent's open
  // question and has no image channel.
  const canSend = (!!draft.trim() || (!asked && images.length > 0)) && !locked;
  // Picking an option is the same act as typing its wording — it goes out as an
  // ordinary message and the daemon matches it back to the choice. Rejections
  // are swallowed the way the composer's own send swallows them: the row's
  // status is what reports a run that has gone.
  const answer = (label: string) => {
    if (sending) return;
    setSending(true);
    void Promise.resolve(onSend(label, { model: selectedModel.value, effort, images: [] })).then(
      () => setSending(false),
      () => setSending(false),
    );
  };

  const submit = async () => {
    const text = draft.trim();
    // While a question is up the message is the answer, and answers travel as
    // plain text — attached images stay in the strip for the next follow-up
    // rather than silently vanishing into a channel that can't carry them.
    const imgs = asked ? [] : images;
    if ((!text && imgs.length === 0) || locked) return;
    setDraft('');
    setSending(true);
    try {
      await onSend(text, { model: selectedModel.value, effort, images: imgs });
      if (imgs.length > 0) setImages([]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={shell(theme)}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (dragLeftElement(e, e.currentTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
      }}
    >
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
          ? rows.map((row, i) => {
              // Two consecutive quiet rows close ranks; anything else gets air.
              const prev = i > 0 ? rows[i - 1] : undefined;
              const tight = Boolean(prev && isQuietRow(prev) && isQuietRow(row));
              return (
                <div key={row.key} style={{ marginTop: i === 0 ? 0 : tight ? TIGHT : LOOSE }}>
                  {row.kind === 'tools' ? (
                    // Only the last run can be in flight; an earlier one is
                    // history no matter what its calls last reported.
                    <ToolRun
                      entries={row.entries}
                      live={busy && i === rows.length - 1}
                      theme={theme}
                    />
                  ) : (
                    <Entry entry={row.entry} theme={theme} />
                  )}
                </div>
              );
            })
          : logsFallback.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines are positional
              <div key={i} style={assistantText(theme)}>
                {line}
              </div>
            ))}
        {/* The question replaces the "Working…" pulse rather than joining it:
            nothing is working, and two live-looking rows would say otherwise. */}
        {asked ? (
          // `marginTop: auto` docks the card to the bottom of the list, right
          // above the composer (Claude Code's ask sits there), instead of
          // floating at the top with dead space between it and the input. It
          // collapses to nothing once the transcript is long enough to scroll,
          // so a full conversation keeps its normal top-down flow. The negative
          // bottom margin exactly cancels the list's 16px bottom padding (no
          // more, or the list gains a 2px scrollbar), so the only gap left to
          // the input is the composer's 8px top margin.
          <div
            key="question"
            style={{
              marginTop: 'auto',
              paddingTop: entries.length === 0 ? 0 : LOOSE,
              marginBottom: '-16px',
            }}
          >
            {asked.kind === 'permission' ? (
              <PermissionCard
                title={asked.question}
                resource={asked.resource}
                options={asked.options}
                header={asked.header}
                theme={theme}
                onAnswer={answer}
              />
            ) : (
              <QuestionCard
                question={asked.question}
                options={asked.options}
                index={pending ? Object.keys(pending.answers).length + 1 : 1}
                total={pending ? pending.questions.length : 1}
                theme={theme}
                onAnswer={answer}
              />
            )}
          </div>
        ) : busy && !isToolRunLive(lastRow) ? (
          // Keyed so streaming entries reconcile around it instead of rebuilding
          // it. Tight against a run of quiet rows, but a full block gap after
          // anything loud — right after your own prompt it was the one row
          // sitting 3px under a filled block.
          <div
            key="working"
            style={{
              marginTop: lastRow == null ? 0 : isQuietRow(lastRow) ? TIGHT : LOOSE,
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
      <div style={composerCard(theme, multiline || images.length > 0)}>
        <style>{chatCss(theme)}</style>
        {/* The drop veil covers the composer, where the images land — the drop
            itself is still accepted anywhere on the panel. */}
        {dragOver ? (
          <DragOverlay
            theme={theme}
            radius={multiline || images.length > 0 ? `${RADIUS}px` : '999px'}
          />
        ) : null}
        {/* Attached thumbnails, on their own full-width row above the input —
            order -1 keeps them first regardless of the pill/card flip. */}
        {images.length > 0 ? (
          <div style={{ flexBasis: '100%', order: -1 }}>
            <ImageStrip images={images} onRemove={removeImage} t={t} />
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            if (input.files?.length) void addFiles(input.files);
            input.value = '';
          }}
        />
        <button
          type="button"
          className="la-tc-icon"
          style={{
            ...attachBtn(),
            // Leads the control row either way: on one line it precedes the
            // input, and once the input takes its own row it leads what is left
            // beneath. Ordering it after the picker when wrapped made the two
            // swap places as you typed.
            order: multiline ? 1 : 0,
            ...(atImageLimit ? { opacity: 0.3, cursor: 'not-allowed' } : {}),
          }}
          disabled={atImageLimit}
          onClick={() => fileInputRef.current?.click()}
          title={
            atImageLimit
              ? `Max ${MAX_IMAGES_PER_ANNOTATION} images`
              : 'Attach images (or paste / drop)'
          }
          aria-label="Attach images"
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
          onPaste={handlePaste}
          rows={1}
          placeholder={
            asked ? 'Answer to continue' : busy ? 'Agent is working…' : 'Reply or ask a follow-up'
          }
          disabled={busy && !asked}
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
            // Always after the attach button — see its comment above.
            order: 2,
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
        {/* Stop yields to Send while a question is up: stopping is still on the
            row in the drawer, and the one control in the composer should be the
            one that gets the run moving again. */}
        {onCancel && busy && !asked ? (
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
    // :not(:disabled): the attach circle disables at the image limit, and a
    // hover halo on a dead control reads as pressable.
    `.la-tc-icon:hover:not(:disabled){background:${p.hover};box-shadow:0 0 0 2px ${p.hover}}`,
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
// chat used to be transparent, so any host that framed it in a hand-picked
// colour silently showed it on a lighter card than the popover's. A component
// that owns its background can't be mis-framed.
const shell = (theme: OverlayTheme) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
  minHeight: 0,
  position: 'relative' as const,
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
  // Anchors the drop veil (absolute, inset 0) to the composer.
  position: 'relative' as const,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: '8px 6px',
  margin: `8px ${SURFACE_PAD}px 10px`,
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
