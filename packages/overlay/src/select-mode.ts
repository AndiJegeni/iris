import { OVERLAY_HOST_ID } from './index';

export type SelectModeHandlers = {
  onEnter: () => void;
  onHover: (el: Element | null) => void;
  onCancel: () => void;
  onPick: (el: Element) => void;
};

/**
 * Select mode UX:
 *   - Hold Alt/Option to enter (or arm by clicking the pill in M4+).
 *   - Move the cursor: nearest visible element is outlined.
 *   - Click while Alt is held: pick. Outline disappears, handler fires.
 *   - Release Alt OR press Escape: cancel.
 */
export function startSelectMode(handlers: SelectModeHandlers): () => void {
  let active = false;
  let lastHovered: Element | null = null;

  const enter = () => {
    if (active) return;
    active = true;
    handlers.onEnter();
  };

  const cancel = () => {
    if (!active) return;
    active = false;
    lastHovered = null;
    handlers.onCancel();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancel();
      return;
    }
    if (e.altKey) enter();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey) cancel();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!active) return;
    const el = pickElementUnder(e.clientX, e.clientY);
    if (el === lastHovered) return;
    lastHovered = el;
    handlers.onHover(el);
  };

  const onClickCapture = (e: MouseEvent) => {
    if (!active) return;
    if (!e.altKey) return;
    const el = pickElementUnder(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    handlers.onPick(el);
  };

  // Cancel select mode if window loses focus (avoids "stuck Alt" state)
  const onBlur = () => cancel();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  // Capture phase so we run before the host app's click handlers.
  window.addEventListener('click', onClickCapture, { capture: true });
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('click', onClickCapture, { capture: true });
    window.removeEventListener('blur', onBlur);
  };
}

/**
 * Walk elementsFromPoint to skip our own overlay host. We need this because the
 * Shadow DOM root element captures hits even though we set pointer-events:none.
 */
function pickElementUnder(x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (el.id === OVERLAY_HOST_ID) continue;
    if (el.closest(`#${OVERLAY_HOST_ID}`)) continue;
    if (el === document.documentElement || el === document.body) continue;
    return el;
  }
  return null;
}
