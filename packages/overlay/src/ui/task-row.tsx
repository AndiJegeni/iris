/** @jsxImportSource preact */
import { type Task, modelLabel } from '@iris/shared';
import { useState } from 'preact/hooks';
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

/**
 * What a finished row can do with the worktree its task ran in. Omitted
 * entirely for running rows, and for tasks that ran in the user's own checkout
 * ("main") rather than a worktree of their own.
 */
export type WorktreeAction = {
  /** The worktree still exists. Ship/Discard vanish once it's gone. */
  available: boolean;
  /** A remote is configured, so there's somewhere to push. Gates Create PR alone. */
  canCreatePr: boolean;
  /** A request is in flight — disables all three buttons. */
  pending: boolean;
  /** Result of the last Create PR, rendered as a link the user clicks themselves. */
  prUrl?: string | null;
  prLabel?: string;
  /** A non-fatal outcome worth saying out loud (e.g. pushed, but gh isn't installed). */
  note?: string | null;
  error?: string | null;
  onShip: () => void;
  onCreatePr: () => void;
  onDiscard: () => void;
};

export type TaskRowProps = {
  task: Task;
  theme: OverlayTheme;
  hasTranscript: boolean;
  onOpenChat: () => void;
  onCancel?: () => void;
  /** Re-run this task; only rendered for failed rows. */
  onRetry?: () => void;
  /** Worktree actions. Optional — the gallery example renders rows without them. */
  worktree?: WorktreeAction;
};

export function TaskRow({
  task,
  theme,
  hasTranscript,
  onOpenChat,
  onCancel,
  onRetry,
  worktree,
}: TaskRowProps) {
  const failed = task.status === 'failed';
  const p = surfacePalette(theme);
  // Ship and Discard both destroy the worktree, so they arm before they fire.
  // A native confirm() dialog raised from inside the user's own app reads as
  // the page misbehaving; a label that flips to "Sure?" stays in the overlay.
  const [confirming, setConfirming] = useState<'ship' | 'discard' | null>(null);
  const wt = worktree?.available ? worktree : null;
  // A finished task has something to land; a failed one only has a worktree to
  // clean up. Running rows never get the prop in the first place.
  const canLand = wt != null && task.status === 'done';
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
          {/* Failed rows show Retry alongside View chat — a clear way to re-run.
              Finished rows add the ways to land the worktree's work, which
              until now existed only in the shell page at :4747. Wraps because
              five controls don't fit the card's width on one line. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
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
            {canLand && wt ? (
              <>
                <button
                  type="button"
                  style={shipBtn(theme)}
                  disabled={wt.pending}
                  onClick={() => {
                    if (confirming === 'ship') {
                      setConfirming(null);
                      wt.onShip();
                    } else {
                      setConfirming('ship');
                    }
                  }}
                  onBlur={() => setConfirming((c) => (c === 'ship' ? null : c))}
                  title="Merge this worktree into your checkout and delete it"
                >
                  {confirming === 'ship' ? 'Sure?' : 'Ship it'}
                </button>
                <button
                  type="button"
                  style={prBtn(theme)}
                  disabled={wt.pending || !wt.canCreatePr}
                  onClick={wt.onCreatePr}
                  title={
                    wt.canCreatePr
                      ? 'Push this branch and open a pull request'
                      : 'Unavailable — this repository has no git remote'
                  }
                >
                  {wt.pending ? 'Working…' : 'Create PR'}
                </button>
              </>
            ) : null}
            {wt ? (
              <button
                type="button"
                className="la-tp-dim"
                style={stopBtn(theme)}
                disabled={wt.pending}
                onClick={() => {
                  if (confirming === 'discard') {
                    setConfirming(null);
                    wt.onDiscard();
                  } else {
                    setConfirming('discard');
                  }
                }}
                onBlur={() => setConfirming((c) => (c === 'discard' ? null : c))}
                title="Delete this worktree without merging it"
              >
                {confirming === 'discard' ? 'Sure?' : 'Discard'}
              </button>
            ) : null}
          </div>
          {/* A link, not an auto-opened window: the popup would fire after an
              await, outside the click gesture, and get blocked. It also lets
              the user come back to the PR later. */}
          {wt?.prUrl ? (
            <a
              className="la-tp-soft"
              style={prLinkStyle()}
              href={wt.prUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {wt.prLabel ?? 'View PR'} ↗
            </a>
          ) : null}
          {wt?.note ? (
            <div style={{ color: p.soft, fontSize: '12px', marginTop: '6px' }}>{wt.note}</div>
          ) : null}
          {wt?.error ? (
            <div style={{ color: p.error, fontSize: '12px', marginTop: '6px' }}>{wt.error}</div>
          ) : null}
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

// "Ship it" is the primary way to land a worktree, so it takes the same
// inverted fill as Retry. Deliberately NOT the shell bar's #16a34a green: the
// overlay palette has no hues at all, and one green button would be the only
// colour in the drawer.
const shipBtn = (theme: OverlayTheme) => ({
  background: surfacePalette(theme).submitBg,
  border: 'none',
  borderRadius: '6px',
  color: surfacePalette(theme).submitText,
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '4px 10px',
  marginTop: '8px',
  fontFamily: 'inherit',
});

// "Create PR" is the considered alternative to shipping straight into your
// checkout — equal in weight, so an outline rather than a second filled button.
const prBtn = (theme: OverlayTheme) => ({
  background: 'transparent',
  border: `1px solid ${surfacePalette(theme).stroke}`,
  borderRadius: '6px',
  color: surfacePalette(theme).ink,
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '3px 10px',
  marginTop: '8px',
  fontFamily: 'inherit',
});

// The PR link borrows View chat's quiet-action shape, one line below the row.
const prLinkStyle = () => ({
  fontSize: '12px',
  marginTop: '8px',
  display: 'block',
  textDecoration: 'none',
  fontFamily: 'inherit',
});
