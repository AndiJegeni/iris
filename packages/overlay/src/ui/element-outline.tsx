/** @jsxImportSource preact */
import { useEffect, useState } from 'preact/hooks';

type Rect = { top: number; left: number; width: number; height: number };

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

type ElementOutlineProps = {
  element: Element;
};

export function ElementOutline({ element }: ElementOutlineProps) {
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

  return (
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
  );
}
