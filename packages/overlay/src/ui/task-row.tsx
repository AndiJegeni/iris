/** @jsxImportSource preact */
import { type Task, modelLabel } from '@iris/shared';
import type { ThemeTokens } from './theme';

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

export const DOT_COLOR: Record<Task['status'], string> = {
  queued: '#a1a1aa',
  running: '#3b82f6',
  editing: '#8b5cf6',
  done: '#16a34a',
  failed: '#dc2626',
  cancelled: '#a1a1aa',
};

export type TaskRowProps = {
  task: Task;
  t: ThemeTokens;
  hasTranscript: boolean;
  onOpenChat: () => void;
  onCancel?: () => void;
  /** Re-run this task; only rendered for failed rows. */
  onRetry?: () => void;
};

export function TaskRow({ task, t, hasTranscript, onOpenChat, onCancel, onRetry }: TaskRowProps) {
  const failed = task.status === 'failed';
  return (
    <div style={cardStyle(t)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
        {/* Only the failed state shows a status dot. */}
        {failed ? (
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: DOT_COLOR[task.status],
              marginTop: '5px',
              flexShrink: 0,
            }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: '12px', color: t.textPrimary }}>
            {task.prompt}
          </div>
          <div style={{ color: t.textMuted, fontSize: '12px', marginTop: '2px' }}>
            {statusLine(task)} <span style={{ color: t.textFaint }}>· {elapsed(task)}</span>
          </div>
          {/* Failed rows show Retry alongside View chat — a clear way to re-run. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {hasTranscript ? (
              <button type="button" style={viewChatLink(t)} onClick={onOpenChat}>
                View chat
              </button>
            ) : null}
            {failed && onRetry ? (
              <button type="button" style={retryBtn(t)} onClick={onRetry}>
                Retry
              </button>
            ) : null}
          </div>
        </div>
        {onCancel ? (
          <button type="button" className="la-tp-dim" style={stopBtn(t)} onClick={onCancel}>
            Stop
          </button>
        ) : null}
      </div>
    </div>
  );
}

const cardStyle = (t: ThemeTokens) => ({
  background: t.cardBg,
  borderRadius: '6px',
  padding: '11px 12px',
  marginBottom: '7px',
});

// Text-only button: 50% ink, no fill/border, brightens to 100% on hover
// (handled by the .la-tp-dim rule). Slightly rounded for the focus ring.
const stopBtn = (t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  padding: '4px 6px',
  fontSize: '12px',
  fontWeight: 500,
  color: t.textPrimary,
  cursor: 'pointer',
  flexShrink: 0,
  fontFamily: 'inherit',
});

const viewChatLink = (t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  color: t.link,
  fontSize: '12px',
  cursor: 'pointer',
  padding: 0,
  marginTop: '8px',
  // Sits left-aligned under the status line.
  display: 'block',
  fontFamily: 'inherit',
});

// Failed-row "Retry" — a clearly-visible pill that re-runs the original prompt.
// Tinted with the accent so it reads as the primary recovery action.
const retryBtn = (t: ThemeTokens) => ({
  background: t.accent,
  border: 'none',
  borderRadius: '6px',
  color: t.accentText,
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '4px 10px',
  marginTop: '8px',
  display: 'block',
  fontFamily: 'inherit',
});
