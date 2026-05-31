/**
 * Overlay theming. The overlay floats over an arbitrary host page, so its
 * surfaces come in a dark and a light variant. Status/accent hues (the green/
 * yellow/red dots, the blue primary) are intentionally shared across themes —
 * only the surfaces, text, borders, and field fills swap.
 *
 * The real overlay picks a theme from `prefers-color-scheme` (see overlay.tsx);
 * the component gallery drives it from its toggle. Components default to `dark`.
 */
export type OverlayTheme = 'dark' | 'light';

export type ThemeTokens = {
  // Floating pill (idle background; active uses `accent`)
  pillBg: string;
  pillText: string;
  pillShadow: string;
  // Cards — picked popover + task tiles
  surfaceBg: string;
  surfaceBorder: string;
  surfaceShadow: string;
  // Text
  textPrimary: string;
  textMuted: string;
  textFaint: string;
  // Text input (textarea)
  fieldBg: string;
  fieldBorder: string;
  // Inline controls (select, worktree toggle idle) + code chips
  controlBg: string;
  controlBorder: string;
  chipBg: string;
  chipText: string;
  // Accents (shared, but tuned per theme where contrast needs it)
  accent: string;
  accentText: string;
  link: string;
  toggleActiveBg: string;
  toggleActiveText: string;
  // Primary submit button — intentionally inverted (high-contrast) vs the surface
  submitBg: string;
  submitText: string;
};

export const THEME_TOKENS: Record<OverlayTheme, ThemeTokens> = {
  dark: {
    pillBg: 'rgba(20, 20, 20, 0.88)',
    pillText: '#ffffff',
    pillShadow: '0 2px 16px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
    surfaceBg: 'rgba(20, 20, 23, 0.97)',
    surfaceBorder: 'rgba(255, 255, 255, 0.08)',
    surfaceShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
    textPrimary: '#f4f4f5',
    textMuted: '#a1a1aa',
    textFaint: '#71717a',
    fieldBg: 'rgba(0, 0, 0, 0.35)',
    fieldBorder: 'rgba(255, 255, 255, 0.08)',
    controlBg: 'rgba(255, 255, 255, 0.06)',
    controlBorder: 'rgba(255, 255, 255, 0.08)',
    chipBg: 'rgba(255, 255, 255, 0.06)',
    chipText: '#e4e4e7',
    accent: '#3b82f6',
    accentText: '#ffffff',
    link: '#60a5fa',
    toggleActiveBg: '#1e40af',
    toggleActiveText: '#dbeafe',
    submitBg: '#f4f4f5',
    submitText: '#18181b',
  },
  light: {
    pillBg: 'rgba(255, 255, 255, 0.95)',
    pillText: '#18181b',
    pillShadow: '0 4px 16px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.1) inset',
    surfaceBg: 'rgba(255, 255, 255, 0.98)',
    surfaceBorder: 'rgba(0, 0, 0, 0.1)',
    surfaceShadow: '0 20px 50px rgba(0, 0, 0, 0.2)',
    textPrimary: '#18181b',
    textMuted: '#52525b',
    textFaint: '#a1a1aa',
    fieldBg: 'rgba(0, 0, 0, 0.04)',
    fieldBorder: 'rgba(0, 0, 0, 0.14)',
    controlBg: 'rgba(0, 0, 0, 0.05)',
    controlBorder: 'rgba(0, 0, 0, 0.14)',
    chipBg: 'rgba(0, 0, 0, 0.06)',
    chipText: '#27272a',
    accent: '#3b82f6',
    accentText: '#ffffff',
    link: '#2563eb',
    toggleActiveBg: '#2563eb',
    toggleActiveText: '#eff6ff',
    submitBg: '#18181b',
    submitText: '#ffffff',
  },
};

export function tokens(theme: OverlayTheme = 'dark'): ThemeTokens {
  return THEME_TOKENS[theme];
}
