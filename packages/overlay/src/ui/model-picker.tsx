/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CheckIcon, ChevronRightIcon } from './icons';
import type { ThemeTokens } from './theme';

// The model catalog lives in @iris/shared (see MODELS there) so the picker, the
// task panel's labels, and backend routing can't drift apart. Re-exported here
// because this component is where the rest of the UI reaches for them.
export {
  DEFAULT_MODEL,
  EFFORTS,
  FALLBACK_MODEL,
  MODELS,
  type ModelProvider,
  type ModelSpec,
} from '@iris/shared';

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
    borderRadius: '10px',
    // Deliberately tighter than `surfaceShadow` (0 20px 50px @ 20%). This menu
    // opens *on top of* an already-white panel rather than over the host page,
    // and a 50px blur at 20% black threw a grey halo across the panel around it
    // — which reads as the menu being whiter than its background, when in fact
    // both resolve to #ffffff.
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.10)',
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
    // Capture phase, like the popover's own outside-click handler. The overlay
    // stops presses at the shadow root so they can't reach the host page (see
    // containPresses in index.tsx), and a bubble-phase listener on `document`
    // sits beyond that wall: it would stop seeing every press that originates
    // inside the overlay, so clicking the composer with this menu open would
    // leave the menu stuck open. Capture runs on the way *down*, before the
    // containment, so it still sees them.
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
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
