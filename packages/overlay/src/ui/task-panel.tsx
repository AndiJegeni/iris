/** @jsxImportSource preact */
import type {
  PullRequestResult,
  ReasoningEffort,
  Task,
  TranscriptEntry,
  Worktree,
} from '@iris/shared';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from './confirm-dialog';
import { BackgroundTasksIcon, CloseThinIcon } from './icons';
import { PILL_PALETTE } from './pill';
import { TaskChat } from './task-chat';
import {
  CHAT_WIDTH,
  DRAWER_WIDTH,
  buttonStyle,
  clearBtn,
  countStyle,
  iconBtn,
  panelHeader,
  panelStyle,
  sectionHeader,
  taskPanelCss,
} from './task-panel.styles';
import { TaskRow, type WorktreeAction, isRunning } from './task-row';
import { type OverlayTheme, SURFACE_PAD, surfacePalette } from './theme';

type TaskPanelProps = {
  tasks: Task[];
  logs: Record<string, string[]>;
  /** Structured per-task transcripts for the chat view (optional). */
  transcripts?: Record<string, TranscriptEntry[]>;
  theme?: OverlayTheme;
  onCancel: (id: string) => void;
  /**
   * Send a follow-up message to a task (resumes its session). `opts` carries
   * the chat composer's model + reasoning pickers for that turn.
   */
  onSendMessage?: (
    id: string,
    text: string,
    opts: { model: string; effort: ReasoningEffort },
  ) => void | Promise<void>;
  /** Called when a task's chat is opened (e.g. to load its full transcript). */
  onOpenChat?: (id: string) => void;
  /** Re-run a failed task (re-submits its original prompt as a fresh task). */
  onRetry?: (id: string) => void | Promise<void>;
  /**
   * Live worktrees, used to decide which finished rows still have something to
   * ship, PR, or discard. Optional — the gallery renders rows without them.
   */
  worktrees?: Worktree[];
  /** False when the repo has no git remote, which disables Create PR alone. */
  remoteAvailable?: boolean;
  onShip?: (slug: string) => Promise<void>;
  onCreatePr?: (slug: string) => Promise<PullRequestResult>;
  onDiscard?: (slug: string) => Promise<void>;
  /** Controlled open state (e.g. driven by the pill's chat button). Optional. */
  open?: boolean;
  /** Fired when the panel wants to open/close — pairs with `open` for control. */
  onOpenChange?: (open: boolean) => void;
  /** Seed for the self-managed open state (uncontrolled use, e.g. the gallery). */
  defaultOpen?: boolean;
  /** Where the launcher circle parks — left of the pill (see overlay.tsx). */
  launcherStyle?: Record<string, string> | undefined;
  /**
   * Draw the launcher circle. False when something else owns the Background
   * Tasks button — the orchestrator shell puts it in its top bar, next to the
   * viewport switcher, and two copies of the same control would be one too many.
   * The drawer is then opened purely through `open`/`onOpenChange`.
   */
  showLauncher?: boolean;
  /**
   * Server half of Archive: drops the task's record and transcript on the
   * daemon, so it doesn't reload at the next boot. The local hide below stays
   * synchronous — the row vanishes on click, not on round-trip.
   */
  onArchiveTask?: (id: string) => void;
  /** Where the drawer sits — top edge down to just above the pill row (overlay.tsx). */
  anchorStyle?: Record<string, string> | undefined;
};

/** Per-row state for the ship / PR / discard controls. */
type WorktreeRowState = {
  pending: boolean;
  prUrl: string | null;
  /** Undefined until a PR call returns a URL worth labelling. */
  prLabel: string | undefined;
  note: string | null;
  error: string | null;
};

const IDLE_ROW: WorktreeRowState = {
  pending: false,
  prUrl: null,
  prLabel: undefined,
  note: null,
  error: null,
};

/**
 * Conductor-style Background Tasks drawer: Running section with Stop +
 * transcript, Finished section with Clear. Clicking a task's "View chat" swaps
 * the panel into a full chat view (see TaskChat). Theme-aware (dark/light).
 *
 * Its launcher is a 40px circle parked to the left of the pill, on the same row.
 * It only exists once there's work to show: with no tasks the overlay is just
 * the pill, and the circle animates in when the first task is queued.
 */
export function TaskPanel({
  tasks,
  logs,
  transcripts,
  theme = 'dark',
  onCancel,
  onSendMessage,
  onOpenChat,
  onRetry,
  worktrees = [],
  remoteAvailable = true,
  onShip,
  onCreatePr,
  onDiscard,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  launcherStyle,
  showLauncher = true,
  onArchiveTask,
  anchorStyle,
}: TaskPanelProps) {
  const p = surfacePalette(theme);
  // The launcher circle sits on the pill row, so it keeps the pill's palette —
  // it is chrome, not part of the drawer's surface.
  const pill = PILL_PALETTE[theme];
  // Controlled when `open` is provided (the overlay's pill button), else
  // self-managed — the gallery seeds `defaultOpen` since there's no launcher.
  const [openSelf, setOpenSelf] = useState(defaultOpen);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenSelf(value);
    onOpenChange?.(value);
  };
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  // "Archive" everywhere below: hide a finished task's row (and its chat tab).
  // Every route into it is disk-safe — the row's own Archive discards a
  // standing worktree first, and the other callers only fire when there is no
  // worktree left — so nothing lands in `cleared` while still owning files.
  const archiveTask = (id: string) => {
    setCleared((prev) => new Set(prev).add(id));
    onArchiveTask?.(id);
  };
  // Chat tabs the user closed. Deliberately NOT `cleared`: closing a tab is a
  // view action, like closing a browser tab — the task keeps its drawer row,
  // where its worktree (if any) is still visible and actionable. Folding the
  // two together is what used to strand worktrees: an X on a tab hid the row
  // and its Merge/Archive buttons while the files stayed on disk.
  const [closedTabs, setClosedTabs] = useState<Set<string>>(() => new Set());
  // Keyed by TASK id, not worktree slug: a follow-up message reuses one
  // worktree, so two rows can share a slug and each wants its own spinner.
  const [wtState, setWtState] = useState<Record<string, WorktreeRowState>>({});
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
  // Whether Clear's confirmation is up. Only ever set when the sweep would
  // delete a worktree (see the button's onClick).
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [, setTick] = useState(0);

  const running = tasks.filter(isRunning).sort((a, b) => a.createdAt - b.createdAt);
  const finished = tasks
    .filter((task) => !isRunning(task) && !cleared.has(task.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Re-render every second while tasks run, to tick the elapsed timers.
  useEffect(() => {
    if (running.length === 0) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [running.length]);

  const chatTask = chatTaskId ? tasks.find((task) => task.id === chatTaskId) : undefined;
  // If the chatted task disappears, fall back to the list.
  useEffect(() => {
    if (chatTaskId && !chatTask) setChatTaskId(null);
  }, [chatTaskId, chatTask]);

  // Nothing queued and nothing open → the overlay is just the pill.
  if (tasks.length === 0 && !open) return null;

  const width = chatTask ? CHAT_WIDTH : DRAWER_WIDTH;

  const openChat = (id: string) => {
    setChatTaskId(id);
    onOpenChat?.(id);
  };

  const bySlug = new Map(worktrees.map((w) => [w.slug, w]));

  const patchRow = (taskId: string, patch: Partial<WorktreeRowState>) =>
    setWtState((prev) => ({ ...prev, [taskId]: { ...IDLE_ROW, ...prev[taskId], ...patch } }));

  /** Wrap a worktree call with this row's pending/error bookkeeping. */
  const runAction = (taskId: string, fn: () => Promise<void>) => {
    patchRow(taskId, { pending: true, error: null });
    void fn()
      .catch((err: unknown) => {
        patchRow(taskId, { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        patchRow(taskId, { pending: false });
      });
  };

  /**
   * The ship/PR/discard controls for a finished row, or undefined when there's
   * no worktree to act on — a task that ran in the user's own checkout ("main"),
   * or one whose worktree has since been shipped or discarded.
   */
  const worktreeAction = (task: Task): WorktreeAction | undefined => {
    if (!onShip || !onCreatePr || !onDiscard) return undefined;
    const slug = task.worktreeSlug;
    if (slug === 'main' || !bySlug.has(slug)) return undefined;
    const row = wtState[task.id];
    return {
      available: true,
      canCreatePr: remoteAvailable,
      pending: row?.pending ?? false,
      prUrl: row?.prUrl ?? null,
      ...(row?.prLabel ? { prLabel: row.prLabel } : {}),
      note: row?.note ?? null,
      error: row?.error ?? null,
      onShip: () => runAction(task.id, () => onShip(slug)),
      // Archiving is part of the same action: the card's whole point was the
      // worktree, and a row that survives its own Discard just sits there
      // looking like the click didn't work. Only on success — a failed discard
      // leaves the row (and its error line) where the user can see it.
      onDiscard: () =>
        runAction(task.id, async () => {
          await onDiscard(slug);
          archiveTask(task.id);
        }),
      onCreatePr: () =>
        runAction(task.id, async () => {
          const res = await onCreatePr(slug);
          patchRow(task.id, {
            prUrl: res.url,
            // "View PR" only when one actually exists; a compare page is a form
            // the user still has to fill in, and saying otherwise would lie.
            prLabel: res.url ? (res.created ? 'View PR' : 'Open PR') : undefined,
            note: res.note ?? null,
            error: null,
          });
        }),
    };
  };

  // Every chat shown as a tab in the chat header (stable order, cleared hidden).
  const chatTabs = tasks
    .filter((task) => (!cleared.has(task.id) && !closedTabs.has(task.id)) || task.id === chatTaskId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((task) => ({ id: task.id, title: task.prompt, status: task.status }));

  const closeTab = (id: string) => {
    setClosedTabs((prev) => new Set(prev).add(id));
    if (id === chatTaskId) {
      const next = chatTabs.find((tb) => tb.id !== id)?.id ?? null;
      setChatTaskId(next);
      if (next) onOpenChat?.(next);
    }
  };

  /**
   * Worktrees the Finished rows still own, deduped — a follow-up message reuses
   * its parent's worktree, so several rows can name one slug and the set's size
   * is how many directories a Clear would actually delete.
   *
   * Computed on demand rather than captured when the question opens: a task can
   * finish while it is up, and both the wording and the sweep should describe
   * the list as it stands when it's answered.
   */
  const clearSlugs = () => {
    const slugs = new Set<string>();
    for (const task of finished) {
      if (onDiscard && task.worktreeSlug !== 'main' && bySlug.has(task.worktreeSlug)) {
        slugs.add(task.worktreeSlug);
      }
    }
    return slugs;
  };

  /**
   * Clear is bulk Archive, worktrees included: a row that still owns one has it
   * discarded rather than skipped, so clearing can never strand files (and a
   * branch) with no UI left pointing at them.
   */
  const clearFinished = () => {
    const slugs = clearSlugs();
    // Hidden in one pass up front, so the drawer empties on the click rather
    // than on the round-trip.
    setCleared((prev) => {
      const next = new Set(prev);
      for (const task of finished) next.add(task.id);
      return next;
    });
    for (const task of finished) {
      // Discarding a worktree makes the daemon drop its tasks and broadcast
      // that, so archiving those rows as well would be a second call for the
      // same work.
      if (!slugs.has(task.worktreeSlug)) onArchiveTask?.(task.id);
    }
    // One discard per worktree. Caught per slug: one worktree that won't
    // discard must not stop the rest from clearing.
    for (const slug of slugs) {
      void onDiscard?.(slug).catch(() => {});
    }
  };

  return (
    <>
      {/* Glyph ink lives in the class, not inline, so :hover can win. The mount
          animation pops the circle in on the pill's own expo curve, so a task
          arriving reads as one gesture rather than a button blinking into
          existence. */}
      <style>{taskPanelCss(theme)}</style>
      {showLauncher && tasks.length > 0 ? (
        <button
          type="button"
          className="la-tp-launcher la-tp-launcher-in"
          onClick={() => setOpen((o) => !o)}
          style={{ ...buttonStyle(theme), ...launcherStyle }}
          title="Background tasks"
        >
          <BackgroundTasksIcon />
          {running.length > 0 ? <span style={countStyle()}>{running.length}</span> : null}
        </button>
      ) : null}
      {open ? (
        <div style={{ ...panelStyle(theme), ...anchorStyle, width: `${width}px` }}>
          {chatTask ? (
            <TaskChat
              task={chatTask}
              tabs={chatTabs}
              entries={transcripts?.[chatTask.id] ?? []}
              logsFallback={logs[chatTask.id] ?? []}
              theme={theme}
              busy={isRunning(chatTask)}
              onBack={() => setChatTaskId(null)}
              onSelectTab={openChat}
              onCloseTab={closeTab}
              onSend={(text, opts) => onSendMessage?.(chatTask.id, text, opts)}
              {...(isRunning(chatTask) ? { onCancel: () => onCancel(chatTask.id) } : {})}
            />
          ) : (
            <>
              <div style={panelHeader()}>
                <span style={{ fontWeight: 500, fontSize: '12px', color: p.soft }}>
                  Background Tasks
                </span>
                <button
                  type="button"
                  className="la-tp-soft"
                  onClick={() => setOpen(false)}
                  style={iconBtn()}
                  aria-label="Close"
                >
                  <CloseThinIcon />
                </button>
              </div>

              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: `4px ${SURFACE_PAD}px ${SURFACE_PAD}px`,
                }}
              >
                {running.length > 0 ? (
                  <>
                    <div style={sectionHeader(theme)}>
                      <span>Running</span>
                    </div>
                    {running.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        theme={theme}
                        onOpenChat={() => openChat(task.id)}
                        onCancel={() => onCancel(task.id)}
                      />
                    ))}
                  </>
                ) : null}

                {finished.length > 0 ? (
                  <>
                    <div
                      style={{
                        ...sectionHeader(theme),
                        marginTop: running.length > 0 ? '14px' : '4px',
                      }}
                    >
                      <span>Finished</span>
                      <button
                        type="button"
                        className="la-tp-soft"
                        style={clearBtn()}
                        onClick={() => {
                          // With no worktree among the finished rows there is
                          // nothing on disk to lose — clearing is just hiding
                          // cards, and hiding cards doesn't earn a question.
                          if (clearSlugs().size === 0) clearFinished();
                          else setConfirmingClear(true);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    {finished.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        theme={theme}
                        onOpenChat={() => openChat(task.id)}
                        {...(onRetry
                          ? {
                              // The fresh task replaces this row rather than
                              // joining it — two cards with the same prompt read
                              // as a duplicate, not a second attempt. Archive
                              // only once the retry actually enqueued.
                              onRetry: () => {
                                void Promise.resolve(onRetry(task.id)).then(
                                  () => archiveTask(task.id),
                                  () => {},
                                );
                              },
                            }
                          : {})}
                        {...(() => {
                          const wt = worktreeAction(task);
                          return wt ? { worktree: wt } : {};
                        })()}
                        onArchive={() => archiveTask(task.id)}
                      />
                    ))}
                  </>
                ) : null}

                {running.length === 0 && finished.length === 0 ? (
                  <div style={{ color: p.faint, fontSize: '12px', padding: '12px 0' }}>
                    No tasks yet.
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {/* Outside the panel, deliberately: the drawer's backdrop-filter makes it
          the containing block for fixed-position descendants, so its `overflow:
          hidden` would slice a dialog nested inside it however it is
          positioned. */}
      {confirmingClear ? (
        <ConfirmDialog
          theme={theme}
          title="Clear finished tasks?"
          body={clearWarning(finished.length, clearSlugs().size)}
          confirmLabel="Clear"
          onConfirm={() => {
            setConfirmingClear(false);
            clearFinished();
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Clear's question, in numbers. A generic "this cannot be undone" is skimmed
 * past; the count of worktrees about to be deleted is the part that makes
 * someone stop, so the sentence names it rather than the danger.
 *
 * `worktrees` is the deduped slug count, not a count of rows — several tasks
 * can share one worktree, and it is directories that get deleted.
 */
function clearWarning(tasks: number, worktrees: number): string {
  const one = worktrees === 1;
  return [
    `Clears ${tasks} finished ${tasks === 1 ? 'task' : 'tasks'} and deletes`,
    `${one ? 'the worktree' : `the ${worktrees} worktrees`} ${tasks === 1 ? 'it still owns' : 'they still own'},`,
    `along with ${one ? 'its branch' : 'their branches'}.`,
    `Unmerged work in ${one ? 'it' : 'them'} is lost.`,
  ].join(' ');
}
