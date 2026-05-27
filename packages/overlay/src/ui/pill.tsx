import type { ConnectionStatus } from '../transport';

type PillProps = {
  active: boolean;
  connection: ConnectionStatus;
};

export function Pill({ active, connection }: PillProps) {
  const dotColor =
    connection === 'connected' ? '#22c55e' : connection === 'connecting' ? '#eab308' : '#ef4444';
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        padding: '6px 12px',
        background: active ? '#3b82f6' : 'rgba(20, 20, 20, 0.88)',
        color: 'white',
        fontSize: '12px',
        fontWeight: 500,
        letterSpacing: '0.01em',
        borderRadius: '999px',
        boxShadow: '0 2px 16px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
        transition: 'background 100ms ease',
        pointerEvents: 'none',
        userSelect: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '999px',
          background: dotColor,
        }}
        title={`daemon ${connection}`}
      />
      {active ? '⌥ select an element' : '⌥ localagents'}
    </div>
  );
}
