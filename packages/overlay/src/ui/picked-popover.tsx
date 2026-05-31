import type { Annotation, Backend, WorktreeMode } from '@localagents/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Resolution } from '../source-map';

type PickedPopoverProps = {
  element: Element;
  resolution: Resolution;
  onClose: () => void;
  onSubmit: (annotation: Annotation) => Promise<void>;
};

const BACKEND_OPTIONS: { value: Backend; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'echo', label: 'Echo' },
];

function defaultWorktreeMode(prompt: string): WorktreeMode {
  if (prompt.length > 200) return 'new';
  if (/\brefactor\b|\brewrite\b|\bredesign\b/i.test(prompt)) return 'new';
  return 'same';
}

/**
 * Conductor-style message box. Light theme, roomy. Top-left: base branch +
 * "worktree" checkbox. Top-right: close. Middle: prompt. Bottom: backend +
 * dark send button. Element/source context is sent to the agent but not shown.
 */
export function PickedPopover({ element, resolution, onClose, onSubmit }: PickedPopoverProps) {
  const [prompt, setPrompt] = useState('');
  const [backend, setBackend] = useState<Backend>('claude');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('same');
  const [userTouchedMode, setUserTouchedMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const anchor = computeAnchor(element);

  useEffect(() => {
    if (!userTouchedMode) setWorktreeMode(defaultWorktreeMode(prompt));
  }, [prompt, userTouchedMode]);

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

  // biome-ignore lint/suspicious/noExplicitAny: Preact event typed against root React types
  const handleKeyDown = (e: any) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  };

  const isNew = worktreeMode === 'new';

  return (
    <div
      style={{
        position: 'fixed',
        top: `${anchor.top}px`,
        left: `${anchor.left}px`,
        width: '480px',
        background: '#ffffff',
        color: '#18181b',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        borderRadius: '16px',
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0,0,0,0.08)',
        padding: '14px 16px 12px',
        fontSize: '15px',
        lineHeight: 1.45,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontFamily:
          'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      {/* Top row: branch | worktree chip group + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={chipGroup}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#3f3f46' }}>
            <BranchIcon />
            main
          </span>
          <span style={chipDivider} />
          <button
            type="button"
            onClick={() => {
              setUserTouchedMode(true);
              setWorktreeMode((m) => (m === 'same' ? 'new' : 'same'));
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: '#3f3f46',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
            title="Run this task in a new git worktree (parallel). Off = current worktree."
          >
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                background: isNew ? '#3b82f6' : '#ffffff',
                border: `1.5px solid ${isNew ? '#3b82f6' : '#d4d4d8'}`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isNew ? (
                <svg viewBox="0 0 12 12" width="11" height="11">
                  <path
                    d="M2.5 6.2 L5 8.5 L9.5 3.5"
                    stroke="white"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
            worktree
          </button>
        </div>
        <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path
              d="M4 4 L12 12 M12 4 L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={prompt}
        onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe a task or ask a question"
        rows={3}
        style={textarea}
      />

      {/* Bottom row: backend (left) + send (right) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <select
          value={backend}
          onChange={(e) => setBackend((e.target as HTMLSelectElement).value as Backend)}
          style={backendSelect}
        >
          {BACKEND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!prompt.trim() || sending}
          style={{
            ...sendBtn,
            opacity: !prompt.trim() || sending ? 0.35 : 1,
            cursor: !prompt.trim() || sending ? 'not-allowed' : 'pointer',
          }}
          title="Send (⌘↵)"
        >
          {sending ? (
            <span style={{ fontSize: '13px' }}>…</span>
          ) : (
            <svg viewBox="0 0 16 16" width="15" height="15">
              <path
                d="M12 4 L12 8 Q12 9.5 10.5 9.5 L5 9.5 M7.5 7 L5 9.5 L7.5 12"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {error ? (
        <div
          style={{
            marginTop: '6px',
            padding: '7px 9px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
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

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" style={{ display: 'block' }}>
      <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <circle cx="4.5" cy="3.5" r="1.6" />
        <circle cx="4.5" cy="12.5" r="1.6" />
        <circle cx="11.5" cy="5" r="1.6" />
        <path d="M4.5 5.1 L4.5 10.9" />
        <path d="M11.5 6.6 Q11.5 9 9 9 Q4.5 9 4.5 10.9" />
      </g>
    </svg>
  );
}

const POPOVER_WIDTH = 480;
const POPOVER_HEIGHT_GUESS = 180;
const GAP = 10;

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

const chipGroup = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '10px',
  border: '1px solid #e4e4e7',
  borderRadius: '9px',
  padding: '5px 11px',
  fontSize: '14px',
  background: '#fafafa',
};

const chipDivider = {
  width: '1px',
  height: '16px',
  background: '#e4e4e7',
};

const closeBtn = {
  marginLeft: 'auto',
  background: 'transparent',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
};

const textarea = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#18181b',
  padding: '12px 2px 14px',
  fontFamily: 'inherit',
  fontSize: '16px',
  lineHeight: 1.5,
  resize: 'none' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
  minHeight: '76px',
};

const backendSelect = {
  background: 'transparent',
  border: 'none',
  color: '#52525b',
  padding: '4px 2px',
  fontSize: '14px',
  cursor: 'pointer',
  outline: 'none',
  fontFamily: 'inherit',
  appearance: 'none' as const,
};

const sendBtn = {
  background: '#18181b',
  border: 'none',
  borderRadius: '10px',
  width: '36px',
  height: '36px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};
