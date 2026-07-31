/**
 * DOM id of the host element the overlay mounts into (a shadow-root host appended
 * to document.body).
 *
 * It lives in this side-effect-free module — rather than in index.tsx — so that
 * importing the constant (e.g. from select-mode, which skips the overlay's own
 * host when hit-testing) doesn't drag in index.tsx's top-level `mount()` side
 * effect. Pulling that in via a transitive import would auto-mount a stray second
 * overlay (and, under a bundler's React Refresh, crash on the off-tree render).
 */
export const OVERLAY_HOST_ID = '__iris_overlay__';

/**
 * Marker attribute on the full-viewport blocker rendered while "Block page
 * interactions" is on (see ui/interaction-shield.tsx).
 *
 * The shield lives inside the overlay's shadow root, so at the document/window
 * level every event on it retargets to the overlay host — indistinguishable from
 * a click on the pill unless we look at `composedPath()`. Select mode uses this
 * attribute to tell the two apart: the shield is a transparent stand-in for the
 * page beneath it, so clicking it must still pick the element underneath.
 */
export const SHIELD_ATTR = 'data-iris-shield';
