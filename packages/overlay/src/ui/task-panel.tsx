/** @jsxImportSource preact */
import type {
  PullRequestResult,
  ReasoningEffort,
  Task,
  TranscriptEntry,
  Worktree,
} from '@iris/shared';
import { useEffect, useState } from 'preact/hooks';
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
  // Keyed by TASK id, not worktree slug: a follow-up message reuses one
  // worktree, so two rows can share a slug and each wants its own spinner.
  const [wtState, setWtState] = useState<Record<string, WorktreeRowState>>({});
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
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
      onDiscard: () => runAction(task.id, () => onDiscard(slug)),
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
    .filter((task) => !cleared.has(task.id) || task.id === chatTaskId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((task) => ({ id: task.id, title: task.prompt, status: task.status }));

  const closeTab = (id: string) => {
    setCleared((prev) => new Set(prev).add(id));
    if (id === chatTaskId) {
      const next = chatTabs.find((tb) => tb.id !== id)?.id ?? null;
      setChatTaskId(next);
      if (next) onOpenChat?.(next);
    }
  };

  return (
    <>
      {/* Glyph ink lives in the class, not inline, so :hover can win. The mount
          animation pops the circle in on the pill's own expo curve, so a task
          arriving reads as one gesture rather than a button blinking into
          existence. */}
      <style>
        {[
          '.la-tp-dim{opacity:0.5;transition:opacity 80ms}.la-tp-dim:hover{opacity:1}',
          `.la-tp-soft{color:${p.soft};transition:color 80ms}.la-tp-soft:hover{color:${p.ink}}`,
          `.la-tp-launcher{color:${pill.icon};background:${pill.surface};transition:background 90ms,box-shadow 90ms}`,
          `.la-tp-launcher:hover{background:${pill.hover};box-shadow:0 0 0 2px ${pill.hover}}`,
          '.la-tp-launcher-in{animation:la-tasks-in 360ms cubic-bezier(0.19,1,0.22,1) both}',
          '@keyframes la-tasks-in{from{opacity:0;transform:scale(0.4)}to{opacity:1;transform:scale(1)}}',
        ].join('')}
      </style>
      {tasks.length > 0 ? (
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
                  onClick={() => setOpen(false)}
                  style={iconBtn(theme)}
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
                        hasTranscript={
                          (logs[task.id]?.length ?? 0) > 0 ||
                          (transcripts?.[task.id]?.length ?? 0) > 0
                        }
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
                        style={clearBtn()}
                        onClick={() => setCleared(new Set(tasks.map((task) => task.id)))}
                      >
                        Clear
                      </button>
                    </div>
                    {finished.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        theme={theme}
                        hasTranscript={
                          (logs[task.id]?.length ?? 0) > 0 ||
                          (transcripts?.[task.id]?.length ?? 0) > 0
                        }
                        onOpenChat={() => openChat(task.id)}
                        {...(onRetry ? { onRetry: () => onRetry(task.id) } : {})}
                        {...(() => {
                          const wt = worktreeAction(task);
                          return wt ? { worktree: wt } : {};
                        })()}
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
    </>
  );
}
