import { PILL_CIRCLE, PILL_PALETTE } from './pill';
import {
  type OverlayTheme,
  SURFACE_PAD,
  SURFACE_RADIUS,
  SURFACE_WIDTH,
  surfacePalette,
} from './theme';

// Both views are the popover's card, at the popover's width — the drawer and
// the chat used to be 400 and 460, so opening a transcript resized the surface.
export const DRAWER_WIDTH = SURFACE_WIDTH;
export const CHAT_WIDTH = SURFACE_WIDTH;
export const DRAWER_MARGIN = 8;

/**
 * The Background Tasks launcher: its own circle parked to the left of the pill,
 * sized from PILL_CIRCLE so the two are one row of chrome by construction.
 *
 * Painted from PILL_PALETTE, not the theme's control tokens — `controlBg` is a
 * near-transparent tint meant for controls *inside* a panel, so on a dark page
 * it renders as a pale glassy blob next to the solid pill.
 *
 * Position comes from the caller (overlay.tsx owns the pill's dragged
 * position); the offsets here are the un-dragged resting spot so the button
 * still places itself when rendered standalone.
 */
/** Glyph the launcher carries; see BackgroundTasksIcon's default size. */
const LAUNCHER_GLYPH = 18;
/** Side padding that makes the idle button exactly PILL_CIRCLE across. */
const LAUNCHER_FLANK = (PILL_CIRCLE - LAUNCHER_GLYPH - 2) / 2;

export const buttonStyle = (theme: OverlayTheme) => ({
  position: 'fixed' as const,
  bottom: '16px',
  // = pill's 16px inset + its collapsed width + the 8px gap.
  right: `${16 + PILL_CIRCLE + 8}px`,
  height: `${PILL_CIRCLE}px`,
  // A circle with no count, widening to hold one beside the glyph. The flanks
  // are derived, not typed in: with border-box sizing the idle width is the
  // 18px glyph + two flanks + the 1px border each side, and that has to land
  // exactly on PILL_CIRCLE or the "circle" is a subtly wrong oval — which is
  // what it was when the flanks were hand-tuned to 11 and 13.
  minWidth: `${PILL_CIRCLE}px`,
  padding: `0 ${LAUNCHER_FLANK}px`,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5px',
  background: PILL_PALETTE[theme].surface,
  border: `1px solid ${PILL_PALETTE[theme].stroke}`,
  borderRadius: '999px',
  cursor: 'pointer',
  boxShadow: PILL_PALETTE[theme].shadow,
  pointerEvents: 'auto' as const,
  // No inline `color` — `.la-tp-launcher` owns it so :hover can win.
  // Same reason the pill sets this: the drawer opens overhead and casts a
  // downward shadow that would otherwise darken this button.
  zIndex: 1,
});

/**
 * Running-task count, sitting to the right of the glyph as its peer.
 *
 * A shade under the icon's 18px: matching it exactly made the digit the loudest
 * thing on the button, since a solid numeral carries more mass than a line-art
 * glyph of the same height.
 *
 * No `color` of its own — it inherits the launcher's ink from `.la-tp-launcher`,
 * so it is exactly the icon's colour in both themes and follows it through
 * hover. Naming a colour here would be a second source of truth for the same
 * ink, and would read as white in dark but invisible on the light pill.
 *
 * `lineHeight: 1` inside the icon-height box keeps the digit optically centred
 * against the glyph; the font's default leading would otherwise ride it a couple
 * of pixels low, which is very visible next to a hard-edged icon.
 */
export const countStyle = () => ({
  display: 'inline-flex',
  alignItems: 'center',
  height: `${LAUNCHER_GLYPH}px`,
  // The extra breathing room on the right rides here rather than on the
  // button's padding: the flanks have to stay symmetric or the idle circle
  // (which has no count in it) turns into an oval.
  marginRight: '2px',
  fontSize: '15px',
  fontWeight: 500,
  lineHeight: 1,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
});

/**
 * Tall right-hand drawer. The caller pins it top-to-just-above the pill row
 * (see overlay.tsx), so it reaches the top edge — a transcript wants the height,
 * since opening a task's chat reuses this same box — while stopping short of the
 * bottom-right corner where the pill parks.
 *
 * That last part is the point: a true full-height drawer runs under the pill,
 * which paints above it, and the toolbar ends up sitting on the task list.
 * Ending above the row avoids the collision without shoving the toolbar aside.
 *
 * These offsets are the un-dragged defaults so the panel stands on its own when
 * rendered outside the overlay (the gallery).
 */
export const panelStyle = (theme: OverlayTheme) => ({
  position: 'fixed' as const,
  top: `${DRAWER_MARGIN}px`,
  right: '16px',
  // Clears the pill row: its 16px inset + the pill's height + the 8px gap.
  bottom: `${16 + PILL_CIRCLE + 8}px`,
  // The popover's exact surface — near-opaque over a backdrop blur, rather than
  // the flat #0f0f0f this used to paint. At 98% alpha it is still effectively
  // solid; the blur is what makes it the same material as the popover.
  background: surfacePalette(theme).surface,
  backdropFilter: 'blur(10px)',
  border: `1px solid ${surfacePalette(theme).stroke}`,
  borderRadius: SURFACE_RADIUS,
  boxShadow:
    theme === 'light' ? '0 20px 50px rgba(0, 0, 0, 0.2)' : '0 20px 50px rgba(0, 0, 0, 0.5)',
  pointerEvents: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  color: surfacePalette(theme).ink,
  fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: '12px',
  letterSpacing: '-0.02em',
  overflow: 'hidden',
});

export const panelHeader = () => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  // Left padding matches the section labels (container gutter + sectionHeader 6).
  padding: `14px ${SURFACE_PAD}px 10px ${SURFACE_PAD + 6}px`,
});

// Matches the "Background Tasks" header. Colour comes from the palette's `soft`
// rather than full ink at opacity 0.5 — an opacity fade also washes out anything
// nested inside, and it's a second way of expressing the same tone.
export const sectionHeader = (theme: OverlayTheme) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  color: surfacePalette(theme).soft,
  fontSize: '12px',
  fontWeight: 500,
  padding: '8px 6px 6px',
});

export const clearBtn = () => ({
  background: 'transparent',
  border: 'none',
  // Inherits the section header's 50%-ink color.
  color: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
});

export const iconBtn = (theme: OverlayTheme) => ({
  background: 'transparent',
  border: 'none',
  color: surfacePalette(theme).soft,
  cursor: 'pointer',
  padding: '2px',
  display: 'inline-flex',
});
