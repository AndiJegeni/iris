/** @jsxImportSource preact */
import { render } from 'preact';
import { OVERLAY_HOST_ID } from './constants';
import { Overlay } from './overlay';

// Re-exported from its own side-effect-free module (see constants.ts) so that
// importing the id elsewhere doesn't trigger this module's auto-mount below.
export { OVERLAY_HOST_ID };

const SHADOW_RESET = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
  }
  * {
    box-sizing: border-box;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
`;

/**
 * Keep the host page's keyboard shortcuts out of our text fields.
 *
 * Pages guard their single-key shortcuts with some form of "is the user
 * typing?" — `e.target.tagName === 'INPUT' || 'TEXTAREA'`, or the same test on
 * `document.activeElement`. Both are blind to us: an event crossing a shadow
 * boundary retargets to the host, and `document.activeElement` is the host too,
 * so a page sees a `<div>` and concludes nobody is typing. It then handles the
 * key and calls preventDefault, and the character never lands in our composer.
 *
 * This is not hypothetical or specific to one library: vercila's `agentation`
 * ate `c`, `h` and `x` this way, and its `dialkit` panel has the same guard.
 * Any page with single-letter hotkeys does it, and we cannot fix them all.
 *
 * So while the user is typing in one of our fields, the page simply does not
 * see the keystroke. Scoped tightly on purpose:
 *
 *   - Only events whose *real* origin (composedPath[0], pre-retarget) is one of
 *     our text fields. Keys pressed anywhere else still reach the page.
 *   - Only plain characters — no modifier combos, and nothing named (Escape,
 *     Enter, Tab, arrows). The page keeps its ⌘K, and our own window-level
 *     handlers keep Escape (popover close, select-mode disarm) and Alt.
 *
 * Stopping propagation here still lets the keystroke reach our field: it has
 * already been delivered by the time it bubbles up to the shadow root, and the
 * default action only runs once dispatch finishes uninterrupted.
 */
function isOurTextField(node: EventTarget | undefined): boolean {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || node.isContentEditable;
}

/**
 * The same containment for presses on our own chrome.
 *
 * A shadow root encapsulates DOM and styles, not events: UI events are
 * `composed`, so they cross the boundary and bubble to `window` — merely
 * retargeted, so the page sees our host `<div>` rather than the button pressed.
 * Page code that delegates off the element (`e.target.closest('.menu')`)
 * harmlessly no-ops, but anything listening unconditionally still fires. On
 * vercila that is InkCanvas, whose pointerdown handler has no target check at
 * all — so dragging our pill drew a pen stroke across the page.
 *
 * The page cannot reasonably defend against this: all it sees is an opaque div.
 * So a press that lands on our UI stops being the page's business here.
 *
 * The event list is the interaction shield's (see interaction-shield.tsx), which
 * closes this same gap for the blocker element and has the reasoning in full.
 * The two exclusions carry over and both matter: `mousemove` is absent because
 * select mode's hover tracking listens for it on window in the bubble phase, and
 * bubble phase is used throughout because select mode picks from a window
 * *capture* click handler that runs before any of this.
 */
const PRESS_EVENTS = [
  'click',
  'dblclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
] as const;

function containPresses(shadow: ShadowRoot): void {
  const contain = (e: Event) => e.stopPropagation();
  for (const type of PRESS_EVENTS) {
    shadow.addEventListener(type, contain);
  }
}

function containKeystrokes(shadow: ShadowRoot): void {
  const contain = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return;
    if (!isOurTextField(e.composedPath()[0])) return;
    e.stopPropagation();
  };
  // keypress is dead but still fires, and some hotkey code listens on keyup.
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    shadow.addEventListener(type, contain as EventListener);
  }
}

function mount(): void {
  if (typeof window === 'undefined') return;
  if (document.getElementById(OVERLAY_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  containKeystrokes(shadow);
  containPresses(shadow);

  const style = document.createElement('style');
  style.textContent = SHADOW_RESET;
  shadow.appendChild(style);

  const rootEl = document.createElement('div');
  shadow.appendChild(rootEl);

  render(<Overlay />, rootEl);
}

// Run on import. Defer until DOM is ready.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
