/** @jsxImportSource preact */
import { useEffect, useRef } from 'preact/hooks';
import { CloseThinIcon } from './icons';
import { type OverlayTheme, SURFACE_WIDTH, type SurfacePalette, surfacePalette } from './theme';

type ConfirmDialogProps = {
  title: string;
  /** Prose under the title. Says what is about to be destroyed, in numbers. */
  body: string;
  /** Verb on the destructive button — "Clear", "Discard". */
  confirmLabel: string;
  theme?: OverlayTheme;
  onConfirm: () => void;
  /** Every way out that isn't the confirm button: ×, Cancel, Escape, scrim. */
  onCancel: () => void;
};

/**
 * The overlay's modal question, for actions too destructive to fire on a click.
 * The Preact twin of the orchestrator shell's askConfirm() (shell-html.ts), down
 * to the inverted buttons — same product, same question, so they look the same.
 *
 * Single-row actions do not use this: a row's own Merge and Archive ask inline,
 * on the row being acted on (see TaskRow). This is for the bulk ones, where the
 * thing at stake is a count rather than the card under the cursor.
 *
 * Mount it at the overlay root, never inside a panel. The drawer sets
 * `backdrop-filter`, which makes it the containing block for its fixed-position
 * descendants — a dialog nested in there is clipped by the drawer's `overflow:
 * hidden` however it is positioned.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  theme = 'dark',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const p = surfacePalette(theme);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // The safe button takes focus, so Enter on a dialog you didn't read cancels
  // rather than destroys.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the scrim's keyboard twin is Escape, above
    <div
      style={scrimStyle(p)}
      // The scrim itself, not the dialog sitting on it: without the guard a
      // click that starts on a button and ends on the card dismisses.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Hover ink and its fade live in classes so an inline value can't outrank
          them (see inline-vs-hover.test.ts). */}
      <style>{confirmDialogCss(p)}</style>
      {/* biome-ignore lint/a11y/useSemanticElements: <dialog> is UA-positioned and
          top-layer only via showModal(), which neither the flex centring nor the
          scrim above would survive */}
      <div role="dialog" aria-modal="true" aria-label={title} style={cardStyle(p, theme)}>
        <div style={headStyle(p)}>
          <span style={titleStyle(p)}>{title}</span>
          <button
            type="button"
            className="la-cd-close"
            style={closeBtn()}
            onClick={onCancel}
            aria-label="Close"
          >
            <CloseThinIcon />
          </button>
        </div>
        <p style={bodyStyle(p)}>{body}</p>
        <div style={actionsStyle()}>
          <button type="button" className="la-cd-btn" style={secondaryBtn(p)} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="la-cd-btn"
            style={primaryBtn(p)}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const confirmDialogCss = (p: SurfacePalette): string =>
  [
    '.la-cd-btn{transition:opacity 90ms}.la-cd-btn:hover{opacity:0.85}',
    `.la-cd-close{color:${p.soft};transition:color 90ms}.la-cd-close:hover{color:${p.ink}}`,
  ].join('');

const scrimStyle = (p: SurfacePalette) => ({
  position: 'fixed' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
  background: p.scrim,
  // Over everything else the overlay paints, the pill's zIndex 1 included —
  // a modal question with a live control on top of it isn't modal.
  zIndex: 10,
  pointerEvents: 'auto' as const,
  fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  letterSpacing: '-0.02em',
});

/**
 * The shell dialog's 18px rather than the surfaces' SURFACE_RADIUS: this is one
 * small card centred in an empty field, not a panel docked to an edge, and at
 * 8px it read as a torn-off scrap of the drawer.
 */
const cardStyle = (p: SurfacePalette, theme: OverlayTheme) => ({
  width: `min(${SURFACE_WIDTH}px, 100%)`,
  background: p.surface,
  border: `1px solid ${p.stroke}`,
  borderRadius: '18px',
  padding: '16px 18px',
  boxShadow:
    theme === 'light' ? '0 16px 48px rgba(0, 0, 0, 0.2)' : '0 16px 48px rgba(0, 0, 0, 0.45)',
  color: p.ink,
});

const headStyle = (p: SurfacePalette) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  paddingBottom: '12px',
  borderBottom: `1px solid ${p.stroke}`,
});

const titleStyle = (p: SurfacePalette) => ({
  fontSize: '13px',
  fontWeight: 600,
  color: p.ink,
});

const closeBtn = () => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: 0,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  // No inline `color` — `.la-cd-close` owns it so its :hover can win.
});

const bodyStyle = (p: SurfacePalette) => ({
  margin: '12px 0 0',
  fontSize: '12px',
  lineHeight: 1.55,
  color: p.soft,
});

const actionsStyle = () => ({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '18px',
});

const btnBase = () => ({
  border: 'none',
  borderRadius: '999px',
  padding: '7px 16px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
  cursor: 'pointer',
});

/**
 * Inverted from where the eye expects them: Cancel wears the filled primary and
 * the destructive verb the quiet fill, so the button that throws work away is
 * never the inviting one.
 */
const primaryBtn = (p: SurfacePalette) => ({
  ...btnBase(),
  background: p.submitBg,
  color: p.submitText,
});

const secondaryBtn = (p: SurfacePalette) => ({
  ...btnBase(),
  background: p.fill,
  color: p.ink,
});
