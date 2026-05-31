/** @jsxImportSource preact */
import type {
  Annotation,
  AttachedImage,
  Backend,
  ImageMediaType,
  SourceConfidence,
  WorktreeMode,
} from '@localagents/shared';
import { MAX_IMAGES_PER_ANNOTATION } from '@localagents/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Resolution } from '../source-map';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

// Fixed "ink on paper" palette for the message box (matches the pill).
const INK = '#373734'; // all text + icons
const STROKE = 'rgba(55, 55, 52, 0.1)'; // #373734 @ 10% — borders / dividers
const PLACEHOLDER = 'rgba(55, 55, 52, 0.5)'; // #373734 @ 50% — empty input text
const SURFACE = '#ffffff';

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
  element: Element;
  resolution: Resolution;
  onClose: () => void;
  onSubmit: (annotation: Annotation) => Promise<void>;
  theme?: OverlayTheme;
};

const CONFIDENCE_LABEL: Record<Resolution['confidence'], string> = {
  explicit: 'explicit · data-source',
  high: 'high · _debugSource',
  medium: 'medium · dispatcher probe',
  low: 'low · selector only',
  none: 'no react fiber',
};

const CONFIDENCE_COLOR: Record<Resolution['confidence'], string> = {
  explicit: '#22c55e',
  high: '#22c55e',
  medium: '#eab308',
  low: '#f97316',
  none: '#6b7280',
};

/** Resolution confidence → the narrower confidence the annotation schema accepts. */
function annotationConfidence(c: Resolution['confidence']): SourceConfidence {
  if (c === 'explicit') return 'high';
  if (c === 'none') return 'low';
  return c;
}

const BACKEND_OPTIONS: { value: Backend; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'echo', label: 'Echo (dev)' },
];

/** Heuristic: long or refactor-y prompts → new worktree by default. */
function defaultWorktreeMode(prompt: string): WorktreeMode {
  if (prompt.length > 200) return 'new';
  if (/\brefactor\b|\brewrite\b|\bredesign\b/i.test(prompt)) return 'new';
  return 'same';
}

export function PickedPopover({
  element,
  resolution,
  onClose,
  onSubmit,
  theme = 'dark',
}: PickedPopoverProps) {
  // The message box is a fixed light "ink on paper" surface regardless of host
  // theme — override the theme tokens with the #373734 palette in one place so
  // every `t.*` color usage below picks it up.
  const t: ThemeTokens = {
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
  };
  const [prompt, setPrompt] = useState('');
  const [backend, setBackend] = useState<Backend>('claude');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('same');
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const anchor = computeAnchor(element);

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

  const submit = async () => {
    if (!prompt.trim() || sending) return;
    setSending(true);
    setError(null);
    const annotation: Annotation = {
      prompt: prompt.trim(),
      source: resolution.source,
      selector: resolution.selector,
      componentPath: resolution.componentPath,
      nearbyText: resolution.text,
      confidence: annotationConfidence(resolution.confidence),
      worktreeMode,
      backend,
      images,
    };
    try {
      await onSubmit(annotation);
      onClose();
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
  const extraComponents = resolution.componentPath.length - 1;

  return (
    <div
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
        top: `${anchor.top}px`,
        left: `${anchor.left}px`,
        width: `${POPOVER_WIDTH}px`,
        background: t.surfaceBg,
        color: t.textPrimary,
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: '14px',
        boxShadow: t.surfaceShadow,
        padding: '14px 16px 12px',
        fontSize: '12px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        lineHeight: 1.5,
        pointerEvents: 'auto',
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Scoped placeholder color (theme-driven, per-instance via CSS var). */}
      <style>{'.la-pp-ta::placeholder{color:var(--la-ph);opacity:1}'}</style>

      {dragOver ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '14px',
            border: `2px dashed ${t.accent}`,
            background: theme === 'light' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.16)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: t.accent,
            fontSize: '13px',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          Drop images to attach
        </div>
      ) : null}

      {/* Picked-element source line (the selection) — shown above the controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          marginBottom: '8px',
          minWidth: 0,
        }}
        title={resolution.selector ?? undefined}
      >
        <span
          style={{
            display: 'inline-block',
            width: '7px',
            height: '7px',
            borderRadius: '999px',
            background: CONFIDENCE_COLOR[resolution.confidence],
            flexShrink: 0,
          }}
          title={CONFIDENCE_LABEL[resolution.confidence]}
        />
        {resolution.source ? (
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px' }}>
            <span style={{ color: t.link }}>{resolution.source.file}</span>
            <span style={{ color: t.textMuted }}>
              :{resolution.source.line}
              {resolution.source.column != null ? `:${resolution.source.column}` : ''}
            </span>
          </span>
        ) : (
          <span
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: '12px',
              color: t.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {resolution.selector}
          </span>
        )}
        {resolution.componentPath[0] ? (
          <code style={chip(t)}>{`<${resolution.componentPath[0]}/>`}</code>
        ) : null}
        {extraComponents > 0 ? (
          <span style={{ color: t.textFaint, fontSize: '12px', flexShrink: 0 }}>
            +{extraComponents}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          style={{ ...iconBtn(t), marginLeft: 'auto', flexShrink: 0 }}
          title="Close"
        >
          <Icon.Close />
        </button>
      </div>

      {/* Controls: branch + worktree toggle (below the selection) */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
        <div style={branchPill(t)}>
          <Icon.GitBranch />
          <span style={{ fontWeight: 400, color: t.textPrimary, fontSize: '12px' }}>main</span>
          <span
            style={{
              width: '1px',
              alignSelf: 'stretch',
              margin: '-2px 2px',
              background: t.controlBorder,
            }}
          />
          <button
            type="button"
            onClick={() => {
              setUserTouchedMode(true);
              setWorktreeMode((m) => (m === 'same' ? 'new' : 'same'));
            }}
            style={checkboxRow}
            title="Run the agent in a fresh git worktree (parallel) instead of the current one"
          >
            <span
              style={{
                ...checkbox(t),
                ...(worktree ? { background: t.accent, borderColor: t.accent } : null),
                color: t.accentText,
              }}
            >
              {worktree ? <Icon.Check /> : null}
            </span>
            <span style={{ color: t.textPrimary }}>worktree</span>
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="la-pp-ta"
        value={prompt}
        onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Describe a task or ask a question"
        rows={2}
        // biome-ignore lint/suspicious/noExplicitAny: CSS custom property for ::placeholder color
        style={{ ...textarea(t), '--la-ph': PLACEHOLDER } as any}
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

      {images.length > 0 ? (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
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

      {/* Footer: model on the left, action icons on the right */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '10px',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <select
            value={backend}
            onChange={(e) => setBackend((e.target as HTMLSelectElement).value as Backend)}
            style={modelSelect(t)}
          >
            {BACKEND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span style={{ color: t.textFaint, fontSize: '12px', flexShrink: 0 }}>Auto</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ ...iconBtn(t), cursor: 'default' }} title="Settings">
            <Icon.Gear />
          </span>
          <span style={{ ...iconBtn(t), cursor: 'default' }} title="Picked element">
            <Icon.Cursor />
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={atImageLimit}
            style={{
              ...iconBtn(t),
              opacity: atImageLimit ? 0.4 : 1,
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
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={{
              ...sendBtn(t),
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            title="Send (⌘↵)"
          >
            <Icon.Return />
          </button>
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 10px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#dc2626',
            borderRadius: '8px',
            fontSize: '12px',
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
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M2.5 1.25V6.25M2.5 6.25C1.80964 6.25 1.25 6.80964 1.25 7.5C1.25 8.19036 1.80964 8.75 2.5 8.75C3.19036 8.75 3.75 8.19036 3.75 7.5M2.5 6.25C3.19036 6.25 3.75 6.80964 3.75 7.5M7.5 3.75C8.19036 3.75 8.75 3.19036 8.75 2.5C8.75 1.80964 8.19036 1.25 7.5 1.25C6.80964 1.25 6.25 1.80964 6.25 2.5C6.25 3.19036 6.80964 3.75 7.5 3.75ZM7.5 3.75C7.5 4.74456 7.10491 5.69839 6.40165 6.40165C5.69839 7.10491 4.74456 7.5 3.75 7.5"
        stroke="currentColor"
        strokeWidth="0.833333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Check: () => (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M8.33366 2.5L3.75033 7.08333L1.66699 5"
        stroke="currentColor"
        strokeWidth="0.833333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Close: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12 4L4 12M4 4L12 12"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Gear: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.26369 12.9142L6.65332 13.7905C6.76914 14.0514 6.95817 14.273 7.19747 14.4286C7.43677 14.5841 7.71606 14.6669 8.00147 14.6668C8.28687 14.6669 8.56616 14.5841 8.80546 14.4286C9.04476 14.273 9.23379 14.0514 9.34961 13.7905L9.73924 12.9142C9.87794 12.6033 10.1112 12.3441 10.4059 12.1735C10.7024 12.0025 11.0455 11.9296 11.3859 11.9653L12.3392 12.0668C12.623 12.0968 12.9094 12.0439 13.1637 11.9144C13.418 11.7849 13.6292 11.5844 13.7718 11.3372C13.9146 11.0902 13.9826 10.807 13.9677 10.5221C13.9527 10.2372 13.8553 9.9627 13.6874 9.73202L13.1229 8.95646C12.922 8.67825 12.8146 8.34337 12.8163 8.00016C12.8162 7.65789 12.9246 7.3244 13.1259 7.04757L13.6904 6.27201C13.8583 6.04133 13.9556 5.76688 13.9706 5.48195C13.9856 5.19701 13.9176 4.91386 13.7748 4.66683C13.6322 4.41965 13.4209 4.21916 13.1667 4.08965C12.9124 3.96014 12.626 3.90718 12.3422 3.9372L11.3889 4.03868C11.0484 4.07444 10.7054 4.00158 10.4089 3.83053C10.1136 3.659 9.88025 3.3984 9.74221 3.08609L9.34961 2.20979C9.23379 1.94894 9.04476 1.72731 8.80546 1.57176C8.56616 1.41622 8.28687 1.33345 8.00147 1.3335C7.71606 1.33345 7.43677 1.41622 7.19747 1.57176C6.95817 1.72731 6.76914 1.94894 6.65332 2.20979L6.26369 3.08609C6.12564 3.3984 5.89227 3.659 5.59702 3.83053C5.3005 4.00158 4.95747 4.07444 4.61702 4.03868L3.66072 3.9372C3.37694 3.90718 3.09055 3.96014 2.83627 4.08965C2.58198 4.21916 2.37073 4.41965 2.22813 4.66683C2.08535 4.91386 2.01732 5.19701 2.03231 5.48195C2.0473 5.76688 2.14466 6.04133 2.31258 6.27201L2.87702 7.04757C3.07831 7.3244 3.18671 7.65789 3.18665 8.00016C3.18671 8.34244 3.07831 8.67593 2.87702 8.95276L2.31258 9.72831C2.14466 9.95899 2.0473 10.2335 2.03231 10.5184C2.01732 10.8033 2.08535 11.0865 2.22813 11.3335C2.37088 11.5805 2.58215 11.7809 2.8364 11.9104C3.09064 12.0399 3.37697 12.093 3.66072 12.0631L4.61406 11.9616C4.9545 11.9259 5.29753 11.9987 5.59406 12.1698C5.89041 12.3408 6.12486 12.6015 6.26369 12.9142Z"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.00027 10.0002C9.10484 10.0002 10.0003 9.10473 10.0003 8.00016C10.0003 6.89559 9.10484 6.00016 8.00027 6.00016C6.8957 6.00016 6.00027 6.89559 6.00027 8.00016C6.00027 9.10473 6.8957 10.0002 8.00027 10.0002Z"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Cursor: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.6699 7.18374C14.0812 7.0238 14.2868 6.94383 14.3446 6.83076C14.3946 6.7328 14.3931 6.61647 14.3405 6.51985C14.2798 6.40834 14.0722 6.33379 13.6568 6.1847L3.06371 2.38203C2.72391 2.26005 2.55401 2.19906 2.44294 2.23753C2.34637 2.27097 2.27048 2.34686 2.23704 2.44343C2.19857 2.5545 2.25956 2.7244 2.38154 3.06419L6.18418 13.6573C6.33327 14.0727 6.40782 14.2803 6.51933 14.341C6.61595 14.3936 6.73228 14.3951 6.83024 14.3451C6.94331 14.2874 7.02328 14.0817 7.18322 13.6704L8.91444 9.21873C8.94577 9.13816 8.96144 9.09788 8.98563 9.06396C9.00708 9.03389 9.03337 9.0076 9.06344 8.98616C9.09736 8.96196 9.13764 8.9463 9.21821 8.91496L13.6699 7.18374Z"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Plus: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M7.99967 3.3335V12.6668M3.33301 8.00016H12.6663"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Return: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.3337 2.6665V3.59984C13.3337 5.84005 13.3337 6.96015 12.8977 7.8158C12.5142 8.56845 11.9023 9.18037 11.1496 9.56386C10.294 9.99984 9.17387 9.99984 6.93366 9.99984H2.66699M6.00033 13.3332L2.66699 9.99984L6.00033 6.6665"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const POPOVER_WIDTH = 360;
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
  width: '28px',
  height: '28px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: t.textMuted,
  cursor: 'pointer',
  padding: 0,
});

const branchPill = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 8px',
  border: `1px solid ${t.controlBorder}`,
  borderRadius: '8px',
  fontSize: '12px',
  color: t.textMuted,
});

const checkboxRow = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  fontSize: '12px',
  fontFamily: 'inherit',
};

const checkbox = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  height: '14px',
  borderRadius: '4px',
  border: `1px solid ${t.controlBorder}`,
  boxSizing: 'border-box' as const,
});

const chip = (t: ThemeTokens) => ({
  background: t.chipBg,
  padding: '1px 6px',
  borderRadius: '4px',
  fontFamily: 'ui-monospace, monospace',
  color: t.chipText,
  fontSize: '12px',
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

const textarea = (t: ThemeTokens) => ({
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: t.textPrimary,
  padding: '2px 0',
  fontFamily: 'inherit',
  fontSize: '12px',
  lineHeight: 1.5,
  resize: 'none' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
});

const modelSelect = (t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: t.textPrimary,
  padding: '2px 2px',
  fontSize: '12px',
  fontWeight: 400,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
});

const sendBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  marginLeft: '4px',
  background: t.submitBg,
  border: 'none',
  borderRadius: '8px',
  color: t.submitText,
  fontFamily: 'inherit',
});
