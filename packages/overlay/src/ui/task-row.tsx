/** @jsxImportSource preact */
import { type Task, modelLabel } from '@iris/shared';
import { useState } from 'preact/hooks';
import { StopIcon } from './icons';
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
  /** The worktree still exists. Merge/Discard vanish once it's gone. */
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
  // Merge and Discard both destroy the worktree, so they arm before they fire.
  // A native confirm() dialog raised from inside the user's own app reads as
  // the page misbehaving; a label that flips to "Sure?" stays in the overlay.
  const [confirming, setConfirming] = useState<'merge' | 'discard' | null>(null);
  const wt = worktree?.available ? worktree : null;
  // A finished task has something to land; a failed one only has a worktree to
  // clean up. Running rows never get the prop in the first place.
  const canLand = wt != null && task.status === 'done';
  // Whether there's a button row at all — it owns the gap above it, so an empty
  // one would be 16px of dead space under a running task's status line.
  const hasActions = (failed && onRetry != null) || wt != null;
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
          <div style={{ fontWeight: 500, fontSize: '13px', lineHeight: 1.5, color: p.ink }}>
            {task.prompt}
          </div>
          {/* "View chat" rides the status line, just past the elapsed time. It
              reads the task rather than acting on it, so it stays off the row
              of buttons below — down there it looked like a fourth control. */}
          <div
            style={{
              // One tone for the whole status line. The model, what it's doing
              // and the elapsed time are a single sentence, so splitting them
              // across two greys made the timer read as a separate item; they
              // now share the quieter of the two. "View chat" is the only part
              // of the line that isn't status — it keeps the brighter ink from
              // `.la-tp-soft`, which is what makes it findable.
              color: p.faint,
              fontSize: '13px',
              lineHeight: 1.5,
              marginTop: '3px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span>
              {statusLine(task)} · {elapsed(task)}
            </span>
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
          </div>
          {/* What the last worktree action had to say, above the buttons rather
              than after them.

              These used to hang off the bottom of the card, so a row that was a
              tidy two-line header plus a row of controls turned into a ragged
              stack of four text blocks, and the thing you had to read came last.
              Read top to bottom the row is now one sentence: here is the task,
              here is what happened to it, here is what you can still do. It also
              puts a failure directly above the controls that produced it, where
              the next click is going to be. */}
          {wt?.note ? <div style={outcomeText(p.soft)}>{wt.note}</div> : null}
          {wt?.error ? <div style={outcomeText(p.error)}>{wt.error}</div> : null}
          {/* Failed rows show Retry — a clear way to re-run. Finished rows show
              the ways to land the worktree's work, which until now existed only
              in the shell page at :4747. Controls run left to right in
              descending weight, and Discard — the one that throws work away —
              is set apart from them by a wider gap (see discardBtn).

              The 12px above the row is the container's, not each button's, so
              the gap is one number rather than four — and a row with nothing in
              it (a task still running) adds no space at all. */}
          {hasActions ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginTop: '12px',
              }}
            >
              {failed && onRetry ? (
                <button type="button" style={retryBtn(theme)} onClick={onRetry}>
                  Retry
                </button>
              ) : null}
              {/* Once the PR exists it takes the slot Create PR was in, as the
                  same pill with a new label — the row doesn't re-flow, it just
                  changes what it says. Creating a second PR for a branch that
                  already has one isn't the next thing anyone wants, and leaving
                  the button there at full weight claimed it was.

                  Still a link the user clicks, not an auto-opened window: the
                  popup would fire after an await, outside the click gesture,
                  and get blocked. It also lets them come back to it later. */}
              {wt?.prUrl ? (
                <a
                  style={prLinkPill(theme)}
                  href={wt.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={wt.prUrl}
                >
                  {wt.prLabel ?? 'View PR'} ↗
                </a>
              ) : null}
              {canLand && wt ? (
                <>
                  {wt.prUrl ? null : (
                    <button
                      type="button"
                      className="la-tp-act"
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
                  )}
                  <button
                    type="button"
                    className="la-tp-soft la-tp-act"
                    style={mergeBtn(theme)}
                    disabled={wt.pending}
                    onClick={() => {
                      if (confirming === 'merge') {
                        setConfirming(null);
                        wt.onShip();
                      } else {
                        setConfirming('merge');
                      }
                    }}
                    onBlur={() => setConfirming((c) => (c === 'merge' ? null : c))}
                    title="Merge this worktree into your checkout and delete it"
                  >
                    {confirming === 'merge' ? 'Sure?' : 'Merge locally'}
                  </button>
                </>
              ) : null}
              {wt ? (
                <button
                  type="button"
                  className="la-tp-soft la-tp-act"
                  style={discardBtn(theme, (failed && onRetry != null) || canLand)}
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
          ) : null}
        </div>
      </div>
      {onCancel ? (
        <div style={stopRow()}>
          <button
            type="button"
            style={stopCircle(theme)}
            onClick={onCancel}
            aria-label="Stop"
            title="Stop this task"
          >
            <StopIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

const cardStyle = (theme: OverlayTheme) => ({
  background: surfacePalette(theme).fill,
  borderRadius: '6px',
  // One number on every side: the title used to sit further from the top than
  // from the left, which read as the text drifting down the card. The gap
  // between cards is larger than the padding inside them, so rows still group
  // as separate pieces of work.
  padding: '12px',
  marginBottom: '10px',
  position: 'relative' as const,
});

// Text-only button, taking the popover's quiet-action idiom: soft ink that
// lifts to full on hover, via `.la-tp-soft`. Deliberately *not* an opacity
// fade — theme.ts makes the case: opacity also washes out anything nested
// inside, and it is a second way of saying what the palette's `soft` already
// says. No inline `color` for the same reason the worktree pill has no inline
// border-color: it would outrank the class and kill the hover.
const quietBtn = (_theme: OverlayTheme) => ({
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  // Vertically the filled buttons' padding, so a text-only control still sits
  // on the same 24px line; narrower flanks because it has no pill around it.
  padding: '4px 6px',
  lineHeight: 1.2,
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'var(--la-tp-cursor, pointer)',
  flexShrink: 0,
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
});

// Was `t.link` — a #60a5fa blue that was the loudest thing in the drawer and
// appears nowhere in the popover. Now the popover's quiet-action idiom: soft
// ink that lifts to full on hover (`.la-tp-soft`, mirroring `.la-pp-soft`).
const viewChatLink = () => ({
  background: 'transparent',
  border: 'none',
  fontSize: '13px',
  cursor: 'var(--la-tp-cursor, pointer)',
  padding: 0,
  margin: 0,
  // Sits inline on the status line, after the elapsed time — so no block
  // display and no top margin of its own; the line's flex gap does the spacing.
  display: 'inline',
  lineHeight: 'inherit',
  fontFamily: 'inherit',
});

// Every button in a row is a pill, borrowing the popover's control shape: the
// worktree chip and the send button are both 999px, so a 6px-rounded rectangle
// in the drawer was the one square corner in the whole overlay.
const PILL_RADIUS = '999px';

// Failed-row "Retry" — the primary recovery action, so it borrows the popover's
// primary control: the send button's inverted fill, not a blue accent.
const retryBtn = (theme: OverlayTheme) => ({
  // The popover's filled control — its worktree pill when checked. NOT the
  // send button's inverted #373734: a solid dark slab is the popover's smallest
  // element (a 23px circle), and at button width it was the loudest thing in
  // the drawer, which is the opposite of what the palette is for.
  background: surfacePalette(theme).fill,
  border: 'none',
  borderRadius: PILL_RADIUS,
  color: surfacePalette(theme).ink,
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'var(--la-tp-cursor, pointer)',
  // A 24px box: 13 x 1.2 = 16px of text, plus 4 top and bottom. Two taller and
  // four wider than the popover's worktree pill — these carry the row's real
  // decisions, and at the pill's exact size they read as incidental chrome.
  padding: '4px 11px',
  lineHeight: 1.2,
  letterSpacing: 'inherit',
  display: 'block',
  fontFamily: 'inherit',
});

// Three ways to land a worktree, three weights, left to right: "Create PR" is
// the one to reach for by default, so it takes the popover's inverted fill (the
// same primary treatment as Retry). Deliberately NOT the shell bar's #16a34a
// green: the overlay palette has no hues at all, and one green button would be
// the only colour in the drawer.
const prBtn = (theme: OverlayTheme) => ({
  // The popover's filled control — its worktree pill when checked. NOT the
  // send button's inverted #373734: a solid dark slab is the popover's smallest
  // element (a 23px circle), and at button width it was the loudest thing in
  // the drawer, which is the opposite of what the palette is for.
  background: surfacePalette(theme).fill,
  border: 'none',
  borderRadius: PILL_RADIUS,
  color: surfacePalette(theme).ink,
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'var(--la-tp-cursor, pointer)',
  // A 24px box: 13 x 1.2 = 16px of text, plus 4 top and bottom. Two taller and
  // four wider than the popover's worktree pill — these carry the row's real
  // decisions, and at the pill's exact size they read as incidental chrome.
  padding: '4px 11px',
  lineHeight: 1.2,
  letterSpacing: 'inherit',
  fontFamily: 'inherit',
});

// "Merge locally" is the secondary way to land — an outline, so it reads as the
// considered alternative to opening a PR rather than a second equal pull.
//
// Named for what it does. It was "Ship it", which reads as "send this out into
// the world" — the exact opposite of the truth, since nothing leaves your
// machine: it merges the branch into your checkout. "Create PR" beside it is
// the one that actually goes anywhere.
const mergeBtn = (theme: OverlayTheme) => ({
  background: 'transparent',
  border: `1px solid ${surfacePalette(theme).stroke}`,
  borderRadius: PILL_RADIUS,
  // No inline colour: `.la-tp-soft` gives it the popover pill's soft ink, which
  // lifts to full on hover. Inline would outrank the class and kill that.
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'var(--la-tp-cursor, pointer)',
  // One less than the filled buttons on every side; its 1px border makes up the
  // difference, so both land on the same 24px box.
  padding: '3px 10px',
  lineHeight: 1.2,
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
});

// The PR, once there is one, wearing Create PR's pill — same box, same fill,
// same 24px line, so the row it sits in doesn't change shape when the action
// succeeds. An anchor rather than a button: see the comment at the call site.
//
// `color` is inline here and that's fine — inherited from prBtn, and this pill
// has no :hover rule to outrank. It is also the only thing stopping the host
// page's own link colour (or the UA's blue) from painting it.
const prLinkPill = (theme: OverlayTheme) => ({
  ...prBtn(theme),
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
});

// "Discard" is the tertiary, destructive one: Stop's text-only shape, held
// apart from the controls that keep the work.
//
// The separation used to be `marginLeft: auto`, which pinned it to the far
// right of the card. Next to two buttons that read as deliberate; next to one
// (a failed row is Retry and Discard, nothing else) it left a 150px hole in the
// middle of the row, and the two controls stopped reading as one set of
// choices. Adding one more row-gap in front of it says the same thing — this
// one is not part of that group — at any number of buttons, and never opens a
// void. 8 + 8: double the space between the controls that keep the work.
//
// `apart` is false on a cancelled row, where Discard is the only control there
// is — a gap that exists to separate it from something has nothing to do when
// it stands alone, and would just indent it off the card's text.
const DISCARD_GAP = '8px';

const discardBtn = (theme: OverlayTheme, apart: boolean) => ({
  ...quietBtn(theme),
  borderRadius: PILL_RADIUS,
  marginLeft: apart ? DISCARD_GAP : 0,
});

// A note or an error from the last worktree action, sitting between the status
// line and the buttons. Soft ink for a note, the palette's one hue for an
// error — the same 13px/1.5 as everything else in the row, because it is prose
// about the task and not a control.
const outcomeText = (color: string) => ({
  color,
  fontSize: '13px',
  lineHeight: 1.5,
  marginTop: '6px',
});

/**
 * Stop's corner. 12px of air under the status line, then the button pulled out
 * of the card's 12px padding to sit 6px from the right and bottom edges — close
 * enough to the corner to read as the card's own control rather than another
 * item in the stack.
 */
const stopRow = () => ({
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: '12px',
  marginRight: '-6px',
  marginBottom: '-6px',
});

/**
 * The chat composer's Stop button, unchanged: the popover's inverted circle
 * carrying the same StopIcon. A running task and an in-flight message are the
 * same act, so they get the same control rather than one being a word.
 */
const stopCircle = (theme: OverlayTheme) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // 24, matching the buttons on a finished row rather than the composer's 26:
  // a circle reads larger than a pill of the same height, so the composer's
  // size looked oversized parked in the corner of a card.
  width: '24px',
  height: '24px',
  flexShrink: 0,
  background: surfacePalette(theme).submitBg,
  border: 'none',
  borderRadius: '999px',
  color: surfacePalette(theme).submitText,
  cursor: 'var(--la-tp-cursor, pointer)',
  padding: 0,
});
