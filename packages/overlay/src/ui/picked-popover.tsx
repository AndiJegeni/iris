/** @jsxImportSource preact */
import type {
  Annotation,
  AttachedImage,
  Backend,
  ImageMediaType,
  ReasoningEffort,
  SourceConfidence,
  WorktreeMode,
} from '@localagents/shared';
import { MAX_IMAGES_PER_ANNOTATION, modelLabel } from '@localagents/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Resolution } from '../source-map';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

// Fixed "ink on paper" palette for the message box (matches the pill).
const INK = '#373734'; // all text + icons
const STROKE = 'rgba(55, 55, 52, 0.1)'; // #373734 @ 10% — borders / dividers
const PLACEHOLDER = 'rgba(55, 55, 52, 0.5)'; // #373734 @ 50% — empty input text
const SURFACE = '#ffffff';

// Open/close motion. Keyframe animations (not transitions) so the enter always
// plays on mount without depending on a follow-up rAF tick to flip state — a
// mount/unmount popover has no persistent element to transition. The smooth feel
// comes from the easing + the translateY/scale/opacity combo, borrowed from
// Agentation: a snappy start that settles softly. Close runs a touch quicker so
// dismissals feel responsive, with `forwards` holding the faded-out end state.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OPEN_MS = 220;
const CLOSE_MS = 150;

const ACCEPTED_IMAGE_TYPES: ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Read a File into an AttachedImage (base64, no data-URI prefix). Rejects non-images. */
function fileToImage(file: File): Promise<AttachedImage | null> {
  return new Promise((resolve) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as ImageMediaType)) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result); // "data:<type>;base64,<payload>"
      const comma = result.indexOf(',');
      resolve({
        name: file.name || undefined,
        mediaType: file.type as ImageMediaType,
        dataBase64: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

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
};

/** Resolution confidence → the narrower confidence the annotation schema accepts. */
function annotationConfidence(c: Resolution['confidence']): SourceConfidence {
  if (c === 'explicit') return 'high';
  if (c === 'none') return 'low';
  return c;
}

export type Provider = 'claude' | 'gpt';

export type ModelOption = { value: string; label: string; provider: Provider; backend: Backend };

// Claude legacy models are intentionally omitted.
// Labels come from the shared MODEL_LABELS map (via modelLabel) so the picker
// and the task panel always agree on display names.
export const FALLBACK_MODEL: ModelOption = {
  value: 'opus-4.8',
  label: modelLabel('opus-4.8'),
  provider: 'claude',
  backend: 'claude',
};
export const MODELS: ModelOption[] = [
  FALLBACK_MODEL,
  { value: 'opus-4.8-1m', label: modelLabel('opus-4.8-1m'), provider: 'claude', backend: 'claude' },
  { value: 'sonnet-4.6', label: modelLabel('sonnet-4.6'), provider: 'claude', backend: 'claude' },
  { value: 'haiku-4.5', label: modelLabel('haiku-4.5'), provider: 'claude', backend: 'claude' },
  { value: 'gpt-5.4', label: modelLabel('gpt-5.4'), provider: 'gpt', backend: 'codex' },
  { value: 'gpt-5.5', label: modelLabel('gpt-5.5'), provider: 'gpt', backend: 'codex' },
];

// Reasoning effort differs by provider — GPT has no "Extra"/"Max", it tops out
// at "Extra High".
export const EFFORTS: Record<Provider, { value: ReasoningEffort; label: string }[]> = {
  claude: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'extra', label: 'Extra' },
    { value: 'max', label: 'Max' },
  ],
  gpt: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'extra-high', label: 'Extra High' },
  ],
};

export const DEFAULT_MODEL = 'opus-4.8-1m';

/** A fresh worktree is the default; the user can toggle it off. */
function defaultWorktreeMode(_prompt: string): WorktreeMode {
  return 'new';
}

function MenuHeader({ label, t }: { label: string; t: ThemeTokens }) {
  return (
    <div style={{ padding: '6px 8px 4px' }}>
      <span style={{ fontSize: '13px', color: t.textFaint, opacity: 0.5 }}>{label}</span>
    </div>
  );
}

function MenuRow({
  label,
  selected,
  number,
  onClick,
  t,
}: {
  label: string;
  selected: boolean;
  number?: number;
  onClick: () => void;
  t: ThemeTokens;
}) {
  return (
    <button
      type="button"
      className="la-pp-menu-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: '12px',
        padding: '6px 8px',
        border: 'none',
        borderRadius: '6px',
        // Selected rows keep an inline highlight; others rely on the :hover rule.
        ...(selected ? { background: t.controlBg } : null),
        color: t.textPrimary,
        fontSize: '13px',
        fontFamily: 'inherit',
        letterSpacing: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          color: t.textFaint,
          flexShrink: 0,
        }}
      >
        {selected ? <Icon.Check /> : null}
        {number != null ? (
          <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>{number}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Shared panel chrome for the menu + its nested model submenu. Overflow is
 *  visible (not scrolled) so the nested model submenu can escape the panel
 *  edge — the lists are short enough that scrolling is never needed. */
const menuPanel = (t: ThemeTokens) =>
  ({
    minWidth: '232px',
    // Match the composer surface so the dropdown reads as the same design
    // language: same fill / hairline border / drop shadow / rounding (14px) /
    // backdrop blur as the message-input modal above.
    background: t.surfaceBg,
    border: `1px solid ${t.surfaceBorder}`,
    borderRadius: '14px',
    boxShadow: t.surfaceShadow,
    backdropFilter: 'blur(10px)',
    padding: '8px',
  }) as const;

/** Combined model + reasoning control. The trigger shows "<model> <effort>";
 *  clicking opens the Reasoning list, and a model row at the bottom expands a
 *  nested Model submenu. One control, two menus. */
export function ModelReasoningPicker({
  models,
  model,
  onModelSelect,
  effortOptions,
  effort,
  onEffortSelect,
  modelLabel,
  effortLabel,
  t,
}: {
  models: { value: string; label: string }[];
  model: string;
  onModelSelect: (v: string) => void;
  effortOptions: { value: string; label: string }[];
  effort: string;
  onEffortSelect: (v: string) => void;
  modelLabel: string;
  effortLabel: string;
  t: ThemeTokens;
}) {
  const [open, setOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [subLeft, setSubLeft] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const root = wrapRef.current;
      if (!root) return;
      // The overlay lives in a shadow root, so at the document level e.target
      // retargets to the shadow host — contains(e.target) is false even for
      // clicks landing inside the menu, which would slam it shut before the
      // option's onClick (fired on the trailing click) can run. Test the real
      // path instead so inside-clicks (reasoning options, the model row, the
      // model submenu) keep the menu alive.
      const path = e.composedPath?.() ?? [];
      if (path.includes(root)) return;
      setOpen(false);
      setModelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModelOpen(false);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    // Flip above the trigger when there isn't room below it in the viewport.
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setUp(r.bottom + 320 > window.innerHeight);
    }
    setModelOpen(false);
    setOpen((o) => !o);
  };

  const close = () => {
    setModelOpen(false);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
      <button
        type="button"
        // Closed: resting color from .la-pp-soft (placeholder color, darkens on
        // hover). Open: pin to full ink inline (outranks the class).
        className={open ? undefined : 'la-pp-soft'}
        onClick={toggle}
        aria-label="Model and reasoning"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          maxWidth: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          ...(open ? { color: t.textPrimary } : null),
          fontFamily: 'inherit',
          fontSize: '13px',
          letterSpacing: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{modelLabel}</span>
        <span>{effortLabel}</span>
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            ...(up ? { bottom: '100%', marginBottom: '6px' } : { top: '100%', marginTop: '6px' }),
            zIndex: 10,
            ...menuPanel(t),
          }}
        >
          <MenuHeader label="Reasoning" t={t} />
          {effortOptions.map((o) => (
            <MenuRow
              key={o.value}
              label={o.label}
              selected={o.value === effort}
              onClick={() => {
                onEffortSelect(o.value);
                close();
              }}
              t={t}
            />
          ))}
          {/* Divider, then the current model as an expandable row. */}
          <div style={{ height: '1px', background: t.controlBorder, margin: '6px 2px' }} />
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="la-pp-menu-row la-pp-model-row"
              onClick={(e) => {
                // Open the submenu to the right, flipping left when it would clip.
                if (!modelOpen) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSubLeft(r.right + 248 > window.innerWidth);
                }
                setModelOpen((v) => !v);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: '12px',
                padding: '6px 8px',
                border: 'none',
                borderRadius: '6px',
                ...(modelOpen ? { background: t.controlBg } : null),
                color: t.textPrimary,
                fontSize: '13px',
                fontFamily: 'inherit',
                letterSpacing: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>{modelLabel}</span>
              <span style={{ display: 'inline-flex', color: t.textFaint, flexShrink: 0 }}>
                <Icon.ChevronRight />
              </span>
            </button>
            {modelOpen ? (
              <div
                style={{
                  position: 'absolute',
                  // Float beside the model row like a native submenu (flips side).
                  ...(subLeft
                    ? { right: 'calc(100% + 8px)' }
                    : { left: 'calc(100% + 8px)' }),
                  bottom: 0,
                  zIndex: 11,
                  ...menuPanel(t),
                }}
              >
                <MenuHeader label="Model" t={t} />
                {models.map((m) => (
                  <MenuRow
                    key={m.value}
                    label={m.label}
                    selected={m.value === model}
                    onClick={() => {
                      onModelSelect(m.value);
                      close();
                    }}
                    t={t}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PickedPopover({
  element,
  resolution,
  onClose,
  onSubmit,
  theme = 'dark',
  anchorStyle,
}: PickedPopoverProps) {
  // In light mode the message box is a fixed "ink on paper" surface — override the
  // theme tokens with the #373734 palette in one place so every `t.*` color usage
  // below picks it up. In dark mode it simply follows the overlay's dark tokens so
  // it stays legible over a dark host page.
  const isLight = theme === 'light';
  const t: ThemeTokens = isLight
    ? {
        ...tokens(theme),
        surfaceBg: SURFACE,
        surfaceBorder: STROKE,
        textPrimary: INK,
        textMuted: INK,
        textFaint: INK,
        controlBorder: STROKE,
        chipBg: STROKE,
        chipText: INK,
        link: INK,
        accent: INK,
        accentText: '#ffffff',
        submitBg: INK,
        submitText: '#ffffff',
      }
    : tokens(theme);
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
    if (!userTouchedMode) setWorktreeMode(defaultWorktreeMode(prompt));
  }, [prompt, userTouchedMode]);

  // Autofocus the textarea on mount.
  useEffect(() => {
    textareaRef.current?.focus();
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

  // Clicking outside the popover while typing means "you can't pick another
  // component yet — finish or cancel this first": shake the composer instead of
  // dropping the text. An empty composer just closes. We test composedPath()
  // rather than contains() because the overlay is in a shadow root — at the
  // document level the event target retargets to the shadow host, so contains()
  // would treat every inside-click as outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const path = e.composedPath?.() ?? [];
      if (path.includes(root)) return; // click landed inside the popover
      if (promptRef.current.trim()) {
        shake();
      } else {
        requestClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [requestClose]);

  // Grow the textarea with its content up to 3 lines, then scroll.
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
        {'.la-pp-ta::placeholder{color:var(--la-ph);opacity:1}' +
          '@keyframes la-pp-in{from{opacity:0;transform:translateY(6px) scale(0.96)}to{opacity:1;transform:none}}' +
          '@keyframes la-pp-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(0.96)}}' +
          '.la-pp-menu-row{background:transparent;transition:background 80ms}' +
          `.la-pp-menu-row:hover{background:${t.controlBg}}` +
          // Worktree pill: smooth fill transition on toggle.
          '.la-pp-wt{transition:background 80ms,border-color 80ms}' +
          // Secondary footer text (worktree pill + model menu): resting color
          // matches the composer placeholder, darkening to full ink on hover.
          // Color lives here (not inline) so :hover can win.
          `.la-pp-soft{color:${placeholderColor};transition:color 80ms}` +
          `.la-pp-soft:hover{color:${t.textPrimary}}` +
          '.la-pp-send{transition:opacity 80ms}' +
          // Thin scrollbar for the input once it grows past 3 lines.
          `.la-pp-ta{scrollbar-width:thin;scrollbar-color:${scrollThumb} transparent}` +
          '.la-pp-ta::-webkit-scrollbar{width:4px}' +
          `.la-pp-ta::-webkit-scrollbar-thumb{background:${scrollThumb};border-radius:4px}` +
          '.la-pp-ta::-webkit-scrollbar-track{background:transparent}'}
      </style>

      {dragOver ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '8px',
            border: `2px dashed ${t.accent}`,
            background: theme === 'light' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.16)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: t.accent,
            fontSize: '13px',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          Drop images to attach
        </div>
      ) : null}

      {/* Attached image thumbnails — shown above the prompt input. */}
      {images.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
            marginBottom: 'var(--la-pp-gap, 8px)',
          }}
        >
          {images.map((img, i) => (
            <div
              key={img.dataBase64.slice(0, 24)}
              style={{ position: 'relative', width: '44px', height: '44px' }}
            >
              <img
                src={`data:${img.mediaType};base64,${img.dataBase64}`}
                alt={img.name ?? 'attachment'}
                title={img.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: '6px',
                  border: `1px solid ${t.surfaceBorder}`,
                  display: 'block',
                }}
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                style={thumbRemove(t)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

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
            onClick={() => {
              setUserTouchedMode(true);
              setWorktreeMode((m) => (m === 'same' ? 'new' : 'same'));
            }}
            style={worktreePill(t, worktree, pillFill)}
            title="Run the agent in a fresh git worktree (parallel) instead of the current one"
          >
            {/* Check only takes space when present, so the label shifts on toggle.
                Text/check color + size match the composer placeholder.
                line-height:0 keeps the svg optically centered against the text. */}
            {worktree ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
                <Icon.Check />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={atImageLimit}
            style={{
              ...iconBtn(t),
              // Attach (#373734) sits at 60%; dimmer when at the image limit.
              opacity: atImageLimit ? 0.3 : 0.6,
              cursor: atImageLimit ? 'not-allowed' : 'pointer',
            }}
            title={
              atImageLimit
                ? `Max ${MAX_IMAGES_PER_ANNOTATION} images`
                : 'Attach images (or paste / drop)'
            }
            aria-label="Attach images"
          >
            <Icon.Plus />
          </button>
          <button
            type="button"
            className="la-pp-send"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={{
              ...sendBtn(t),
              // Send (#373734): full when active, 30% when disabled.
              opacity: canSubmit ? 1 : 0.3,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            title="Send (⌘↵)"
          >
            <Icon.ArrowUp />
          </button>
        </div>
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

/**
 * Icons inlined from packages/overlay/src/assets/icons (stroke = currentColor so
 * they take the #373734 ink color). Inlined rather than imported to stay bundler-
 * agnostic across the daemon's Bun build and the example's Next/SWC build.
 */
const Icon = {
  GitBranch: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M2.5 1.25V6.25M2.5 6.25C1.80964 6.25 1.25 6.80964 1.25 7.5C1.25 8.19036 1.80964 8.75 2.5 8.75C3.19036 8.75 3.75 8.19036 3.75 7.5M2.5 6.25C3.19036 6.25 3.75 6.80964 3.75 7.5M7.5 3.75C8.19036 3.75 8.75 3.19036 8.75 2.5C8.75 1.80964 8.19036 1.25 7.5 1.25C6.80964 1.25 6.25 1.80964 6.25 2.5C6.25 3.19036 6.80964 3.75 7.5 3.75ZM7.5 3.75C7.5 4.74456 7.10491 5.69839 6.40165 6.40165C5.69839 7.10491 4.74456 7.5 3.75 7.5"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  Check: () => (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M8.33366 2.5L3.75033 7.08333L1.66699 5"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  Close: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12 4L4 12M4 4L12 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  Gear: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.26369 12.9142L6.65332 13.7905C6.76914 14.0514 6.95817 14.273 7.19747 14.4286C7.43677 14.5841 7.71606 14.6669 8.00147 14.6668C8.28687 14.6669 8.56616 14.5841 8.80546 14.4286C9.04476 14.273 9.23379 14.0514 9.34961 13.7905L9.73924 12.9142C9.87794 12.6033 10.1112 12.3441 10.4059 12.1735C10.7024 12.0025 11.0455 11.9296 11.3859 11.9653L12.3392 12.0668C12.623 12.0968 12.9094 12.0439 13.1637 11.9144C13.418 11.7849 13.6292 11.5844 13.7718 11.3372C13.9146 11.0902 13.9826 10.807 13.9677 10.5221C13.9527 10.2372 13.8553 9.9627 13.6874 9.73202L13.1229 8.95646C12.922 8.67825 12.8146 8.34337 12.8163 8.00016C12.8162 7.65789 12.9246 7.3244 13.1259 7.04757L13.6904 6.27201C13.8583 6.04133 13.9556 5.76688 13.9706 5.48195C13.9856 5.19701 13.9176 4.91386 13.7748 4.66683C13.6322 4.41965 13.4209 4.21916 13.1667 4.08965C12.9124 3.96014 12.626 3.90718 12.3422 3.9372L11.3889 4.03868C11.0484 4.07444 10.7054 4.00158 10.4089 3.83053C10.1136 3.659 9.88025 3.3984 9.74221 3.08609L9.34961 2.20979C9.23379 1.94894 9.04476 1.72731 8.80546 1.57176C8.56616 1.41622 8.28687 1.33345 8.00147 1.3335C7.71606 1.33345 7.43677 1.41622 7.19747 1.57176C6.95817 1.72731 6.76914 1.94894 6.65332 2.20979L6.26369 3.08609C6.12564 3.3984 5.89227 3.659 5.59702 3.83053C5.3005 4.00158 4.95747 4.07444 4.61702 4.03868L3.66072 3.9372C3.37694 3.90718 3.09055 3.96014 2.83627 4.08965C2.58198 4.21916 2.37073 4.41965 2.22813 4.66683C2.08535 4.91386 2.01732 5.19701 2.03231 5.48195C2.0473 5.76688 2.14466 6.04133 2.31258 6.27201L2.87702 7.04757C3.07831 7.3244 3.18671 7.65789 3.18665 8.00016C3.18671 8.34244 3.07831 8.67593 2.87702 8.95276L2.31258 9.72831C2.14466 9.95899 2.0473 10.2335 2.03231 10.5184C2.01732 10.8033 2.08535 11.0865 2.22813 11.3335C2.37088 11.5805 2.58215 11.7809 2.8364 11.9104C3.09064 12.0399 3.37697 12.093 3.66072 12.0631L4.61406 11.9616C4.9545 11.9259 5.29753 11.9987 5.59406 12.1698C5.89041 12.3408 6.12486 12.6015 6.26369 12.9142Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8.00027 10.0002C9.10484 10.0002 10.0003 9.10473 10.0003 8.00016C10.0003 6.89559 9.10484 6.00016 8.00027 6.00016C6.8957 6.00016 6.00027 6.89559 6.00027 8.00016C6.00027 9.10473 6.8957 10.0002 8.00027 10.0002Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  Cursor: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.6699 7.18374C14.0812 7.0238 14.2868 6.94383 14.3446 6.83076C14.3946 6.7328 14.3931 6.61647 14.3405 6.51985C14.2798 6.40834 14.0722 6.33379 13.6568 6.1847L3.06371 2.38203C2.72391 2.26005 2.55401 2.19906 2.44294 2.23753C2.34637 2.27097 2.27048 2.34686 2.23704 2.44343C2.19857 2.5545 2.25956 2.7244 2.38154 3.06419L6.18418 13.6573C6.33327 14.0727 6.40782 14.2803 6.51933 14.341C6.61595 14.3936 6.73228 14.3951 6.83024 14.3451C6.94331 14.2874 7.02328 14.0817 7.18322 13.6704L8.91444 9.21873C8.94577 9.13816 8.96144 9.09788 8.98563 9.06396C9.00708 9.03389 9.03337 9.0076 9.06344 8.98616C9.09736 8.96196 9.13764 8.9463 9.21821 8.91496L13.6699 7.18374Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  Plus: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M7.99967 3.3335V12.6668M3.33301 8.00016H12.6663"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  ArrowUp: () => (
    // viewBox 24 + stroke 2 → glyph spans 58% of the box at a 0.083 stroke ratio,
    // identical to the Plus (9.33/16 span, 1.333/16 stroke), so they render the same size.
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 19V5M19 12L12 5L5 12"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  Chevron: () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
  ChevronRight: () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  ),
};

const POPOVER_WIDTH = 380;
// Height guess for flip-above logic; covers the bar + card stack.
const POPOVER_HEIGHT_GUESS = 260;
const GAP = 8;

function computeAnchor(element: Element): { top: number; left: number } {
  const r = element.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let top = r.bottom + GAP;
  let left = r.left;
  if (left + POPOVER_WIDTH > viewportW - GAP) {
    left = Math.max(GAP, viewportW - POPOVER_WIDTH - GAP);
  }
  if (left < GAP) left = GAP;
  if (top + POPOVER_HEIGHT_GUESS > viewportH - GAP) {
    top = Math.max(GAP, r.top - POPOVER_HEIGHT_GUESS - GAP);
  }
  return { top, left };
}

const iconBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Matches the send button's box so the footer row stays a single height.
  width: '23px',
  height: '23px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: t.textMuted,
  cursor: 'pointer',
  padding: 0,
});

// Worktree toggle, styled as a pill. Active = filled pill with a check (like the
// screenshot); idle = outlined pill (1px border keeps the text in the same spot),
// no check. Text color comes from the .la-pp-soft class (so :hover can darken it
// — inline color would outrank the stylesheet).
const worktreePill = (t: ThemeTokens, active: boolean, fill: string) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  background: active ? fill : 'transparent',
  border: `1px solid ${active ? 'transparent' : t.controlBorder}`,
  borderRadius: '999px',
  padding: '2px 8px',
  margin: 0,
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.2,
  whiteSpace: 'nowrap' as const,
});

const thumbRemove = (t: ThemeTokens) => ({
  position: 'absolute' as const,
  top: '-6px',
  right: '-6px',
  width: '16px',
  height: '16px',
  borderRadius: '999px',
  border: `1px solid ${t.surfaceBorder}`,
  background: t.surfaceBg,
  color: t.textMuted,
  fontSize: '11px',
  lineHeight: '1',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
});

// 13px font × 1.5 line-height. The input starts at 1 line and the auto-grow
// effect steps it 1 → 2 → 3 lines; past 3 it hits this cap and scrolls.
const TEXTAREA_LINE_H = 20; // ≈ 13 × 1.5, one line
const TEXTAREA_MAX_H = 59; // ≈ 3 lines

const textarea = (t: ThemeTokens) => ({
  // Extends 4px past the content box on the right (8px from the card edge) so the
  // scrollbar lines up with the send button's right edge; left stays at 12px.
  width: 'calc(100% + 4px)',
  minHeight: `${TEXTAREA_LINE_H}px`,
  maxHeight: `${TEXTAREA_MAX_H}px`,
  background: 'transparent',
  border: 'none',
  color: t.textPrimary,
  padding: 0,
  fontFamily: 'inherit',
  // 13px — the composer's uniform text size (matches Agentation's 0.8125rem input).
  fontSize: '13px',
  lineHeight: 1.5,
  resize: 'none' as const,
  overflowY: 'auto' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
});

const sendBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Icon is 13px; ~5px padding all around → 23px box, with a soft 5px radius.
  width: '23px',
  height: '23px',
  // Must be 0 — the UA default button padding (1px 6px) otherwise squeezes the
  // 16px icon down to ~11px wide, making it look smaller than the Plus.
  padding: 0,
  background: t.submitBg,
  border: 'none',
  borderRadius: '999px',
  color: t.submitText,
  fontFamily: 'inherit',
});
