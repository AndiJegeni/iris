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
  // Subtle inset tile inside a surface (e.g. a task row card)
  cardBg: string;
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
    // Neutral (R=G=B) grays, a step darker — the old zinc tones read slightly blue.
    pillBg: 'rgba(16, 16, 16, 0.9)',
    pillText: '#ffffff',
    pillShadow: '0 2px 16px rgba(0, 0, 0, 0.25)',
    surfaceBg: 'rgba(15, 15, 15, 0.98)',
    surfaceBorder: 'rgba(255, 255, 255, 0.06)',
    surfaceShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
    cardBg: 'rgba(255, 255, 255, 0.04)',
    textPrimary: '#f5f5f5',
    textMuted: '#a3a3a3',
    textFaint: '#737373',
    fieldBg: 'rgba(0, 0, 0, 0.35)',
    fieldBorder: 'rgba(255, 255, 255, 0.06)',
    controlBg: 'rgba(255, 255, 255, 0.06)',
    controlBorder: 'rgba(255, 255, 255, 0.06)',
    chipBg: 'rgba(255, 255, 255, 0.06)',
    chipText: '#e5e5e5',
    accent: '#3b82f6',
    accentText: '#ffffff',
    link: '#60a5fa',
    toggleActiveBg: '#1e40af',
    toggleActiveText: '#dbeafe',
    submitBg: '#f5f5f5',
    submitText: '#18181b',
  },
  light: {
    pillBg: 'rgba(255, 255, 255, 0.95)',
    pillText: '#18181b',
    pillShadow: '0 4px 16px rgba(0, 0, 0, 0.16)',
    surfaceBg: 'rgba(255, 255, 255, 0.98)',
    surfaceBorder: 'rgba(0, 0, 0, 0.1)',
    surfaceShadow: '0 20px 50px rgba(0, 0, 0, 0.2)',
    cardBg: 'rgba(55, 55, 52, 0.03)',
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

/**
 * The palette every floating surface paints from — the picked popover's colors,
 * lifted out so the task drawer and the chat are visibly the same object rather
 * than three products sharing a corner of the screen.
 *
 * The point of it is what it *leaves out*. `ThemeTokens` carries three unrelated
 * zinc greys for text (`#f5f5f5` / `#a3a3a3` / `#737373`) plus a blue `link` and
 * a blue `accent`; the popover never touches them. It draws with **one** ink at
 * three alphas, one fill, one stroke — which is why it reads as a single
 * material and the drawer, with its blue "View chat" and blue Retry pill, did
 * not. Status red is the sole exception, because it carries meaning.
 *
 * Light is the popover's "ink on paper" override set (#373734 on white);
 * picked-popover.styles re-exports INK/STROKE/SURFACE/PLACEHOLDER from here, so
 * these values have exactly one definition and cannot drift apart.
 */
export type SurfacePalette = {
  /** Panel background. Near-opaque, paired with a backdrop blur. */
  surface: string;
  /** Outline, dividers, and the containers drawn with a line instead of a fill. */
  stroke: string;
  /** Primary text — prose, titles, filenames. */
  ink: string;
  /** Secondary text: the same ink, thinned. Labels, placeholders, quiet actions. */
  soft: string;
  /** Tertiary text: thinner still. Arguments trailing a verb, durations. */
  faint: string;
  /** The one fill — your own messages, chips, inset tiles. */
  fill: string;
  /** Hover wash on rows and icon buttons. */
  hover: string;
  /** Primary action (the send button), inverted against the surface. */
  submitBg: string;
  submitText: string;
  /** The one hue that isn't ink, because failure has to be legible as failure. */
  error: string;
};

export const SURFACE_PALETTE: Record<OverlayTheme, SurfacePalette> = {
  dark: {
    surface: 'rgba(15, 15, 15, 0.98)',
    stroke: 'rgba(255, 255, 255, 0.06)',
    ink: '#f5f5f5',
    soft: 'rgba(245, 245, 245, 0.4)',
    faint: 'rgba(245, 245, 245, 0.25)',
    fill: 'rgba(255, 255, 255, 0.06)',
    hover: 'rgba(255, 255, 255, 0.06)',
    submitBg: '#f5f5f5',
    submitText: '#18181b',
    error: '#f87171',
  },
  light: {
    surface: '#ffffff',
    stroke: 'rgba(55, 55, 52, 0.1)', // #373734 @ 10%
    ink: '#373734',
    soft: 'rgba(55, 55, 52, 0.5)',
    faint: 'rgba(55, 55, 52, 0.3)',
    // #EBEBEB @ 50% — the popover's filled-control tint (its worktree pill).
    // Not the 10% stroke: a fill and a line doing the same job at the same
    // weight is what made the old chat read as containers inside containers.
    fill: 'rgba(235, 235, 235, 0.5)',
    hover: 'rgba(0, 0, 0, 0.05)',
    submitBg: '#373734',
    submitText: '#ffffff',
    error: '#dc2626',
  },
};

export function surfacePalette(theme: OverlayTheme = 'dark'): SurfacePalette {
  return SURFACE_PALETTE[theme];
}

/**
 * The popover's card geometry, shared for the same reason as the palette above.
 *
 * Matching paint turned out not to be enough on its own: the chat and drawer
 * were already painting these colours, and still read as a different object
 * because they were a 16px-radius panel with 16px gutters next to an 8px card
 * with 12px ones. Corner radius and gutter are as much of the card's identity
 * as its fill.
 */
export const SURFACE_RADIUS = '8px';
/** Horizontal gutter inside a surface, in px. */
export const SURFACE_PAD = 12;
/** Width of a floating surface. One width, so they stack as the same card. */
export const SURFACE_WIDTH = 380;

/**
 * `ThemeTokens` as the picked popover builds them — for shared children that
 * take a whole token set rather than a palette (today: ModelReasoningPicker,
 * which the popover, the chat composer and the drawer all render).
 *
 * Dark passes the tokens through untouched: the palette above *is* the dark
 * token set for every colour the popover uses. Light re-points them at the ink
 * palette, because the light tokens are a cool near-black on grey that clashes
 * with the warm #373734. Passing this from all three call sites is what keeps
 * one picker from rendering two ways.
 */
export function popoverTokens(theme: OverlayTheme): ThemeTokens {
  const base = THEME_TOKENS[theme];
  if (theme !== 'light') return base;
  const p = SURFACE_PALETTE.light;
  return {
    ...base,
    surfaceBg: p.surface,
    surfaceBorder: p.stroke,
    textPrimary: p.ink,
    textMuted: p.ink,
    textFaint: p.ink,
    controlBorder: p.stroke,
    chipBg: p.stroke,
    chipText: p.ink,
    link: p.ink,
    accent: p.ink,
    accentText: p.submitText,
    submitBg: p.submitBg,
    submitText: p.submitText,
  };
}
