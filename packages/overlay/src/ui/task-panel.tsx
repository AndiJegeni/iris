/** @jsxImportSource preact */
import type { Task, TranscriptEntry } from '@localagents/shared';
import { useEffect, useState } from 'preact/hooks';
import { BackgroundTasksIcon, CloseThinIcon } from './icons';
import { TaskChat } from './task-chat';
import {
  CHAT_WIDTH,
  DRAWER_MARGIN,
  DRAWER_WIDTH,
  buttonStyle,
  clearBtn,
  countStyle,
  iconBtn,
  panelHeader,
  panelStyle,
  sectionHeader,
} from './task-panel.styles';
import { TaskRow, isRunning } from './task-row';
import { type OverlayTheme, tokens } from './theme';

type TaskPanelProps = {
  tasks: Task[];
  logs: Record<string, string[]>;
  /** Structured per-task transcripts for the chat view (optional). */
  transcripts?: Record<string, TranscriptEntry[]>;
  theme?: OverlayTheme;
  onCancel: (id: string) => void;
  /** Send a follow-up message to a task (resumes its session). */
  onSendMessage?: (id: string, text: string) => void | Promise<void>;
  /** Called when a task's chat is opened (e.g. to load its full transcript). */
  onOpenChat?: (id: string) => void;
  /** Re-run a failed task (re-submits its original prompt as a fresh task). */
  onRetry?: (id: string) => void | Promise<void>;
  /** Controlled open state (e.g. driven by the pill's chat button). Optional. */
  open?: boolean;
  /** Fired when the panel wants to open/close — pairs with `open` for control. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Top-right "Background tasks" button (icon + running count) that opens a
 * Conductor-style panel: Running section with Stop + transcript, Finished
 * section with Clear. Clicking a task's "View transcript" swaps the panel into
 * a full chat view (see TaskChat). Theme-aware (dark/light).
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
  open: openProp,
  onOpenChange,
}: TaskPanelProps) {
  const t = tokens(theme);
  // Controlled when `open` is provided (pill chat button), else self-managed.
  const [openSelf, setOpenSelf] = useState(false);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setOpenSelf(value);
    onOpenChange?.(value);
  };
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
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

  // With no tasks the floating launcher button is pointless — but when the pill
  // drives us open (controlled), still render so the panel (empty state) shows.
  if (tasks.length === 0 && !open) return null;

  const width = chatTask ? CHAT_WIDTH : DRAWER_WIDTH;

  const openChat = (id: string) => {
    setChatTaskId(id);
    onOpenChat?.(id);
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
      <style>{'.la-tp-dim{opacity:0.5;transition:opacity 80ms}.la-tp-dim:hover{opacity:1}'}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...buttonStyle(t),
          // In light mode, match the message-box modal: white fill, hairline ink border.
          ...(theme === 'light'
            ? { background: '#ffffff', border: '1px solid rgba(55, 55, 52, 0.1)' }
            : null),
          right: open ? `${width + DRAWER_MARGIN + 10}px` : '14px',
        }}
        title="Background tasks"
      >
        <BackgroundTasksIcon color={t.accent} />
        {running.length > 0 ? (
          <span style={{ ...countStyle, color: t.accent }}>{running.length}</span>
        ) : null}
      </button>

      {open ? (
        <div style={{ ...panelStyle(t, theme), width: `${width}px` }}>
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
              onSend={(text) => onSendMessage?.(chatTask.id, text)}
              {...(isRunning(chatTask) ? { onCancel: () => onCancel(chatTask.id) } : {})}
            />
          ) : (
            <>
              <div style={panelHeader(t)}>
                <span style={{ fontWeight: 500, fontSize: '12px', opacity: 0.5 }}>
                  Background Tasks
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={iconBtn(t)}
                  aria-label="Close"
                >
                  <CloseThinIcon />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px' }}>
                {running.length > 0 ? (
                  <>
                    <div style={sectionHeader(t)}>
                      <span>Running</span>
                    </div>
                    {running.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        t={t}
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
                        ...sectionHeader(t),
                        marginTop: running.length > 0 ? '14px' : '4px',
                      }}
                    >
                      <span>Finished</span>
                      <button
                        type="button"
                        style={clearBtn(t)}
                        onClick={() => setCleared(new Set(tasks.map((task) => task.id)))}
                      >
                        Clear
                      </button>
                    </div>
                    {finished.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        t={t}
                        hasTranscript={
                          (logs[task.id]?.length ?? 0) > 0 ||
                          (transcripts?.[task.id]?.length ?? 0) > 0
                        }
                        onOpenChat={() => openChat(task.id)}
                        {...(onRetry ? { onRetry: () => onRetry(task.id) } : {})}
                      />
                    ))}
                  </>
                ) : null}

                {running.length === 0 && finished.length === 0 ? (
                  <div style={{ color: t.textFaint, fontSize: '12px', padding: '12px 0' }}>
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
