/** @jsxImportSource preact */

type PillProps = {
  /** Persistent armed state — drives circle (off) vs. toolbar (on). */
  active: boolean;
  onArm: () => void;
  onDisarm: () => void;
};

// #373734 at 10% opacity — used for the pill outline and the active divider.
const STROKE = 'rgba(55, 55, 52, 0.1)';
const ICON = '#373734';

const baseSurface = {
  position: 'fixed' as const,
  bottom: '16px',
  right: '16px',
  background: '#ffffff',
  border: `1px solid ${STROKE}`,
  boxShadow: '0 2px 16px rgba(0, 0, 0, 0.12)',
  pointerEvents: 'auto' as const,
  userSelect: 'none' as const,
  color: ICON,
};

export function Pill({ active, onArm, onDisarm }: PillProps) {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onArm}
        aria-label="localagents"
        style={{
          ...baseSurface,
          width: '40px',
          height: '40px',
          padding: 0,
          borderRadius: '999px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <StarIcon />
      </button>
    );
  }

  return (
    <div
      style={{
        ...baseSurface,
        padding: '8px 10px',
        borderRadius: '999px',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <button type="button" aria-label="chat" onClick={onArm} style={iconButton}>
        <ChatIcon />
      </button>
      <button
        type="button"
        aria-label="settings"
        onClick={() => {}}
        style={{ ...iconButton, marginLeft: '6px' }}
      >
        <SettingsIcon />
      </button>
      <span
        style={{
          width: '1px',
          alignSelf: 'stretch',
          background: STROKE,
          marginLeft: '8px',
        }}
      />
      <button
        type="button"
        aria-label="close"
        onClick={onDisarm}
        style={{ ...iconButton, marginLeft: '8px' }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

const iconButton = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: ICON,
  cursor: 'pointer',
};

const ICON_SIZE = 18;

function StarIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5l2.6 5.85 6.4.56-4.84 4.23 1.45 6.26L12 16.1l-5.61 3.3 1.45-6.26L3 8.91l6.4-.56L12 2.5z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
