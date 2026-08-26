import type { AttachedImage, ImageMediaType, SourceConfidence, WorktreeMode } from '@iris/shared';
import type { Resolution } from '../source-resolution';
import { SURFACE_PALETTE, type ThemeTokens } from './theme';

// Fixed "ink on paper" palette for the message box (matches the pill).
//
// Re-exported from SURFACE_PALETTE rather than restated: the task drawer and the
// chat now paint from the same values, and two copies of a hex would drift the
// moment one of them was tuned.
export const INK = SURFACE_PALETTE.light.ink; // all text + icons
export const STROKE = SURFACE_PALETTE.light.stroke; // #373734 @ 10% — borders / dividers
export const PLACEHOLDER = SURFACE_PALETTE.light.soft; // #373734 @ 50% — empty input text
export const SURFACE = SURFACE_PALETTE.light.surface;

// Open/close motion. Keyframe animations (not transitions) so the enter always
// plays on mount without depending on a follow-up rAF tick to flip state — a
// mount/unmount popover has no persistent element to transition. The smooth feel
// comes from the easing + the translateY/scale/opacity combo: a snappy start
// that settles softly. Close runs a touch quicker so dismissals feel
// responsive, with `forwards` holding the faded-out end state.
export const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const OPEN_MS = 220;
export const CLOSE_MS = 150;

export const ACCEPTED_IMAGE_TYPES: ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Read a File into an AttachedImage (base64, no data-URI prefix). Rejects non-images. */
export function fileToImage(file: File): Promise<AttachedImage | null> {
  return new Promise((resolve) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as ImageMediaType)) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result); // "data:<type>;base64,<payload>"
      const comma = result.indexOf(',');
      resolve({
        name: file.name || undefined,
        mediaType: file.type as ImageMediaType,
        dataBase64: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** Resolution confidence → the narrower confidence the annotation schema accepts. */
export function annotationConfidence(c: Resolution['confidence']): SourceConfidence {
  if (c === 'explicit') return 'high';
  if (c === 'none') return 'low';
  return c;
}

/** A fresh worktree is the default; the user can toggle it off. */
export function defaultWorktreeMode(_prompt: string): WorktreeMode {
  return 'new';
}

export const POPOVER_WIDTH = 380;
// Height guess for flip-above logic; covers the bar + card stack.
const POPOVER_HEIGHT_GUESS = 260;
const GAP = 8;

export function computeAnchor(element: Element): { top: number; left: number } {
  const r = element.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let top = r.bottom + GAP;
  let left = r.left;
  if (left + POPOVER_WIDTH > viewportW - GAP) {
    left = Math.max(GAP, viewportW - POPOVER_WIDTH - GAP);
  }
  if (left < GAP) left = GAP;
  if (top + POPOVER_HEIGHT_GUESS > viewportH - GAP) {
    top = Math.max(GAP, r.top - POPOVER_HEIGHT_GUESS - GAP);
  }
  return { top, left };
}

export const iconBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Matches the send button's box so the footer row stays a single height.
  width: '23px',
  height: '23px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: t.textMuted,
  cursor: 'pointer',
  padding: 0,
});

// Worktree toggle, styled as a pill. Active = filled pill with a check (like the
// screenshot); idle = outlined pill (1px border keeps the text in the same spot),
// no check. Text color comes from the .la-pp-soft class (so :hover can darken it
// — inline color would outrank the stylesheet).
//
// The border colour is handed over as custom properties for exactly that reason:
// the stroke darkens with the text on hover, and an inline `border-color` (which
// the `border` shorthand sets) beats any stylesheet rule short of !important, so
// the hover would silently do nothing. Width and style stay inline — nothing
// animates them. When the pill is filled both values are transparent, so hovering
// an already-on toggle doesn't sprout a ring around the fill.
//
// `strokeHover` is the label's *resting* colour (50% ink), not full ink: on hover
// the stroke rises to where the text sits at rest while the text goes to full, so
// both move without a 1px ring turning black and shouting over its own label.
export const worktreePill = (
  t: ThemeTokens,
  active: boolean,
  fill: string,
  strokeHover: string,
) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  background: active ? fill : 'transparent',
  borderWidth: '1px',
  borderStyle: 'solid',
  '--la-wt-stroke': active ? 'transparent' : t.controlBorder,
  '--la-wt-stroke-hover': active ? 'transparent' : strokeHover,
  borderRadius: '999px',
  padding: '2px 8px',
  margin: 0,
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.2,
  whiteSpace: 'nowrap' as const,
});

// Sits inside the thumbnail's corner on a dark scrim, so one style reads over
// any image in either theme — a themed bubble hovering outside the corner both
// clipped awkwardly and pulled the eye away from the picture.
export const thumbRemove = () => ({
  position: 'absolute' as const,
  top: '3px',
  right: '3px',
  width: '15px',
  height: '15px',
  borderRadius: '999px',
  border: 'none',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#ffffff',
  fontSize: '11px',
  lineHeight: '1',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
});

// 13px font × 1.5 line-height. The input starts at 1 line and the auto-grow
// effect steps it 1 → 2 → 3 lines; past 3 it hits this cap and scrolls.
const TEXTAREA_LINE_H = 20; // ≈ 13 × 1.5, one line
export const TEXTAREA_MAX_H = 59; // ≈ 3 lines

export const textarea = (t: ThemeTokens) => ({
  // Extends 4px past the content box on the right (8px from the card edge) so the
  // scrollbar lines up with the send button's right edge; left stays at 12px.
  width: 'calc(100% + 4px)',
  minHeight: `${TEXTAREA_LINE_H}px`,
  maxHeight: `${TEXTAREA_MAX_H}px`,
  background: 'transparent',
  border: 'none',
  color: t.textPrimary,
  padding: 0,
  fontFamily: 'inherit',
  // 13px — the composer's uniform text size, held in px so a host page's own
  // root font-size can't rescale the input out from under the popover.
  fontSize: '13px',
  lineHeight: 1.5,
  resize: 'none' as const,
  overflowY: 'auto' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
});

export const sendBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Icon is 13px; ~5px padding all around → 23px box, with a soft 5px radius.
  width: '23px',
  height: '23px',
  // Must be 0 — the UA default button padding (1px 6px) otherwise squeezes the
  // 16px icon down to ~11px wide, making it look smaller than the Plus.
  padding: 0,
  background: t.submitBg,
  border: 'none',
  borderRadius: '999px',
  color: t.submitText,
  fontFamily: 'inherit',
});

/**
 * Does this drag actually carry files? Without the check, dragging a text
 * selection or a link across the popover lit up the "Drop to attach" veil for a
 * payload it would have silently discarded.
 */
export function dragHasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types ? Array.from(types).includes('Files') : false;
}

/**
 * True when a dragleave means the cursor really left `el` — not that it crossed
 * onto a child. `relatedTarget` is where the cursor went; null means it left the
 * window entirely.
 */
export function dragLeftElement(e: DragEvent, el: EventTarget | null): boolean {
  const to = e.relatedTarget as Node | null;
  return !to || !(el as HTMLElement | null)?.contains(to);
}
