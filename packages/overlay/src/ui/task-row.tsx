/** @jsxImportSource preact */
import { type Task, modelLabel } from '@iris/shared';
import { type OverlayTheme, surfacePalette } from './theme';

export function isRunning(t: Task): boolean {
  return t.status === 'queued' || t.status === 'running' || t.status === 'editing';
}

export function elapsed(t: Task): string {
  const end = isRunning(t) ? Date.now() : t.updatedAt;
  const secs = Math.max(0, Math.round((end - t.createdAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

/** Model display name for a task — the model's label, else the backend name. */
export function modelName(t: Task): string {
  return t.model?.trim() ? modelLabel(t.model) : capitalize(t.backend);
}

export function statusLine(t: Task): string {
  const model = modelName(t);
  switch (t.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return model;
    case 'editing':
      return t.message ?? model;
    case 'done':
      return `${model} · Completed`;
    case 'failed':
      return `${model} · Failed`;
    case 'cancelled':
      return 'Cancelled';
  }
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Only the failed row draws a dot (see TaskRow), and it takes the popover's
 * error red. The other states are ink — a blue "running" and a purple "editing"
 * were two more hues in a palette that otherwise has none.
 */
export function dotColor(status: Task['status'], theme: OverlayTheme): string {
  const p = surfacePalette(theme);
  return status === 'failed' ? p.error : p.soft;
}

export type TaskRowProps = {
  task: Task;
  theme: OverlayTheme;
  hasTranscript: boolean;
  onOpenChat: () => void;
  onCancel?: () => void;
  /** Re-run this task; only rendered for failed rows. */
  onRetry?: () => void;
};

export function TaskRow({
  task,
  theme,
  hasTranscript,
  onOpenChat,
  onCancel,
  onRetry,
}: TaskRowProps) {
  const failed = task.status === 'failed';
  const p = surfacePalette(theme);
  return (
    <div style={cardStyle(theme)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
        {/* Only the failed state shows a status dot. */}
        {failed ? (
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: dotColor(task.status, theme),
              marginTop: '5px',
              flexShrink: 0,
            }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: '12px', color: p.ink }}>{task.prompt}</div>
          <div style={{ color: p.soft, fontSize: '12px', marginTop: '2px' }}>
            {statusLine(task)} <span style={{ color: p.faint }}>· {elapsed(task)}</span>
          </div>
          {/* Failed rows show Retry alongside View chat — a clear way to re-run. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {hasTranscript ? (
              <button
                type="button"
                className="la-tp-soft"
                style={viewChatLink()}
                onClick={onOpenChat}
              >
                View chat
              </button>
            ) : null}
            {failed && onRetry ? (
              <button type="button" style={retryBtn(theme)} onClick={onRetry}>
                Retry
              </button>
            ) : null}
          </div>
        </div>
        {onCancel ? (
          <button type="button" className="la-tp-dim" style={stopBtn(theme)} onClick={onCancel}>
            Stop
          </button>
        ) : null}
      </div>
    </div>
  );
}

const cardStyle = (theme: OverlayTheme) => ({
  background: surfacePalette(theme).fill,
  borderRadius: '6px',
  padding: '11px 12px',
  marginBottom: '7px',
});

// Text-only button: 50% ink, no fill/border, brightens to 100% on hover
// (handled by the .la-tp-dim rule). Slightly rounded for the focus ring.
const stopBtn = (theme: OverlayTheme) => ({
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  padding: '4px 6px',
  fontSize: '12px',
  fontWeight: 500,
  color: surfacePalette(theme).ink,
  cursor: 'pointer',
  flexShrink: 0,
  fontFamily: 'inherit',
});

// Was `t.link` — a #60a5fa blue that was the loudest thing in the drawer and
// appears nowhere in the popover. Now the popover's quiet-action idiom: soft
// ink that lifts to full on hover (`.la-tp-soft`, mirroring `.la-pp-soft`).
const viewChatLink = () => ({
  background: 'transparent',
  border: 'none',
  fontSize: '12px',
  cursor: 'pointer',
  padding: 0,
  marginTop: '8px',
  // Sits left-aligned under the status line.
  display: 'block',
  fontFamily: 'inherit',
});

// Failed-row "Retry" — the primary recovery action, so it borrows the popover's
// primary control: the send button's inverted fill, not a blue accent.
const retryBtn = (theme: OverlayTheme) => ({
  background: surfacePalette(theme).submitBg,
  border: 'none',
  borderRadius: '6px',
  color: surfacePalette(theme).submitText,
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '4px 10px',
  marginTop: '8px',
  display: 'block',
  fontFamily: 'inherit',
});
