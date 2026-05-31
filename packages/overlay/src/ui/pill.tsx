import type { ConnectionStatus } from '../transport';

type PillProps = {
  active: boolean;
  connection: ConnectionStatus;
  onToggle: () => void;
};

export function Pill({ active, connection, onToggle }: PillProps) {
  const dotColor =
    connection === 'connected' ? '#22c55e' : connection === 'connecting' ? '#eab308' : '#ef4444';
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        padding: '7px 13px',
        background: active ? '#3b82f6' : 'rgba(20, 20, 20, 0.9)',
        color: 'white',
        fontSize: '12px',
        fontWeight: 500,
        letterSpacing: '0.01em',
        borderRadius: '999px',
        border: 'none',
        boxShadow: '0 2px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
        transition: 'background 100ms ease',
        pointerEvents: 'auto',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        fontFamily: 'inherit',
      }}
      title={active ? 'Click an element, or click here to cancel' : 'Click to select an element (or hold ⌥ and hover)'}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '999px',
          background: dotColor,
        }}
      />
      {active ? 'click an element' : 'localagents'}
    </button>
  );
}
