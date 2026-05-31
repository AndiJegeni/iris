import { OVERLAY_HOST_ID } from './index';

export type SelectModeHandlers = {
  /** Fired when the hover/pick "selecting" mode turns on or off (armed OR Alt-held, and not paused). */
  onSelectingChange: (selecting: boolean) => void;
  /** Fired when the persistent armed state (driven by the pill) changes. */
  onArmedChange: (armed: boolean) => void;
  onHover: (el: Element | null) => void;
  onPick: (el: Element) => void;
};

export type SelectModeController = {
  /** Persistently turn select mode on (pill click). Survives picks/sends until disarmed. */
  arm: () => void;
  /** Persistently turn select mode off (pill × button). */
  disarm: () => void;
  /** Temporarily suspend hover/pick (e.g. while a popover is open) without disarming. */
  pause: () => void;
  resume: () => void;
  dispose: () => void;
};

/**
 * Select mode UX:
 *   - Click the pill to arm: select mode stays on across picks and sends until
 *     you click the × (disarm). This is the primary, sticky mode.
 *   - Or hold Alt/Option for a transient session (released → cancelled).
 *   - Move the cursor: nearest visible element is outlined.
 *   - Click an element while selecting: pick. Outline disappears, handler fires.
 *   - Escape: disarm + cancel everything.
 */
export function startSelectMode(handlers: SelectModeHandlers): SelectModeController {
  let armed = false;
  let altActive = false;
  let paused = false;
  let lastHovered: Element | null = null;
  let lastSelecting = false;
  let lastArmed = false;

  const isSelecting = () => (armed || altActive) && !paused;

  const emit = () => {
    const selecting = isSelecting();
    if (selecting !== lastSelecting) {
      lastSelecting = selecting;
      if (!selecting) lastHovered = null;
      handlers.onSelectingChange(selecting);
    }
    if (armed !== lastArmed) {
      lastArmed = armed;
      handlers.onArmedChange(armed);
    }
  };

  const arm = () => {
    armed = true;
    emit();
  };
  const disarm = () => {
    armed = false;
    emit();
  };
  const pause = () => {
    paused = true;
    emit();
  };
  const resume = () => {
    paused = false;
    emit();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      armed = false;
      altActive = false;
      emit();
      return;
    }
    if (e.altKey && !altActive) {
      altActive = true;
      emit();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey && altActive) {
      altActive = false;
      emit();
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isSelecting()) return;
    const el = pickElementUnder(e.clientX, e.clientY);
    if (el === lastHovered) return;
    lastHovered = el;
    handlers.onHover(el);
  };

  const onClickCapture = (e: MouseEvent) => {
    // Never treat clicks on our own overlay (pill, popover) as element picks.
    if ((e.target as Element | null)?.id === OVERLAY_HOST_ID) return;
    if (!isSelecting()) return;
    // When armed, a plain click picks. For transient Alt mode, require Alt held.
    if (!armed && !e.altKey) return;
    const el = pickElementUnder(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    handlers.onPick(el);
  };

  // Drop the transient Alt session if the window loses focus (avoids "stuck Alt"),
  // but keep the sticky armed state.
  const onBlur = () => {
    if (altActive) {
      altActive = false;
      emit();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  // Capture phase so we run before the host app's click handlers.
  window.addEventListener('click', onClickCapture, { capture: true });
  window.addEventListener('blur', onBlur);

  const dispose = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('click', onClickCapture, { capture: true });
    window.removeEventListener('blur', onBlur);
  };

  return { arm, disarm, pause, resume, dispose };
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
