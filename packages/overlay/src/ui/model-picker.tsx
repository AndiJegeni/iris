/** @jsxImportSource preact */
import type { Backend, ReasoningEffort } from '@localagents/shared';
import { modelLabel } from '@localagents/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CheckIcon, ChevronRightIcon } from './icons';
import type { ThemeTokens } from './theme';

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
        {selected ? <CheckIcon /> : null}
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
                <ChevronRightIcon />
              </span>
            </button>
            {modelOpen ? (
              <div
                style={{
                  position: 'absolute',
                  // Float beside the model row like a native submenu (flips side).
                  ...(subLeft ? { right: 'calc(100% + 8px)' } : { left: 'calc(100% + 8px)' }),
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
