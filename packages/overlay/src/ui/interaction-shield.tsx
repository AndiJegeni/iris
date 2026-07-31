/** @jsxImportSource preact */
import { useEffect } from 'preact/hooks';
import { OVERLAY_HOST_ID, SHIELD_ATTR } from '../constants';

/**
 * Ring drawn just inside the viewport edge so it stays obvious the page is inert
 * once the Settings panel is closed. The accent hue is shared across themes (see
 * theme.ts), so this is a fixed low-alpha value rather than a token.
 */
const RING = 'inset 0 0 0 2px rgba(59, 130, 246, 0.28)';

/**
 * The shield stops the page from being the event *target*, but events still
 * escape the shadow root and bubble on to `document` (retargeted to the overlay
 * host). Page code that delegates on the element — `e.target.closest('.menu')` —
 * already no-ops, but an unconditional `document.addEventListener('click', …)`
 * would still fire. Stopping them at the shield closes that last gap.
 *
 * Bubble phase, deliberately: select mode picks from a window-*capture* click
 * handler, which runs before the event ever reaches the shield, so it keeps
 * working. `mousemove` is likewise absent — select mode's hover tracking listens
 * for it on window in the bubble phase, and swallowing it would kill the
 * hover outline.
 */
const stop = (e: Event): void => e.stopPropagation();
const SWALLOW = {
  onClick: stop,
  onDblClick: stop,
  onContextMenu: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onPointerDown: stop,
  onPointerUp: stop,
};

/**
 * Full-viewport blocker rendered while "Block page interactions" is on — the
 * host page becomes inert so you can click anything to annotate it without
 * triggering the app's own behavior (links navigating, buttons submitting,
 * hover states firing, text selecting).
 *
 * Implemented as a transparent shield rather than a pile of capture-phase
 * `preventDefault()` listeners: one element that swallows every pointer event is
 * both simpler and impossible for the page to work around, and it doesn't have
 * to enumerate (and keep up with) the event types worth blocking.
 *
 * Two things it deliberately does NOT block:
 *   - Scrolling. Wheel over a transparent fixed element still scrolls the
 *     document, and you need to reach content below the fold to annotate it.
 *     (Scroll containers *nested* in the page do stop scrolling — they're under
 *     the shield.)
 *   - Element picking. Select mode hit-tests with `elementsFromPoint`, which
 *     skips the overlay host, so it still finds the real element underneath.
 *     See SHIELD_ATTR in constants.ts for the click-path half of that.
 *
 * Keyboard input is handled by taking focus away from the page instead of
 * swallowing key events — blocking keys at window-capture would also starve the
 * overlay's own Escape/Alt handlers, which listen on the same target.
 */
export function InteractionShield() {
  useEffect(() => {
    const insideOverlay = (n: EventTarget | null): boolean =>
      n instanceof Element &&
      (n.id === OVERLAY_HOST_ID || n.closest(`#${OVERLAY_HOST_ID}`) !== null);

    // Whatever the page had focused keeps receiving keystrokes otherwise.
    const active = document.activeElement;
    if (active instanceof HTMLElement && !insideOverlay(active)) active.blur();

    // The shield stops the *mouse* from focusing anything, but Tab and the
    // page's own `.focus()` calls can still walk back in — bounce them out.
    // Focus inside the overlay retargets to the host at the document level, so
    // our own composer/inputs read as `insideOverlay` and are left alone.
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target === document.body || insideOverlay(target)) return;
      target.blur();
    };
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
  }, []);

  return (
    <div
      {...{ [SHIELD_ATTR]: '' }}
      {...SWALLOW}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        // Beneath every piece of overlay chrome (pill is 1, popovers are 2+) but
        // above the page, which it can't reach past the shadow host anyway.
        zIndex: 0,
        pointerEvents: 'auto',
        cursor: 'default',
        boxShadow: RING,
      }}
    />
  );
}
