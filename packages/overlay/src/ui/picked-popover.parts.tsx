/** @jsxImportSource preact */
import type { AttachedImage } from '@iris/shared';
import { MAX_IMAGES_PER_ANNOTATION } from '@iris/shared';
import { ArrowUpIcon, PlusIcon } from './icons';
import { iconBtn, sendBtn, thumbRemove } from './picked-popover.styles';
import { type OverlayTheme, SURFACE_RADIUS, type ThemeTokens } from './theme';

/**
 * Drop-state accent. The surfaces paint from one ink at three alphas and keep a
 * single non-ink hue (status red), so this pink is a second exception and is
 * kept correspondingly thin: a 6% wash and a barely-there hairline, with the
 * one line of text carrying the colour. The light variant is the same hue
 * darkened (hsl 332°) — the raw pink only reaches 3.2:1 on white.
 */
const DROP_PINK = '#F157A0';
const DROP_PINK_INK = '#BE1865';

/**
 * Drop target feedback. Deliberately quiet: a veil in the surface's own colour
 * so the card behind softens rather than disappearing, a faint pink wash over
 * it, and one small line of text. It replaced a 2px dashed accent frame over a
 * heavy blue fill, which announced a file-upload widget on a card that is
 * really a message box.
 *
 * Covers the *composer*, not the whole surface. In the popover those are the
 * same rectangle; in the chat they are not, and veiling the full panel turned a
 * hint into a 440px pink sheet over a conversation you were still reading.
 */
export function DragOverlay({
  theme,
  radius = SURFACE_RADIUS,
}: {
  theme: OverlayTheme;
  /** Match the container being covered — the chat's composer flips pill/card. */
  radius?: string;
}) {
  const light = theme === 'light';
  const wash = light ? 'rgba(241, 87, 160, 0.05)' : 'rgba(241, 87, 160, 0.07)';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        // Wash over veil: the veil mutes the card, the wash tints the result.
        // One rgba pink alone would leave the composer fully legible underneath.
        background: `linear-gradient(${wash}, ${wash}), ${
          light ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 15, 15, 0.92)'
        }`,
        // A hairline, not a dashed frame: enough edge to read as a target.
        boxShadow: `inset 0 0 0 1px ${light ? 'rgba(190, 24, 101, 0.16)' : 'rgba(241, 87, 160, 0.2)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: light ? DROP_PINK_INK : DROP_PINK,
        fontSize: '12px',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      Drop to attach
    </div>
  );
}

/**
 * Attached image thumbnails — shown above the prompt input.
 *
 * The remove button rides inside the thumbnail's corner and only appears on
 * hover (or keyboard focus). Three thumbnails each wearing a permanent × badge
 * outside their corner read as a row of stickers rather than as attachments.
 */
export function ImageStrip({
  images,
  onRemove,
  t,
}: {
  images: AttachedImage[];
  onRemove: (idx: number) => void;
  t: ThemeTokens;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap',
        marginBottom: '8px',
      }}
    >
      {/* Scoped here, not in the host's style block: the strip renders in both
          the popover and the chat, and it should carry its own hover rule. */}
      <style>
        {
          '.la-thumb-x{opacity:0;transition:opacity 80ms}.la-thumb:hover .la-thumb-x,.la-thumb-x:focus-visible{opacity:1}'
        }
      </style>
      {images.map((img, i) => (
        <div
          key={img.dataBase64.slice(0, 24)}
          className="la-thumb"
          style={{ position: 'relative', width: '44px', height: '44px' }}
        >
          <img
            src={`data:${img.mediaType};base64,${img.dataBase64}`}
            alt={img.name ?? 'attachment'}
            title={img.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '6px',
              border: `1px solid ${t.surfaceBorder}`,
              display: 'block',
            }}
          />
          <button
            type="button"
            className="la-thumb-x"
            onClick={() => onRemove(i)}
            style={thumbRemove()}
            title="Remove"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Right cluster of the composer footer: attach · send. */
export function FooterActions({
  atImageLimit,
  canSubmit,
  onAttach,
  onSubmit,
  t,
}: {
  atImageLimit: boolean;
  canSubmit: boolean;
  onAttach: () => void;
  onSubmit: () => void;
  t: ThemeTokens;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
      <button
        type="button"
        onClick={onAttach}
        disabled={atImageLimit}
        style={{
          ...iconBtn(t),
          // Attach (#373734) sits at 60%; dimmer when at the image limit.
          opacity: atImageLimit ? 0.3 : 0.6,
          cursor: atImageLimit ? 'not-allowed' : 'pointer',
        }}
        title={
          atImageLimit
            ? `Max ${MAX_IMAGES_PER_ANNOTATION} images`
            : 'Attach images (or paste / drop)'
        }
        aria-label="Attach images"
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        className="la-pp-send"
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          ...sendBtn(t),
          // Send (#373734): full when active, 30% when disabled.
          opacity: canSubmit ? 1 : 0.3,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
        title="Send (↵)"
      >
        <ArrowUpIcon />
      </button>
    </div>
  );
}
