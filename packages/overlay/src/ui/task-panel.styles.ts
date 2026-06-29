import type { OverlayTheme, ThemeTokens } from './theme';

export const DRAWER_WIDTH = 400;
export const CHAT_WIDTH = 460;
export const DRAWER_MARGIN = 8;

export const buttonStyle = (t: ThemeTokens) => ({
  position: 'fixed' as const,
  top: '14px',
  right: '14px',
  height: '34px',
  minWidth: '34px',
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  background: t.controlBg,
  border: `1px solid ${t.controlBorder}`,
  borderRadius: '999px',
  cursor: 'pointer',
  boxShadow: t.pillShadow,
  pointerEvents: 'auto' as const,
});

export const countStyle = {
  fontSize: '13px',
  fontWeight: 600,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '-0.02em',
};

export const panelStyle = (t: ThemeTokens, theme: OverlayTheme) => ({
  position: 'fixed' as const,
  top: `${DRAWER_MARGIN}px`,
  right: `${DRAWER_MARGIN}px`,
  bottom: `${DRAWER_MARGIN}px`,
  // Fully opaque (no see-through to the page): the surface token is ~98% alpha,
  // so paint a solid theme-appropriate fill. Dark → solid dark, light → solid
  // white. Shadow + rounding below are unchanged.
  background: theme === 'light' ? '#ffffff' : '#0f0f0f',
  border: `1px solid ${t.surfaceBorder}`,
  borderRadius: '16px',
  boxShadow: t.surfaceShadow,
  pointerEvents: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  color: t.textPrimary,
  fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: '12px',
  letterSpacing: '-0.02em',
  overflow: 'hidden',
});

export const panelHeader = (_t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  // Left padding matches the section labels (container 16 + sectionHeader 6).
  padding: '16px 16px 10px 22px',
});

// Matches the "Background Tasks" header (medium weight, 50% ink). Labels are
// nudged 4px right / Clear 4px left via the padding.
export const sectionHeader = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  color: t.textPrimary,
  opacity: 0.5,
  fontSize: '12px',
  fontWeight: 500,
  padding: '8px 6px 6px',
});

export const clearBtn = (_t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  // Inherits the section header's 50%-ink color.
  color: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
});

export const iconBtn = (t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  color: t.textFaint,
  cursor: 'pointer',
  padding: '2px',
  display: 'inline-flex',
});
