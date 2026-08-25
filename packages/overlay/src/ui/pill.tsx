/** @jsxImportSource preact */
import { ChatIcon, CloseIcon, CursorIcon, SettingsIcon } from './icons';
import type { OverlayTheme } from './theme';

type PillProps = {
  /** Persistent armed state — drives circle (off) vs. toolbar (on). */
  active: boolean;
  onArm: () => void;
  onDisarm: () => void;
  /** Toggle the chat / tasks panel (chat button). No-op when omitted. */
  onChat?: () => void;
  /** Open the settings panel (gear button). No-op when omitted. */
  onSettings?: () => void;
  theme?: OverlayTheme;
  /** Inline position override (top/left) applied once the pill is dragged. */
  positionStyle?: Record<string, string> | undefined;
  /** Mousedown on the pill surface — begins a drag (see overlay.tsx). */
  onDragStart?: ((e: MouseEvent) => void) | undefined;
};

// The pill floats over an arbitrary host page, so it carries its own surface in
// each theme: a light "ink on paper" chip, or a dark chip with a soft rim.
// `stroke` is the outline + active divider; `hover` is the icon-button halo;
// `hoverSurface` is that halo already composited onto `surface`, for the two
// parked circles (this one and the Background Tasks launcher) that ARE the
// surface — painting the translucent halo straight onto them would thin the
// chip out over the host page instead of lifting it.
type PillPalette = {
  surface: string;
  stroke: string;
  icon: string;
  shadow: string;
  hover: string;
  hoverSurface: string;
};

// The collapsed launcher is a circle carrying a single glyph; the active
// toolbar uses 20px glyphs in 28px buttons (4px padding). Both states land on
// the same height so arming doesn't change the pill's size.
const ICON_SIZE = 20; // active toolbar glyph
const STAR_SIZE = 20; // collapsed-launcher glyph (smaller than the circle for breathing room)
const ICON_BTN = 28; // active toolbar button (20px glyph + 4px padding)
// Collapsed launcher diameter, and the armed toolbar's height. 44 rather than
// 40 so the pill matches the other floating dev tools it shares a page with
// (vercila's agentation toolbar is a 44px circle); at 40 ours read as the
// smaller, lesser one sitting next to them.
const CIRCLE = 44;

/**
 * The pill's two footprints, exported so siblings parked on the same row (the
 * Background Tasks launcher) can sit beside it without overlapping. It keeps a
 * fixed right edge and grows leftward, so a neighbour offsets by whichever
 * width is current.
 *
 * Expanded width is derived from its parts so it tracks the layout below:
 * pad-l 8 · chat 28 · gap 6 · ml 2 · settings 28 · gap 6 · divider 1 · gap 6 · ml 2 · close 28 · pad-r 6.
 */
export const PILL_CIRCLE = CIRCLE;
export const PILL_TOOLBAR_W = 8 + ICON_BTN + 6 + 2 + ICON_BTN + 6 + 1 + 6 + 2 + ICON_BTN + 6;

// Theme accent blue (mirrors theme.ts `accent`) for the keyboard focus ring on
// the pill's icon buttons — replaces the host browser's default yellow outline.
const ACCENT = '#3b82f6';

// Open/close motion. One persistent container morphs between the parked circle
// and the expanded toolbar — arming/disarming eases the width (long expo curve)
// while the two layers crossfade, so the launcher glyph dissolves into the
// icons instead of snapping. Both states share the height + right edge, so the
// pill grows leftward from a fixed anchor and never jumps.
// Deliberately width-only: `right` is what dragging writes on every mousemove,
// so easing it would make the pill lag the cursor.
const MORPH = 'width 320ms cubic-bezier(0.19, 1, 0.22, 1)';

/**
 * Exported so the Background Tasks launcher — which parks on this row and must
 * read as the same physical chip — paints from the same palette. The theme's
 * `controlBg` is NOT a substitute: it's a near-transparent tint meant for
 * controls sitting *inside* a panel, so on a dark page it renders as a pale
 * blob next to the dark pill.
 */
export const PILL_PALETTE: Record<OverlayTheme, PillPalette> = {
  light: {
    surface: '#ffffff',
    stroke: 'rgba(55, 55, 52, 0.1)', // #373734 @ 10%
    icon: '#373734',
    shadow: '0 2px 16px rgba(0, 0, 0, 0.12)',
    hover: 'rgba(55, 55, 52, 0.075)',
    // #ffffff under the 7.5% ink halo. On paper the lift is downward — a
    // lighter grey than white would be no lift at all.
    hoverSurface: '#f0f0f0',
  },
  dark: {
    // The one dark base every surface shares — rgb(15,15,15), the panels'
    // SURFACE_PALETTE black — at the pill's own alpha.
    surface: 'rgba(15, 15, 15, 0.95)',
    stroke: 'rgba(255, 255, 255, 0.07)',
    icon: '#e5e5e5',
    shadow: '0 2px 16px rgba(0, 0, 0, 0.4)',
    hover: 'rgba(255, 255, 255, 0.1)',
    // rgba(15, 15, 15, 0.95) under the 10% white halo, kept at the surface's
    // alpha so the hovered circle is the same material, one shade up.
    hoverSurface: 'rgba(39, 39, 39, 0.95)',
  },
};

export function Pill({
  active,
  onArm,
  onDisarm,
  onChat,
  onSettings,
  theme = 'dark',
  positionStyle,
  onDragStart,
}: PillProps) {
  const p = PILL_PALETTE[theme];
  const baseSurface = {
    position: 'fixed' as const,
    bottom: '16px',
    right: '16px',
    background: p.surface,
    border: `1px solid ${p.stroke}`,
    boxShadow: p.shadow,
    pointerEvents: 'auto' as const,
    userSelect: 'none' as const,
    color: p.icon,
    // Paint above the settings/chat panels, which open just 8px overhead and cast
    // a large downward drop-shadow. Without this the panel's shadow falls onto the
    // pill and darkens it — pill and panels are the same material and must read as
    // the same color. The pill's box is opaque, so sitting on top covers the shadow.
    zIndex: 1,
  };
  const iconButton = {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: `${ICON_BTN}px`,
    height: `${ICON_BTN}px`,
    borderRadius: '999px',
    padding: 0,
    // No inline background — the .la-pill-btn class owns it so the :hover fill wins
    // (an inline `transparent` would override hover and leave a hollow halo).
    border: 'none',
    color: p.icon,
    cursor: 'pointer',
  };

  const TOOLBAR_W = PILL_TOOLBAR_W;

  return (
    <div
      className="la-pill-root"
      onMouseDown={onDragStart}
      style={{
        ...baseSurface,
        ...positionStyle,
        height: `${CIRCLE}px`,
        width: active ? `${TOOLBAR_W}px` : `${CIRCLE}px`,
        borderRadius: '999px',
        overflow: 'hidden',
        transition: MORPH,
        // Drag affordance on the bar; the buttons/star keep their pointer cursor.
        cursor: active ? 'grab' : 'pointer',
      }}
    >
      {/* Buttons hug the 20px icon; the circular 7.5% ink hover halo is drawn via
          box-shadow + bg so it doesn't push the icons apart. Layers crossfade on
          the same easing window. Focus rings use the theme accent (keyboard-only
          via :focus-visible) instead of the host browser's default outline. The
          launcher fills the clipped container, so its ring is inset to avoid being
          cut off; the toolbar buttons sit inside the padding so theirs can sit out.
          The parked launcher covers the whole chip, so it takes the composited
          `hoverSurface` — the halo alpha there would just thin the chip out. */}
      <style>
        {`.la-pill-btn{background:transparent;outline:none;transition:background 90ms,box-shadow 90ms}.la-pill-btn:hover{background:${p.hover};box-shadow:0 0 0 2px ${p.hover}}.la-pill-btn:focus-visible{outline:none;box-shadow:0 0 0 2px ${ACCENT}}.la-pill-layer{transition:opacity 180ms ease}.la-pill-launcher{outline:none;background:transparent;transition:background 90ms}.la-pill-launcher:hover{background:${p.hoverSurface}}.la-pill-launcher:focus-visible{box-shadow:inset 0 0 0 2px ${ACCENT}}`}
      </style>

      {/* Parked launcher: the star, pinned to the right CIRCLE px so it sits
          exactly where the toolbar's close button lands — the morph stays anchored. */}
      <button
        type="button"
        onClick={onArm}
        aria-label="Iris"
        aria-hidden={active ? true : undefined}
        tabIndex={active ? -1 : 0}
        className="la-pill-launcher la-pill-layer"
        style={{
          // top:0 + bottom:0 (not an explicit height) so the layer fills the
          // container's inner box — with box-sizing:border-box the 1px border
          // would otherwise leave the glyph ~1px low (asymmetric padding).
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: `${CIRCLE}px`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 'none',
          // No inline `background` — `.la-pill-launcher` owns it so :hover wins.
          color: p.icon,
          cursor: 'pointer',
          opacity: active ? 0 : 1,
          pointerEvents: active ? 'none' : 'auto',
        }}
      >
        <CursorIcon size={STAR_SIZE} />
      </button>

      {/* Expanded toolbar, same right anchor + height as the circle. */}
      <div
        aria-hidden={active ? undefined : true}
        className="la-pill-layer"
        style={{
          // top:0 + bottom:0 (not an explicit height) so the toolbar fills the
          // container's inner box symmetrically — the 1px border was making the
          // top padding read ~1px taller than the bottom.
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: `${TOOLBAR_W}px`,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 6px 6px 8px',
          opacity: active ? 1 : 0,
          pointerEvents: active ? 'auto' : 'none',
        }}
      >
        <button
          type="button"
          aria-label="chat"
          onClick={() => onChat?.()}
          tabIndex={active ? 0 : -1}
          className="la-pill-btn"
          style={iconButton}
        >
          <ChatIcon size={ICON_SIZE} />
        </button>
        <button
          type="button"
          aria-label="settings"
          onClick={() => onSettings?.()}
          tabIndex={active ? 0 : -1}
          className="la-pill-btn"
          // +2px beyond the 6px gap so the chat/settings hover halos don't overlap.
          style={{ ...iconButton, marginLeft: '2px' }}
        >
          <SettingsIcon size={ICON_SIZE} />
        </button>
        <span style={{ width: '1px', height: '20px', background: p.stroke, flexShrink: 0 }} />
        <button
          type="button"
          aria-label="close"
          onClick={onDisarm}
          tabIndex={active ? 0 : -1}
          className="la-pill-btn"
          // Nudged 2px right of the divider gap for a touch more breathing room.
          style={{ ...iconButton, marginLeft: '2px' }}
        >
          <CloseIcon size={ICON_SIZE} />
        </button>
      </div>
    </div>
  );
}
