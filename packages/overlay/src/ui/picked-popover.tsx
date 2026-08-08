/** @jsxImportSource preact */
import type { Annotation, AttachedImage, ReasoningEffort, WorktreeMode } from '@iris/shared';
import { MAX_IMAGES_PER_ANNOTATION } from '@iris/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Resolution } from '../source-resolution';
import { CheckIcon } from './icons';
import {
  DEFAULT_MODEL,
  EFFORTS,
  FALLBACK_MODEL,
  MODELS,
  ModelReasoningPicker,
} from './model-picker';
import { DragOverlay, FooterActions, ImageStrip } from './picked-popover.parts';
import {
  ACCEPTED_IMAGE_TYPES,
  CLOSE_MS,
  EASE,
  OPEN_MS,
  PLACEHOLDER,
  POPOVER_WIDTH,
  TEXTAREA_MAX_H,
  annotationConfidence,
  computeAnchor,
  defaultWorktreeMode,
  fileToImage,
  textarea,
  worktreePill,
} from './picked-popover.styles';
import { type OverlayTheme, type ThemeTokens, popoverTokens } from './theme';

type PickedPopoverProps = {
  /** The picked element, or omitted for the element-less "chat" composer. */
  element?: Element;
  /** Source resolution for the picked element; omitted in chat mode. */
  resolution?: Resolution;
  onClose: () => void;
  onSubmit: (annotation: Annotation) => Promise<void>;
  theme?: OverlayTheme;
  /** Element-less (chat) mode: position override so it tracks the pill. */
  anchorStyle?: Record<string, string>;
  /**
   * Whether the daemon is running in a git repo. Worktree mode clones the repo,
   * so without git the toggle is disabled rather than failing on submit.
   * Defaults true so the control doesn't flicker before the first 'hello'.
   */
  gitAvailable?: boolean;
};

export function PickedPopover({
  element,
  resolution,
  onClose,
  onSubmit,
  theme = 'dark',
  anchorStyle,
  gitAvailable = true,
}: PickedPopoverProps) {
  // In light mode the message box is a fixed "ink on paper" surface; in dark it
  // follows the overlay's dark tokens so it stays legible over a dark host page.
  // Both live in popoverTokens (theme.ts) — shared, because the chat and the task
  // drawer now paint from the same palette and render the same picker.
  const isLight = theme === 'light';
  const t: ThemeTokens = popoverTokens(theme);
  // A few surfaces the popover paints outside the token set — themed by hand so the
  // dark variant doesn't fall back to the light ink palette.
  const placeholderColor = isLight ? PLACEHOLDER : 'rgba(245, 245, 245, 0.4)';
  const scrollThumb = isLight ? 'rgba(55, 55, 52, 0.25)' : 'rgba(255, 255, 255, 0.22)';
  // Worktree pill: #EBEBEB @ 50% fill, #373734 @ 55% text (light); hover lifts
  // the text to full ink.
  const pillFill = isLight ? 'rgba(235, 235, 235, 0.5)' : t.chipBg;
  const errorBg = isLight ? 'rgba(239, 68, 68, 0.1)' : 'rgba(248, 113, 113, 0.12)';
  const errorBorder = isLight ? 'rgba(239, 68, 68, 0.3)' : 'rgba(248, 113, 113, 0.35)';
  const errorText = isLight ? '#dc2626' : '#f87171';
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<ReasoningEffort>('high');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('new');

  const selectedModel = MODELS.find((m) => m.value === model) ?? FALLBACK_MODEL;
  const provider = selectedModel.provider;
  const effortOptions = EFFORTS[provider];

  // Switching provider can invalidate the current effort (e.g. "max" → GPT) —
  // fall back to "high" when the chosen effort isn't offered by the new model.
  const changeModel = (value: string) => {
    setModel(value);
    const next = MODELS.find((m) => m.value === value);
    if (next && !EFFORTS[next.provider].some((e) => e.value === effort)) {
      setEffort('high');
    }
  };
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Element mode anchors to the picked element; chat mode floats bottom-right
  // above the pill (no element to point at).
  const anchor = element ? computeAnchor(element) : null;

  // Exit animation: a close request doesn't unmount immediately — it flips
  // `closing` (which swaps the open keyframes for the reverse `la-pp-out`), lets
  // it play, then calls the parent's onClose to actually unmount. Guards against
  // double-firing (Esc + outside-click) and clears the timer on unmount.
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const requestClose = useCallback(() => {
    if (closeTimerRef.current != null) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => onClose(), CLOSE_MS);
  }, [onClose]);
  useEffect(
    () => () => {
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // Esc closes the popover with the same exit animation. Handled here (rather than
  // in the parent Overlay) so it shares the requestClose → animate → unmount path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

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

  // Track default worktree-mode but only until the user touches the toggle.
  const [userTouchedMode, setUserTouchedMode] = useState(false);
  useEffect(() => {
    if (!gitAvailable) {
      setWorktreeMode('same');
      return;
    }
    if (!userTouchedMode) setWorktreeMode(defaultWorktreeMode(prompt));
  }, [prompt, userTouchedMode, gitAvailable]);

  // Autofocus the textarea on open. Deferred one frame: focusing synchronously on
  // mount races the click that opened the popover — the browser's post-click focus
  // handling lands after the effect and steals it back, and the node is mid
  // entrance-animation — so the focus silently fails and the composer opens
  // unfocused. A rAF defer lets the open settle so focus reliably sticks;
  // preventScroll keeps the host page from jumping to the overlay.
  useEffect(() => {
    const raf = requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Read the latest prompt from a ref inside the outside-click handler so the
  // listener doesn't close over a stale value (and doesn't need re-registering
  // on every keystroke).
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  // Play a fresh left-right shake on the composer. Uses the Web Animations API
  // (not a CSS class) so it RE-TRIGGERS on every call — click another component,
  // then another, and each one shakes — and so it never fights the open
  // animation's transform. Skipped if the API is unavailable (very old browsers).
  const shake = () => {
    const el = rootRef.current;
    if (!el?.animate) return;
    el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-7px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' },
    );
  };

  // An outside click never silently destroys the composer: clicking the page — or
  // the very element it's anchored to, right after you picked it — shouldn't make
  // it vanish. If there's unsent text, nudge (shake) as a "finish or press Escape
  // first" cue; if it's empty, just leave it open. Dismissal is deliberate: Escape
  // or submit. We test composedPath() rather than contains() because the overlay is
  // in a shadow root — at the document level the event target retargets to the
  // shadow host, so contains() would treat every inside-click as outside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: shake reads latest via refs
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const path = e.composedPath?.() ?? [];
      if (path.includes(root)) return; // click landed inside the popover
      if (promptRef.current.trim()) shake();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, []);

  // Grow the textarea with its content up to 3 lines, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize when prompt changes
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_H)}px`;
  }, [prompt]);

  const submit = async () => {
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError(null);
    const annotation: Annotation = {
      prompt: prompt.trim(),
      source: resolution?.source ?? null,
      selector: resolution?.selector ?? null,
      componentPath: resolution?.componentPath ?? [],
      nearbyText: resolution?.text ?? null,
      confidence: resolution ? annotationConfidence(resolution.confidence) : 'low',
      worktreeMode,
      backend: selectedModel.backend,
      model: selectedModel.value,
      reasoningEffort: effort,
      images,
    };
    try {
      await onSubmit(annotation);
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // biome-ignore lint/suspicious/noExplicitAny: Preact event typed against root React types here
  const handleKeyDown = (e: any) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  };

  const worktree = worktreeMode === 'new';
  const atImageLimit = images.length >= MAX_IMAGES_PER_ANNOTATION;
  const canSubmit = !!prompt.trim() && !sending;

  return (
    <div
      ref={rootRef}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the cursor actually leaves the popover, not on child enter.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
      }}
      style={{
        position: 'fixed',
        // Element mode pins to the picked element's top-left; chat mode floats
        // just above the pill (anchorStyle tracks its dragged position; falls
        // back to bottom-right).
        ...(anchor
          ? { top: `${anchor.top}px`, left: `${anchor.left}px`, transformOrigin: 'top left' }
          : {
              ...(anchorStyle ?? { bottom: '70px', right: '16px' }),
              transformOrigin: 'bottom right',
            }),
        width: `${POPOVER_WIDTH}px`,
        background: t.surfaceBg,
        color: t.textPrimary,
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: '8px',
        boxShadow: t.surfaceShadow,
        // Spacing tokens (overridable via CSS vars for the gallery playground).
        // top / x / bottom — places the input 12px from the top and left edges.
        padding: 'var(--la-pp-pad-t, 10px) var(--la-pp-pad-x, 12px) var(--la-pp-pad-b, 6px)',
        fontSize: '13px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        lineHeight: 1.5,
        letterSpacing: '-0.02em',
        pointerEvents: 'auto',
        backdropFilter: 'blur(10px)',
        // Grows from the anchored corner (transformOrigin set per-mode above).
        // The shake (error nudge) runs imperatively via the Web Animations API in
        // shake(); it only fires once the popover is fully open, so it never
        // collides with this open/close animation's transform.
        animation: closing
          ? `la-pp-out ${CLOSE_MS}ms ${EASE} forwards`
          : `la-pp-in ${OPEN_MS}ms ${EASE}`,
        willChange: 'transform, opacity',
      }}
    >
      {/* Scoped placeholder color + control hover states + the open/close
          keyframes (a soft scale-up + rise that eases in, and its reverse). */}
      <style>
        {`.la-pp-ta::placeholder{color:var(--la-ph);opacity:1}@keyframes la-pp-in{from{opacity:0;transform:translateY(6px) scale(0.96)}to{opacity:1;transform:none}}@keyframes la-pp-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(0.96)}}.la-pp-menu-row{background:transparent;transition:background 80ms}.la-pp-menu-row:hover{background:${t.controlBg}}.la-pp-wt{transition:background 80ms,border-color 80ms}.la-pp-soft{color:${placeholderColor};transition:color 80ms}.la-pp-soft:hover{color:${t.textPrimary}}.la-pp-send{transition:opacity 80ms}.la-pp-ta{scrollbar-width:thin;scrollbar-color:${scrollThumb} transparent}.la-pp-ta::-webkit-scrollbar{width:4px}.la-pp-ta::-webkit-scrollbar-thumb{background:${scrollThumb};border-radius:4px}.la-pp-ta::-webkit-scrollbar-track{background:transparent}`}
      </style>

      {dragOver ? <DragOverlay t={t} theme={theme} /> : null}

      {/* Attached image thumbnails — shown above the prompt input. */}
      {images.length > 0 ? <ImageStrip images={images} onRemove={removeImage} t={t} /> : null}

      <textarea
        ref={textareaRef}
        className="la-pp-ta"
        value={prompt}
        onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Describe a task or ask a question"
        rows={1}
        // biome-ignore lint/suspicious/noExplicitAny: CSS custom property for ::placeholder color
        style={{ ...textarea(t), '--la-ph': placeholderColor } as any}
      />

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

      {/* Footer: model on the left, action icons on the right. Breaks out to the
          card edges (cancels the card padding) so the whole cluster (pill · model
          · attach · send) sits 6px from the modal's left/right edges. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'var(--la-pp-gap, 12px)',
          marginLeft: 'calc(-1 * var(--la-pp-pad-x, 12px))',
          marginRight: 'calc(-1 * var(--la-pp-pad-x, 12px))',
          paddingLeft: '6px',
          paddingRight: '6px',
          gap: '8px',
        }}
      >
        {/* Left cluster: worktree toggle, then model · effort menus. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <button
            type="button"
            className="la-pp-wt la-pp-soft"
            disabled={!gitAvailable}
            onClick={() => {
              if (!gitAvailable) return;
              setUserTouchedMode(true);
              setWorktreeMode((m) => (m === 'same' ? 'new' : 'same'));
            }}
            style={{
              ...worktreePill(t, worktree, pillFill),
              ...(gitAvailable ? {} : { opacity: 0.45, cursor: 'not-allowed' }),
            }}
            title={
              gitAvailable
                ? 'Run the agent in a fresh git worktree (parallel) instead of the current one'
                : 'Unavailable — this project isn\u2019t a git repository'
            }
          >
            {/* Check only takes space when present, so the label shifts on toggle.
                Text/check color + size match the composer placeholder.
                line-height:0 keeps the svg optically centered against the text. */}
            {worktree ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
                <CheckIcon />
              </span>
            ) : null}
            <span>Worktree</span>
          </button>
          <ModelReasoningPicker
            models={MODELS.map((m) => ({ value: m.value, label: m.label }))}
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
        {/* Right cluster: attach · send */}
        <FooterActions
          atImageLimit={atImageLimit}
          canSubmit={canSubmit}
          onAttach={() => fileInputRef.current?.click()}
          onSubmit={() => void submit()}
          t={t}
        />
      </div>

      {error ? (
        <div
          style={{
            marginTop: 'var(--la-pp-gap, 8px)',
            padding: '8px 10px',
            background: errorBg,
            border: `1px solid ${errorBorder}`,
            color: errorText,
            borderRadius: '8px',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
