/** @jsxImportSource preact */
import { modelLabel, type Task, type TranscriptEntry } from '@localagents/shared';
import { useEffect, useState } from 'preact/hooks';
import { TaskChat } from './task-chat';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

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
};

const DRAWER_WIDTH = 400;
const CHAT_WIDTH = 460;
const DRAWER_MARGIN = 8;

function isRunning(t: Task): boolean {
  return t.status === 'queued' || t.status === 'running' || t.status === 'editing';
}

function elapsed(t: Task): string {
  const end = isRunning(t) ? Date.now() : t.updatedAt;
  const secs = Math.max(0, Math.round((end - t.createdAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

/** Model display name for a task — the model's label, else the backend name. */
function modelName(t: Task): string {
  return t.model?.trim() ? modelLabel(t.model) : capitalize(t.backend);
}

function statusLine(t: Task): string {
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DOT_COLOR: Record<Task['status'], string> = {
  queued: '#a1a1aa',
  running: '#3b82f6',
  editing: '#8b5cf6',
  done: '#16a34a',
  failed: '#dc2626',
  cancelled: '#a1a1aa',
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
}: TaskPanelProps) {
  const t = tokens(theme);
  const [open, setOpen] = useState(false);
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

  if (tasks.length === 0) return null;

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
      <style>
        {'.la-tp-dim{opacity:0.5;transition:opacity 80ms}.la-tp-dim:hover{opacity:1}'}
      </style>
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
        <div style={{ ...panelStyle(t), width: `${width}px` }}>
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
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M4 4 L12 12 M12 4 L4 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
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

type TaskRowProps = {
  task: Task;
  t: ThemeTokens;
  hasTranscript: boolean;
  onOpenChat: () => void;
  onCancel?: () => void;
};

function TaskRow({ task, t, hasTranscript, onOpenChat, onCancel }: TaskRowProps) {
  return (
    <div style={cardStyle(t)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
        {/* Only the failed state shows a status dot. */}
        {task.status === 'failed' ? (
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
          {hasTranscript ? (
            <button type="button" style={viewChatLink(t)} onClick={onOpenChat}>
              View chat
            </button>
          ) : null}
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

// Two overlapping circles — from assets/icons/background.svg.
function BackgroundTasksIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" style={{ display: 'block' }} aria-hidden="true">
      {/* kebab-case attrs — Preact doesn't map camelCase SVG props, so strokeWidth
          was being dropped. 1.8 in a 24 viewBox ≈ the modal icons' visual weight. */}
      <g stroke={color} stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.6749 16.2962C15.0082 13.9629 15.0082 10.1797 12.6749 7.84634C10.3415 5.51296 6.55833 5.51296 4.22495 7.84634C1.89157 10.1797 1.89157 13.9629 4.22495 16.2962C6.55833 18.6296 10.3415 18.6296 12.6749 16.2962Z" />
        <path d="M19.9176 16.2962C22.251 13.9629 22.251 10.1797 19.9176 7.84634C17.5843 5.51296 13.8011 5.51296 11.4677 7.84634C9.13435 10.1797 9.13435 13.9629 11.4677 16.2962C13.8011 18.6296 17.5843 18.6296 19.9176 16.2962Z" />
      </g>
    </svg>
  );
}

const buttonStyle = (t: ThemeTokens) => ({
  position: 'fixed' as const,
  top: '14px',
  right: '14px',
  height: '34px',
  minWidth: '34px',
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  background: t.controlBg,
  border: `1px solid ${t.controlBorder}`,
  borderRadius: '999px',
  cursor: 'pointer',
  boxShadow: t.pillShadow,
  pointerEvents: 'auto' as const,
});

const countStyle = {
  fontSize: '13px',
  fontWeight: 600,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '-0.02em',
};

const panelStyle = (t: ThemeTokens) => ({
  position: 'fixed' as const,
  top: `${DRAWER_MARGIN}px`,
  right: `${DRAWER_MARGIN}px`,
  bottom: `${DRAWER_MARGIN}px`,
  background: t.surfaceBg,
  border: `1px solid ${t.surfaceBorder}`,
  borderRadius: '16px',
  boxShadow: t.surfaceShadow,
  pointerEvents: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  color: t.textPrimary,
  fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: '12px',
  letterSpacing: '-0.02em',
  overflow: 'hidden',
});

const panelHeader = (_t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  // Left padding matches the section labels (container 16 + sectionHeader 6).
  padding: '16px 16px 10px 22px',
});

// Matches the "Background Tasks" header (medium weight, 50% ink). Labels are
// nudged 4px right / Clear 4px left via the padding.
const sectionHeader = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  color: t.textPrimary,
  opacity: 0.5,
  fontSize: '12px',
  fontWeight: 500,
  padding: '8px 6px 6px',
});

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

const clearBtn = (_t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  // Inherits the section header's 50%-ink color.
  color: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
  padding: 0,
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

const iconBtn = (t: ThemeTokens) => ({
  background: 'transparent',
  border: 'none',
  color: t.textFaint,
  cursor: 'pointer',
  padding: '2px',
  display: 'inline-flex',
});
