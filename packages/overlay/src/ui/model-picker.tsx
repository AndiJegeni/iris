/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CheckIcon, ChevronDownIcon } from './icons';
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

/** Widest the menu (or its submenu) gets: `menuPanel`'s min-width plus borders. */
const MENU_W = 234;
/**
 * The right edge, in viewport px, past which this element would be clipped.
 *
 * NOT `window.innerWidth`, which is what the flip tests used to ask. The menu
 * opens inside the task drawer, and the drawer is `overflow: hidden` sitting
 * 16px in from the right — so a menu can be entirely on-screen by the
 * viewport's reckoning and still be sliced off by the panel around it, which
 * is exactly what happened in the chat composer. Walk up to the nearest
 * ancestor that actually clips (crossing the shadow boundary, since the
 * overlay lives in a shadow root) and ask *that*.
 */
function clipRight(el: HTMLElement): number {
  let node: HTMLElement | null = el;
  while (node) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflow !== 'visible') {
      return node.getBoundingClientRect().right;
    }
    const parent: Node | null = node.parentElement ?? (node.getRootNode() as ShadowRoot).host;
    node = (parent as HTMLElement) ?? null;
  }
  return window.innerWidth;
}

/**
 * The row at the foot of each page that swaps to the other one, showing the
 * value it would let you change. Reasoning's page carries the model; the
 * model's page carries the reasoning — so whichever page you're on, the other
 * setting is still legible without leaving.
 */
function DrillRow({ label, onClick, t }: { label: string; onClick: () => void; t: ThemeTokens }) {
  return (
    <button
      type="button"
      className="la-mp-row la-mp-model-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: '12px',
        padding: '6px 8px',
        marginBottom: '2px',
        border: 'none',
        borderRadius: '6px',
        color: t.textPrimary,
        fontSize: '13px',
        fontFamily: 'inherit',
        letterSpacing: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ display: 'inline-flex', color: t.textFaint, flexShrink: 0 }}>
        <ChevronDownIcon />
      </span>
    </button>
  );
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
      className="la-mp-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: '12px',
        padding: '6px 8px',
        marginBottom: '2px',
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
  softInk,
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
  /**
   * Resting colour of the closed trigger, lifting to full ink on hover.
   *
   * Passed in rather than taken from `t`: the popover re-points every ink token
   * to full ink in light mode (see popoverTokens), so there is no "soft" left in
   * the token set to read. Each caller knows its own — the popover's placeholder
   * colour, the chat's palette `soft`.
   */
  softInk: string;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Which page the menu is showing. Always reset to 'reasoning' on open — the
   * setting you reach for most is the one that should be in front, and a menu
   * that reopens wherever you left it makes you re-read it to find out where
   * you are.
   */
  const [page, setPage] = useState<'reasoning' | 'model'>('reasoning');
  const [up, setUp] = useState(false);
  const [menuLeft, setMenuLeft] = useState(false);
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
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      // Flip above the trigger when there isn't room below it in the viewport.
      setUp(r.bottom + 320 > window.innerHeight);
      // …and open leftward when growing rightward would run into whatever is
      // clipping us. In the chat composer that is always true: the picker sits
      // beside the send button, hard against the drawer's right edge.
      setMenuLeft(r.left + MENU_W > clipRight(wrapRef.current));
    }
    setPage('reasoning');
    setOpen((o) => !o);
  };

  const close = () => {
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
      {/* The picker's own rules travel with it. They used to live in the
          popover's style block, so mounting this anywhere else — the task
          chat — left the trigger with no colour at all: a <button> does not
          inherit `color`, so the UA painted it black on a dark surface. */}
      <style>
        {[
          '.la-mp-row{background:transparent;transition:background 80ms}',
          `.la-mp-row:hover{background:${t.controlBg}}`,
          `.la-mp-soft{color:${softInk};transition:color 80ms}`,
          `.la-mp-soft:hover{color:${t.textPrimary}}`,
        ].join('')}
      </style>
      <button
        type="button"
        // Closed: resting color from .la-pp-soft (placeholder color, darkens on
        // hover). Open: pin to full ink inline (outranks the class).
        className={open ? undefined : 'la-mp-soft'}
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
            // Right-anchored when flipped, flush with the trigger's own edge.
            ...(menuLeft ? { right: 0 } : { left: 0 }),
            ...(up ? { bottom: '100%', marginBottom: '6px' } : { top: '100%', marginTop: '6px' }),
            zIndex: 10,
            ...menuPanel(t),
          }}
        >
          {page === 'reasoning' ? (
            <>
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
              {/* Divider, then the model as the row that swaps pages. */}
              <div style={{ height: '1px', background: t.controlBorder, margin: '6px 2px' }} />
              <DrillRow label={modelLabel} onClick={() => setPage('model')} t={t} />
            </>
          ) : (
            <>
              {/* The mirror image: the model list, with reasoning in the slot
                  the model occupied. One panel that swaps its contents, rather
                  than a second panel floating beside the first — two 232px
                  menus and a gap need 472px, and the drawer this opens in is
                  380, so a submenu was clipped on whichever side it chose. */}
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
              <div style={{ height: '1px', background: t.controlBorder, margin: '6px 2px' }} />
              <DrillRow label={effortLabel} onClick={() => setPage('reasoning')} t={t} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
