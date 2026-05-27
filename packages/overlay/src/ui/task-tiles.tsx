import type { Task, TaskStatus } from '@localagents/shared';

type TaskTilesProps = {
  tasks: Task[];
  onCancel: (id: string) => void;
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  queued: '#71717a',
  running: '#3b82f6',
  editing: '#8b5cf6',
  done: '#22c55e',
  failed: '#ef4444',
  cancelled: '#71717a',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'queued',
  running: 'running',
  editing: 'editing',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

const PILL_OFFSET_FROM_BOTTOM = 60; // leave room for the floating pill

/**
 * Compact stack of task tiles in the bottom-right corner. Each tile shows
 * status, prompt preview, and (for running tasks) a cancel button.
 *
 * Auto-prunes done/failed tasks after a few seconds.
 */
export function TaskTiles({ tasks, onCancel }: TaskTilesProps) {
  // Visible: still-running OR finished within the last 8s.
  const now = Date.now();
  const visible = tasks
    .filter((t) => t.status !== 'cancelled')
    .filter((t) => isLive(t) || now - t.updatedAt < 8000)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: '16px',
        bottom: `${PILL_OFFSET_FROM_BOTTOM}px`,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: '6px',
        pointerEvents: 'auto',
        maxWidth: '320px',
      }}
    >
      {visible.map((t) => (
        <Tile key={t.id} task={t} onCancel={onCancel} />
      ))}
    </div>
  );
}

function isLive(t: Task): boolean {
  return t.status === 'queued' || t.status === 'running' || t.status === 'editing';
}

type TileProps = {
  task: Task;
  onCancel: (id: string) => void;
};

function Tile({ task, onCancel }: TileProps) {
  const color = STATUS_COLOR[task.status];
  return (
    <div
      style={{
        background: 'rgba(20, 20, 23, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderLeft: `3px solid ${color}`,
        borderRadius: '8px',
        padding: '10px 12px',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(8px)',
        fontSize: '11px',
        color: '#e4e4e7',
        lineHeight: 1.4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '999px',
              background: color,
              animation: isLive(task) ? 'localagents-pulse 1.4s ease-in-out infinite' : 'none',
            }}
          />
          <span style={{ color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '9px' }}>
            {STATUS_LABEL[task.status]} · {task.backend}
          </span>
        </span>
        {isLive(task) ? (
          <button
            type="button"
            onClick={() => onCancel(task.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#71717a',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '0 2px',
            }}
            title="Cancel"
          >
            ×
          </button>
        ) : null}
      </div>
      <div
        style={{
          color: '#f4f4f5',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={task.prompt}
      >
        {task.prompt}
      </div>
      {task.message ? (
        <div
          style={{
            color: '#a1a1aa',
            fontSize: '10px',
            marginTop: '4px',
            fontFamily: 'ui-monospace, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={task.message}
        >
          {task.message}
        </div>
      ) : null}
    </div>
  );
}
