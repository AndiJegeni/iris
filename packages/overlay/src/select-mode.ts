import { OVERLAY_HOST_ID } from './index';

export type SelectModeHandlers = {
  onEnter: () => void;
  onHover: (el: Element | null) => void;
  onCancel: () => void;
  onPick: (el: Element) => void;
};

export type SelectController = {
  dispose: () => void;
  /** Toggle "sticky" select mode (armed by clicking the pill — no Alt needed). */
  toggleSticky: () => void;
  isSticky: () => boolean;
};

/**
 * Select mode can be entered two ways:
 *
 *   1. Hold Alt/Option — driven off the modifier state carried on *mouse*
 *      events (not keydown). This is critical when the overlay runs inside an
 *      iframe (the `:4747` shell): keydown/keyup only fire on the focused
 *      document, but mousemove always fires on the document under the cursor
 *      and carries `altKey`. So Alt-to-select works even without iframe focus.
 *
 *   2. Click the pill — "sticky" mode. Stays armed until you pick an element,
 *      press Escape, or click the pill again. No keyboard needed at all, which
 *      sidesteps focus entirely. This is the discoverable path.
 *
 * Active = sticky || altHeld.
 */
export function startSelectMode(handlers: SelectModeHandlers): SelectController {
  let sticky = false;
  let altHeld = false;
  let lastHovered: Element | null = null;

  const isActive = () => sticky || altHeld;

  // Reconcile listeners after a state change; fire enter/cancel on transitions.
  const reconcile = (wasActive: boolean) => {
    const now = isActive();
    if (now && !wasActive) {
      handlers.onEnter();
    } else if (!now && wasActive) {
      lastHovered = null;
      handlers.onCancel();
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    const was = isActive();
    altHeld = e.altKey;
    reconcile(was);
    if (!isActive()) return;
    const el = pickElementUnder(e.clientX, e.clientY);
    if (el === lastHovered) return;
    lastHovered = el;
    handlers.onHover(el);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const was = isActive();
      sticky = false;
      altHeld = false;
      reconcile(was);
      return;
    }
    if (e.altKey) {
      const was = isActive();
      altHeld = true;
      reconcile(was);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey) {
      const was = isActive();
      altHeld = false;
      reconcile(was);
    }
  };

  const onClickCapture = (e: MouseEvent) => {
    if (!isActive()) return;
    // Sticky mode: any click picks. Alt mode: only Alt-clicks pick (so normal
    // clicks pass through to the host app when the user isn't holding Alt).
    if (!sticky && !e.altKey) return;
    const el = pickElementUnder(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const was = isActive();
    sticky = false;
    altHeld = false;
    reconcile(was);
    handlers.onPick(el);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onClickCapture, { capture: true });

  return {
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClickCapture, { capture: true });
    },
    toggleSticky() {
      const was = isActive();
      sticky = !sticky;
      reconcile(was);
    },
    isSticky() {
      return sticky;
    },
  };
}

/**
 * Walk elementsFromPoint to skip our own overlay host. Needed because the
 * Shadow DOM root captures hits even with pointer-events:none on the host.
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
