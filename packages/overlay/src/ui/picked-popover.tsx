import type { Annotation, Backend, WorktreeMode } from '@localagents/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Resolution } from '../source-map';

type PickedPopoverProps = {
  element: Element;
  resolution: Resolution;
  onClose: () => void;
  onSubmit: (annotation: Annotation) => Promise<void>;
};

const CONFIDENCE_LABEL: Record<Resolution['confidence'], string> = {
  high: 'high · _debugSource',
  medium: 'medium · dispatcher probe',
  low: 'low · selector only',
  none: 'no react fiber',
};

const CONFIDENCE_COLOR: Record<Resolution['confidence'], string> = {
  high: '#22c55e',
  medium: '#eab308',
  low: '#f97316',
  none: '#6b7280',
};

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

export function PickedPopover({ element, resolution, onClose, onSubmit }: PickedPopoverProps) {
  const [prompt, setPrompt] = useState('');
  const [backend, setBackend] = useState<Backend>('claude');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('same');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const anchor = computeAnchor(element);

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
      confidence: resolution.confidence === 'none' ? 'low' : resolution.confidence,
      worktreeMode,
      backend,
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

  return (
    <div
      style={{
        position: 'fixed',
        top: `${anchor.top}px`,
        left: `${anchor.left}px`,
        width: '360px',
        background: 'rgba(20, 20, 23, 0.97)',
        color: '#f4f4f5',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '10px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
        padding: '14px',
        fontSize: '12px',
        lineHeight: 1.45,
        pointerEvents: 'auto',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: CONFIDENCE_COLOR[resolution.confidence],
            }}
          />
          <span style={{ color: '#a1a1aa', fontSize: '10px', letterSpacing: '0.04em' }}>
            {CONFIDENCE_LABEL[resolution.confidence].toUpperCase()}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          style={closeBtn}
        >
          ×
        </button>
      </div>

      {resolution.source ? (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', marginBottom: '8px' }}>
          <span style={{ color: '#60a5fa' }}>{resolution.source.file}</span>
          <span style={{ color: '#a1a1aa' }}>
            :{resolution.source.line}
            {resolution.source.column != null ? `:${resolution.source.column}` : ''}
          </span>
        </div>
      ) : (
        <div style={{ fontFamily: 'ui-monospace, monospace', color: '#a1a1aa', marginBottom: '8px' }}>
          {resolution.selector}
        </div>
      )}

      {resolution.componentPath.length > 0 ? (
        <div style={{ marginBottom: '10px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {resolution.componentPath.map((name, i) => (
            <code key={`${name}-${i}`} style={chip}>
              {`<${name}/>`}
            </code>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={prompt}
        onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        placeholder="What should the agent do to this element?"
        rows={3}
        style={textarea}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '8px',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '6px' }}>
          <select
            value={backend}
            onChange={(e) => setBackend((e.target as HTMLSelectElement).value as Backend)}
            style={select}
          >
            {BACKEND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setUserTouchedMode(true);
              setWorktreeMode((m) => (m === 'same' ? 'new' : 'same'));
            }}
            style={{
              ...toggleBtn,
              background: worktreeMode === 'new' ? '#1e40af' : 'rgba(255,255,255,0.06)',
              color: worktreeMode === 'new' ? '#dbeafe' : '#a1a1aa',
            }}
            title="Same worktree runs serially; new worktree spawns in parallel"
          >
            {worktreeMode === 'new' ? 'new worktree' : 'same worktree'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!prompt.trim() || sending}
          style={{
            ...sendBtn,
            opacity: !prompt.trim() || sending ? 0.5 : 1,
            cursor: !prompt.trim() || sending ? 'not-allowed' : 'pointer',
          }}
        >
          {sending ? 'sending…' : 'send ⌘↵'}
        </button>
      </div>

      {error ? (
        <div
          style={{
            marginTop: '8px',
            padding: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            borderRadius: '6px',
            fontSize: '11px',
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

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

const closeBtn = {
  background: 'transparent',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  fontSize: '14px',
  padding: '0 4px',
};

const chip = {
  background: 'rgba(255,255,255,0.06)',
  padding: '1px 6px',
  borderRadius: '4px',
  fontFamily: 'ui-monospace, monospace',
  color: '#e4e4e7',
  fontSize: '11px',
};

const textarea = {
  width: '100%',
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '6px',
  color: '#f4f4f5',
  padding: '8px',
  fontFamily: 'inherit',
  fontSize: '12px',
  lineHeight: 1.5,
  resize: 'vertical' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
};

const select = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '6px',
  color: '#e4e4e7',
  padding: '4px 8px',
  fontSize: '11px',
  cursor: 'pointer',
  outline: 'none',
};

const toggleBtn = {
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '6px',
  padding: '4px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const sendBtn = {
  background: '#3b82f6',
  border: 'none',
  borderRadius: '6px',
  padding: '6px 14px',
  fontSize: '11px',
  fontWeight: 600,
  color: 'white',
  fontFamily: 'inherit',
};
