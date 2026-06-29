/** @jsxImportSource preact */
import type { AttachedImage } from '@localagents/shared';
import { MAX_IMAGES_PER_ANNOTATION } from '@localagents/shared';
import { ArrowUpIcon, PlusIcon } from './icons';
import { iconBtn, sendBtn, thumbRemove } from './picked-popover.styles';
import type { OverlayTheme, ThemeTokens } from './theme';

/** Dashed "drop here" overlay shown while an image drag hovers the popover. */
export function DragOverlay({ t, theme }: { t: ThemeTokens; theme: OverlayTheme }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '8px',
        border: `2px dashed ${t.accent}`,
        background: theme === 'light' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.16)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: t.accent,
        fontSize: '13px',
        fontWeight: 600,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      Drop images to attach
    </div>
  );
}

/** Attached image thumbnails — shown above the prompt input. */
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
        marginBottom: 'var(--la-pp-gap, 8px)',
      }}
    >
      {images.map((img, i) => (
        <div
          key={img.dataBase64.slice(0, 24)}
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
          <button type="button" onClick={() => onRemove(i)} style={thumbRemove(t)} title="Remove">
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
        title="Send (⌘↵)"
      >
        <ArrowUpIcon />
      </button>
    </div>
  );
}
