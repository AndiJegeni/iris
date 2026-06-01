/** @jsxImportSource preact */
import type { Task } from '@localagents/shared';
import { useEffect, useState } from 'preact/hooks';

type TaskPanelProps = {
  tasks: Task[];
  logs: Record<string, string[]>;
  onCancel: (id: string) => void;
};

const DRAWER_WIDTH = 400;
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

function statusLine(t: Task): string {
  switch (t.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return `Running ${t.backend}`;
    case 'editing':
      return t.message ?? `Editing · ${t.backend}`;
    case 'done':
      return `${capitalize(t.backend)} · completed`;
    case 'failed':
      return `${capitalize(t.backend)} · failed`;
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
 * section with Clear. Light theme to match the message box.
 */
export function TaskPanel({ tasks, logs, onCancel }: TaskPanelProps) {
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearHover, setClearHover] = useState(false);
  const [, setTick] = useState(0);

  const running = tasks.filter(isRunning).sort((a, b) => a.createdAt - b.createdAt);
  const finished = tasks
    .filter((t) => !isRunning(t) && !cleared.has(t.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Re-render every second while tasks run, to tick the elapsed timers.
  useEffect(() => {
    if (running.length === 0) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [running.length]);

  if (tasks.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...buttonStyle,
          right: open ? `${DRAWER_WIDTH + DRAWER_MARGIN + 10}px` : '14px',
          background: open ? '#e0e7ff' : '#eef2ff',
        }}
        title="Background tasks"
      >
        <DoubleChevron />
        {running.length > 0 ? <span style={countStyle}>{running.length}</span> : null}
      </button>

      {open ? (
        <div style={panelStyle}>
          <div style={panelHeader}>
            <span style={{ fontWeight: 500, fontSize: '13px', opacity: 0.7 }}>Background Tasks</span>
            <button type="button" onClick={() => setOpen(false)} style={iconBtn} aria-label="Close">
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
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
                <div style={sectionHeader}>
                  <span>Running</span>
                </div>
                {running.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    logs={logs[t.id] ?? []}
                    expanded={expandedId === t.id}
                    onToggle={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                    onCancel={() => onCancel(t.id)}
                  />
                ))}
              </>
            ) : null}

            {finished.length > 0 ? (
              <>
                <div style={{ ...sectionHeader, marginTop: running.length > 0 ? '14px' : '4px' }}>
                  <span>Finished</span>
                  <button
                    type="button"
                    style={{ ...clearBtn, ...(clearHover ? { color: '#373734', opacity: 1 } : {}) }}
                    onMouseEnter={() => setClearHover(true)}
                    onMouseLeave={() => setClearHover(false)}
                    onClick={() => setCleared(new Set(tasks.map((t) => t.id)))}
                  >
                    Clear
                  </button>
                </div>
                {finished.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    logs={logs[t.id] ?? []}
                    expanded={expandedId === t.id}
                    onToggle={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                  />
                ))}
              </>
            ) : null}

            {running.length === 0 && finished.length === 0 ? (
              <div style={{ color: '#a1a1aa', fontSize: '13px', padding: '12px 0' }}>
                No tasks yet.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

type TaskRowProps = {
  task: Task;
  logs: string[];
  expanded: boolean;
  onToggle: () => void;
  onCancel?: () => void;
};

function TaskRow({ task, logs, expanded, onToggle, onCancel }: TaskRowProps) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
        {task.status === 'failed' ? (
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: DOT_COLOR.failed,
              marginTop: '5px',
              flexShrink: 0,
            }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: '14px', color: '#18181b' }}>{task.prompt}</div>
          <div style={{ color: '#71717a', fontSize: '12px', marginTop: '2px' }}>
            {statusLine(task)} <span style={{ color: '#a1a1aa' }}>· {elapsed(task)}</span>
          </div>
          {logs.length > 0 ? (
            <button type="button" style={transcriptLink} onClick={onToggle}>
              {expanded ? 'Hide transcript' : 'View transcript'}
            </button>
          ) : null}
          {expanded && logs.length > 0 ? <pre style={transcriptBox}>{logs.join('\n')}</pre> : null}
        </div>
        {onCancel ? (
          <button type="button" style={stopBtn} onClick={onCancel}>
            Stop
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DoubleChevron() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" style={{ display: 'block' }} aria-hidden="true">
      <g stroke="#2563eb" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5 L8 10 L3 15" />
        <path d="M10 5 L15 10 L10 15" />
      </g>
    </svg>
  );
}

const buttonStyle = {
  position: 'fixed' as const,
  top: '14px',
  right: '14px',
  height: '34px',
  minWidth: '34px',
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '7px',
  background: '#eef2ff',
  border: '1px solid rgba(37, 99, 235, 0.18)',
  borderRadius: '999px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  pointerEvents: 'auto' as const,
};

const countStyle = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#1d4ed8',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
};

const panelStyle = {
  position: 'fixed' as const,
  top: `${DRAWER_MARGIN}px`,
  right: `${DRAWER_MARGIN}px`,
  bottom: `${DRAWER_MARGIN}px`,
  width: `${DRAWER_WIDTH}px`,
  background: '#ffffff',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: '6px',
  boxShadow: '0 16px 48px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1)',
  pointerEvents: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  color: '#18181b',
  fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  overflow: 'hidden',
};

const panelHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #f4f4f5',
};

const sectionHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  color: '#71717a',
  fontSize: '13px',
  fontWeight: 500,
  padding: '8px 2px 6px',
};

const cardStyle = {
  background: 'rgba(244, 244, 245, 0.7)',
  borderRadius: '6px',
  padding: '11px 12px',
  marginBottom: '7px',
};

const stopBtn = {
  background: '#ffffff',
  border: '1px solid #e4e4e7',
  borderRadius: '7px',
  padding: '4px 11px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#3f3f46',
  cursor: 'pointer',
  flexShrink: 0,
  fontFamily: 'inherit',
};

const clearBtn = {
  background: 'transparent',
  border: 'none',
  color: '#71717a',
  fontSize: '13px',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
};

const transcriptLink = {
  background: 'transparent',
  border: 'none',
  color: '#2563eb',
  fontSize: '12px',
  cursor: 'pointer',
  padding: 0,
  marginTop: '4px',
  display: 'block',
  fontFamily: 'inherit',
};

const transcriptBox = {
  marginTop: '7px',
  padding: '8px',
  background: '#18181b',
  color: '#e4e4e7',
  borderRadius: '7px',
  fontSize: '11px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineHeight: 1.5,
  maxHeight: '160px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

const iconBtn = {
  background: 'transparent',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  padding: '2px',
  display: 'inline-flex',
};
