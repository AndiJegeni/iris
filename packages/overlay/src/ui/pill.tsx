/** @jsxImportSource preact */
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
// `stroke` is the outline + active divider; `hover` is the icon-button halo.
type PillPalette = { surface: string; stroke: string; icon: string; shadow: string; hover: string };

// Matched to Agentation's launcher + toolbar (measured live off the example
// page). The collapsed launcher is a circle with a prominent star glyph — bigger
// than its own toolbar icons, so the parked state reads strong. The active
// toolbar uses 20px glyphs in 28px buttons (4px padding). Both states land on a
// 40px height so arming doesn't change the pill's size.
const ICON_SIZE = 20; // active toolbar glyph
const STAR_SIZE = 20; // collapsed-launcher glyph (smaller than the circle for breathing room)
const ICON_BTN = 28; // active toolbar button (20px glyph + 4px padding)
const CIRCLE = 40; // collapsed launcher diameter (= toolbar height: 28px button + 6px top/bottom)

// Theme accent blue (mirrors theme.ts `accent`) for the keyboard focus ring on
// the pill's icon buttons — replaces the host browser's default yellow outline.
const ACCENT = '#3b82f6';

// Open/close motion. One persistent container morphs between the parked circle
// and the expanded toolbar — arming/disarming eases the width (long expo curve,
// à la Agentation) while the two layers crossfade, so the star dissolves into the
// icons instead of snapping. Both states share the height + right edge, so the
// pill grows leftward from a fixed anchor and never jumps.
const MORPH = 'width 320ms cubic-bezier(0.19, 1, 0.22, 1)';

const PILL: Record<OverlayTheme, PillPalette> = {
  light: {
    surface: '#ffffff',
    stroke: 'rgba(55, 55, 52, 0.1)', // #373734 @ 10%
    icon: '#373734',
    shadow: '0 2px 16px rgba(0, 0, 0, 0.12)',
    hover: 'rgba(55, 55, 52, 0.075)',
  },
  dark: {
    surface: 'rgba(18, 18, 18, 0.95)', // neutral gray, darker — old zinc read blue
    stroke: 'rgba(255, 255, 255, 0.07)',
    icon: '#e5e5e5',
    shadow: '0 2px 16px rgba(0, 0, 0, 0.4)',
    hover: 'rgba(255, 255, 255, 0.1)',
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
  const p = PILL[theme];
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

  // Expanded-toolbar width, derived from its parts so it tracks the layout below:
  // pad-l 8 · chat 28 · gap 6 · ml 2 · settings 28 · gap 6 · divider 1 · gap 6 · ml 2 · close 28 · pad-r 6.
  const TOOLBAR_W = 8 + ICON_BTN + 6 + 2 + ICON_BTN + 6 + 1 + 6 + 2 + ICON_BTN + 6;

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
          cut off; the toolbar buttons sit inside the padding so theirs can sit out. */}
      <style>
        {'.la-pill-btn{background:transparent;outline:none;transition:background 90ms,box-shadow 90ms}' +
          `.la-pill-btn:hover{background:${p.hover};box-shadow:0 0 0 4px ${p.hover}}` +
          `.la-pill-btn:focus-visible{outline:none;box-shadow:0 0 0 2px ${ACCENT}}` +
          '.la-pill-layer{transition:opacity 180ms ease}' +
          '.la-pill-launcher{outline:none}' +
          `.la-pill-launcher:focus-visible{box-shadow:inset 0 0 0 2px ${ACCENT}}`}
      </style>

      {/* Parked launcher: the star, pinned to the right CIRCLE px so it sits
          exactly where the toolbar's close button lands — the morph stays anchored. */}
      <button
        type="button"
        onClick={onArm}
        aria-label="lens"
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
          background: 'transparent',
          color: p.icon,
          cursor: 'pointer',
          opacity: active ? 0 : 1,
          pointerEvents: active ? 'none' : 'auto',
        }}
      >
        <StarIcon />
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
          <ChatIcon />
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
          <SettingsIcon />
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
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

/**
 * Icons inlined from packages/overlay/src/assets/icons (star-06, message-circle-01,
 * settings-02, x-close) with stroke = currentColor so they take the pill's ink
 * color (per theme). Inlined rather than imported to stay bundler-agnostic across the daemon's
 * Bun build and the example's Next/SWC build — same convention as picked-popover.
 */
function StarIcon() {
  return (
    // Optical centering: the glyph's bounding box is symmetric, but the light
    // sparkle accents on the left make the whole mark read left-of-center in the
    // circle. Nudge right so it sits visually centered.
    <svg
      width={STAR_SIZE}
      height={STAR_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ transform: 'translateX(1px)' }}
    >
      <path
        d="M2.99967 14.6668V11.3335M2.99967 4.66683V1.3335M1.33301 3.00016H4.66634M1.33301 13.0002H4.66634M8.66634 2.00016L7.51022 5.00607C7.32221 5.49489 7.22821 5.7393 7.08203 5.94489C6.95247 6.12709 6.79327 6.28629 6.61106 6.41585C6.40548 6.56203 6.16107 6.65604 5.67225 6.84404L2.66634 8.00016L5.67225 9.15628C6.16107 9.34429 6.40548 9.43829 6.61107 9.58448C6.79327 9.71404 6.95247 9.87323 7.08203 10.0554C7.22821 10.261 7.32221 10.5054 7.51022 10.9943L8.66634 14.0002L9.82246 10.9943C10.0105 10.5054 10.1045 10.261 10.2507 10.0554C10.3802 9.87323 10.5394 9.71404 10.7216 9.58448C10.9272 9.43829 11.1716 9.34429 11.6604 9.15628L14.6663 8.00016L11.6604 6.84404C11.1716 6.65604 10.9272 6.56203 10.7216 6.41585C10.5394 6.28629 10.3802 6.12709 10.2507 5.94489C10.1045 5.7393 10.0105 5.49489 9.82246 5.00607L8.66634 2.00016Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M14.0001 7.66667C14.0001 10.7963 11.463 13.3333 8.33341 13.3333C7.61556 13.3333 6.92888 13.1999 6.29685 12.9564C6.18129 12.9118 6.12351 12.8896 6.07756 12.879C6.03237 12.8686 5.99966 12.8642 5.95332 12.8624C5.9062 12.8606 5.85451 12.866 5.75112 12.8767L2.3371 13.2296C2.01161 13.2632 1.84886 13.2801 1.75286 13.2215C1.66924 13.1705 1.61229 13.0853 1.59713 12.9885C1.57972 12.8774 1.65749 12.7335 1.81303 12.4456L2.90347 10.4272C2.99327 10.261 3.03817 10.1779 3.05851 10.098C3.0786 10.019 3.08345 9.96213 3.07703 9.88095C3.07052 9.79875 3.03446 9.69175 2.96232 9.47774C2.77064 8.90906 2.66674 8.3 2.66674 7.66667C2.66674 4.53705 5.2038 2 8.33341 2C11.463 2 14.0001 4.53705 14.0001 7.66667Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.26369 12.9142L6.65332 13.7905C6.76914 14.0514 6.95817 14.273 7.19747 14.4286C7.43677 14.5841 7.71606 14.6669 8.00147 14.6668C8.28687 14.6669 8.56616 14.5841 8.80546 14.4286C9.04476 14.273 9.23379 14.0514 9.34961 13.7905L9.73924 12.9142C9.87794 12.6033 10.1112 12.3441 10.4059 12.1735C10.7024 12.0025 11.0455 11.9296 11.3859 11.9653L12.3392 12.0668C12.623 12.0968 12.9094 12.0439 13.1637 11.9144C13.418 11.7849 13.6292 11.5844 13.7718 11.3372C13.9146 11.0902 13.9826 10.807 13.9677 10.5221C13.9527 10.2372 13.8553 9.9627 13.6874 9.73202L13.1229 8.95646C12.922 8.67825 12.8146 8.34337 12.8163 8.00016C12.8162 7.65789 12.9246 7.3244 13.1259 7.04757L13.6904 6.27201C13.8583 6.04133 13.9556 5.76688 13.9706 5.48195C13.9856 5.19701 13.9176 4.91386 13.7748 4.66683C13.6322 4.41965 13.4209 4.21916 13.1667 4.08965C12.9124 3.96014 12.626 3.90718 12.3422 3.9372L11.3889 4.03868C11.0484 4.07444 10.7054 4.00158 10.4089 3.83053C10.1136 3.659 9.88025 3.3984 9.74221 3.08609L9.34961 2.20979C9.23379 1.94894 9.04476 1.72731 8.80546 1.57176C8.56616 1.41622 8.28687 1.33345 8.00147 1.3335C7.71606 1.33345 7.43677 1.41622 7.19747 1.57176C6.95817 1.72731 6.76914 1.94894 6.65332 2.20979L6.26369 3.08609C6.12564 3.3984 5.89227 3.659 5.59702 3.83053C5.3005 4.00158 4.95747 4.07444 4.61702 4.03868L3.66072 3.9372C3.37694 3.90718 3.09055 3.96014 2.83627 4.08965C2.58198 4.21916 2.37073 4.41965 2.22813 4.66683C2.08535 4.91386 2.01732 5.19701 2.03231 5.48195C2.0473 5.76688 2.14466 6.04133 2.31258 6.27201L2.87702 7.04757C3.07831 7.3244 3.18671 7.65789 3.18665 8.00016C3.18671 8.34244 3.07831 8.67593 2.87702 8.95276L2.31258 9.72831C2.14466 9.95899 2.0473 10.2335 2.03231 10.5184C2.01732 10.8033 2.08535 11.0865 2.22813 11.3335C2.37088 11.5805 2.58215 11.7809 2.8364 11.9104C3.09064 12.0399 3.37697 12.093 3.66072 12.0631L4.61406 11.9616C4.9545 11.9259 5.29753 11.9987 5.59406 12.1698C5.89041 12.3408 6.12486 12.6015 6.26369 12.9142Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8.00027 10.0002C9.10484 10.0002 10.0003 9.10473 10.0003 8.00016C10.0003 6.89559 9.10484 6.00016 8.00027 6.00016C6.8957 6.00016 6.00027 6.89559 6.00027 8.00016C6.00027 9.10473 6.8957 10.0002 8.00027 10.0002Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12 4L4 12M4 4L12 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
