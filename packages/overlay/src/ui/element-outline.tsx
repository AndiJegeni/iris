/** @jsxImportSource preact */
import { useEffect, useState } from 'preact/hooks';

type Rect = { top: number; left: number; width: number; height: number };

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Component ancestry (outermost-first) + a DOM leaf descriptor for the chip. */
export type OutlineLabel = {
  /** e.g. ['Gallery', 'Section'] — rendered as `<Gallery> <Section>`. */
  path: string[];
  /** e.g. `h2 "TaskPanel"` or `div`. */
  leaf: string;
};

// Ink-on-paper palette — matches the pill and PickedPopover.
const INK = '#373734';
const MUTED = 'rgba(55, 55, 52, 0.5)';
const STROKE = 'rgba(55, 55, 52, 0.1)';
const SURFACE = '#ffffff';

type ElementOutlineProps = {
  element: Element;
  label?: OutlineLabel | undefined;
};

export function ElementOutline({ element, label }: ElementOutlineProps) {
  const [rect, setRect] = useState<Rect>(() => readRect(element));

  useEffect(() => {
    setRect(readRect(element));

    // Keep the outline aligned during scrolls / resizes / animations.
    let raf = 0;
    const tick = () => {
      setRect(readRect(element));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [element]);

  // Sit the chip just above the element's top-left, dropping below the top edge
  // when there isn't room above it in the viewport. Clamp to the left margin.
  const CHIP_GAP = 4;
  const CHIP_H = label?.path.length ? 34 : 20;
  const above = rect.top >= CHIP_H + CHIP_GAP;
  const chipTop = above ? rect.top - CHIP_H - CHIP_GAP : rect.top + CHIP_GAP;
  const chipLeft = Math.max(4, rect.left);

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          border: '2px solid #3b82f6',
          background: 'rgba(59, 130, 246, 0.08)',
          borderRadius: '2px',
          pointerEvents: 'none',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.6)',
        }}
      />
      {label ? (
        <div
          style={{
            position: 'fixed',
            top: `${chipTop}px`,
            left: `${chipLeft}px`,
            maxWidth: '360px',
            background: SURFACE,
            border: `1px solid ${STROKE}`,
            borderRadius: '6px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
            padding: '3px 7px',
            pointerEvents: 'none',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            fontSize: '11px',
            lineHeight: 1.35,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label.path.length ? (
            <div style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label.path.map((name) => `<${name}>`).join(' ')}
            </div>
          ) : null}
          <div
            style={{
              color: INK,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label.leaf}
          </div>
        </div>
      ) : null}
    </>
  );
}
