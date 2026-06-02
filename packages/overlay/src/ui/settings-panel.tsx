/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

type SettingsPanelProps = {
  theme?: OverlayTheme;
  onClose: () => void;
  /** Flip the overlay between light and dark. */
  onToggleTheme?: () => void;
  /** Whether the overlay blocks clicks/scrolls on the host page. */
  blockInteractions?: boolean;
  onToggleBlockInteractions?: (next: boolean) => void;
  /** Stored keys by provider, e.g. { anthropic, openai }. UI shell only. */
  apiKeys?: Record<string, string>;
  /** Surface a saved key to the host — no real storage happens here. */
  onSaveKey?: (provider: string, value: string) => void;
};

const VERSION = 'v0.1';

const PANEL_WIDTH = 320;

/** Providers shown in the "Manage API keys" sub-view, in display order. */
const PROVIDERS: { id: string; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…' },
];

/**
 * Floating Settings modal opened from the active Pill's gear button. Anchored
 * bottom-right above the pill, theme-aware (dark/light) like the TaskPanel.
 * Two views toggled by internal state (mirrors TaskPanel's list⇄chat pattern):
 * the settings list, and a "Manage API keys" sub-view.
 */
export function SettingsPanel({
  theme = 'dark',
  onClose,
  onToggleTheme,
  blockInteractions = false,
  onToggleBlockInteractions,
  apiKeys,
  onSaveKey,
}: SettingsPanelProps) {
  const t = tokens(theme);
  const [view, setView] = useState<'settings' | 'keys'>('settings');

  return (
    <div style={panelStyle(t)}>
      <style>
        {'.la-sp-row{background:transparent;transition:background 80ms}' +
          '.la-sp-row:hover{background:rgba(55,55,52,0.06)}' +
          '.la-sp-icon{opacity:0.6;transition:opacity 80ms}' +
          '.la-sp-icon:hover{opacity:1}'}
      </style>

      {view === 'settings' ? (
        <SettingsView
          t={t}
          theme={theme}
          onClose={onClose}
          onToggleTheme={onToggleTheme}
          blockInteractions={blockInteractions}
          onToggleBlockInteractions={onToggleBlockInteractions}
          onOpenKeys={() => setView('keys')}
        />
      ) : (
        <KeysView
          t={t}
          apiKeys={apiKeys}
          onSaveKey={onSaveKey}
          onBack={() => setView('settings')}
        />
      )}
    </div>
  );
}

function SettingsView({
  t,
  theme,
  onClose,
  onToggleTheme,
  blockInteractions,
  onToggleBlockInteractions,
  onOpenKeys,
}: {
  t: ThemeTokens;
  theme: OverlayTheme;
  onClose: () => void;
  onToggleTheme: (() => void) | undefined;
  blockInteractions: boolean;
  onToggleBlockInteractions: ((next: boolean) => void) | undefined;
  onOpenKeys: () => void;
}) {
  return (
    <>
      <div style={panelHeader(t)}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontWeight: 500, fontSize: '13px', color: t.textPrimary }}>
            localagents
          </span>
          <span style={{ fontSize: '11px', color: t.textFaint }}>{VERSION}</span>
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <button
            type="button"
            className="la-sp-icon"
            style={iconBtn(t)}
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            className="la-sp-icon"
            style={iconBtn(t)}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div style={{ padding: '4px 10px 12px' }}>
        <button
          type="button"
          className="la-sp-row"
          style={rowStyle(t)}
          onClick={() => onToggleBlockInteractions?.(!blockInteractions)}
        >
          <span style={{ fontSize: '12px', color: t.textPrimary }}>Block page interactions</span>
          <Checkbox checked={blockInteractions} t={t} />
        </button>

        <div style={dividerStyle(t)} />

        <button
          type="button"
          className="la-sp-row"
          style={rowStyle(t)}
          onClick={onOpenKeys}
        >
          <span style={{ fontSize: '12px', color: t.textPrimary }}>Manage API keys</span>
          <span style={{ display: 'inline-flex', color: t.textFaint }}>
            <ChevronRight />
          </span>
        </button>
      </div>
    </>
  );
}

function KeysView({
  t,
  apiKeys,
  onSaveKey,
  onBack,
}: {
  t: ThemeTokens;
  apiKeys: Record<string, string> | undefined;
  onSaveKey: ((provider: string, value: string) => void) | undefined;
  onBack: () => void;
}) {
  // Seed local drafts from the passed-in keys; edits stay local until Save.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...(apiKeys ?? {}) }));

  return (
    <>
      <div style={panelHeader(t)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className="la-sp-icon"
            style={iconBtn(t)}
            onClick={onBack}
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
          <span style={{ fontWeight: 500, fontSize: '13px', color: t.textPrimary }}>API Keys</span>
        </span>
      </div>

      <div style={{ padding: '4px 16px 14px' }}>
        {PROVIDERS.map((p) => {
          const value = drafts[p.id] ?? '';
          const dirty = value !== (apiKeys?.[p.id] ?? '');
          return (
            <div key={p.id} style={{ marginBottom: '12px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: t.textPrimary,
                  marginBottom: '5px',
                }}
              >
                {p.label}
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="password"
                  value={value}
                  placeholder={p.placeholder}
                  onInput={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: (e.target as HTMLInputElement).value }))
                  }
                  // biome-ignore lint/suspicious/noExplicitAny: CSS custom property for ::placeholder color
                  style={{ ...inputStyle(t), '--la-ph': t.textFaint } as any}
                  className="la-sp-field"
                />
                <button
                  type="button"
                  style={{ ...saveBtn(t), opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'default' }}
                  disabled={!dirty}
                  onClick={() => onSaveKey?.(p.id, value)}
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}

        <style>
          {'.la-sp-field::placeholder{color:var(--la-ph);opacity:1}'}
        </style>

        <p style={{ fontSize: '11px', color: t.textFaint, lineHeight: 1.5, margin: '4px 0 0' }}>
          Keys are stored locally on this device and never leave it.
        </p>
      </div>
    </>
  );
}

function Checkbox({ checked, t }: { checked: boolean; t: ThemeTokens }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        borderRadius: '4px',
        flexShrink: 0,
        border: checked ? `1px solid ${t.accent}` : `1px solid ${t.controlBorder}`,
        background: checked ? t.accent : 'transparent',
        color: t.accentText,
      }}
    >
      {checked ? <CheckIcon /> : null}
    </span>
  );
}

/**
 * Icons inlined as small functions (stroke = currentColor) — same bundler-agnostic
 * convention as pill.tsx / picked-popover.tsx. kebab-case SVG attrs, since Preact
 * drops camelCase SVG props.
 */
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.3335V2.66683M8 13.3335V14.6668M2.66667 8.00016H1.33333M4.22876 4.22892L3.28595 3.28612M11.7712 4.22892L12.714 3.28612M4.22876 11.7721L3.28595 12.7149M11.7712 11.7721L12.714 12.7149M14.6667 8.00016H13.3333M11.3333 8.00016C11.3333 9.84111 9.84095 11.3335 8 11.3335C6.15905 11.3335 4.66667 9.84111 4.66667 8.00016C4.66667 6.15921 6.15905 4.66683 8 4.66683C9.84095 4.66683 11.3333 6.15921 11.3333 8.00016Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M14 8.52732C13.8959 9.65327 13.4727 10.7261 12.7793 11.6195C12.0858 12.5129 11.1517 13.1888 10.0866 13.5688C9.02147 13.9488 7.86987 14.0172 6.76709 13.766C5.66431 13.5147 4.65649 12.9544 3.86225 12.1502C3.06801 11.3459 2.51974 10.3315 2.28133 9.22636C2.04293 8.12122 2.12431 6.97095 2.51593 5.91029C2.90755 4.84962 3.59302 3.92295 4.49321 3.23938C5.3934 2.5558 6.47165 2.14431 7.6 2.0533C6.94946 2.93351 6.63647 4.01851 6.71765 5.11055C6.79883 6.20259 7.26886 7.22941 8.04269 8.0033C8.81652 8.77719 9.84334 9.24729 10.9354 9.32847C12.0274 9.40965 13.1124 9.09666 13.9926 8.44612L14 8.52732Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12 4L4 12M4 4L12 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 4L6 8L10 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M8.33366 2.5L3.75033 7.08333L1.66699 5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

const panelStyle = (t: ThemeTokens) => ({
  position: 'fixed' as const,
  bottom: '64px',
  right: '16px',
  width: `${PANEL_WIDTH}px`,
  background: t.surfaceBg,
  border: `1px solid ${t.surfaceBorder}`,
  borderRadius: '16px',
  boxShadow: t.surfaceShadow,
  pointerEvents: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  color: t.textPrimary,
  fontFamily:
    'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: '12px',
  letterSpacing: '-0.02em',
  overflow: 'hidden',
});

const panelHeader = (_t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 12px 8px 16px',
});

const rowStyle = (_t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  gap: '12px',
  padding: '9px 8px',
  border: 'none',
  borderRadius: '8px',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'left' as const,
});

const dividerStyle = (t: ThemeTokens) => ({
  height: '1px',
  background: t.controlBorder,
  margin: '4px 8px',
});

const iconBtn = (t: ThemeTokens) => ({
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  width: '28px',
  height: '28px',
  borderRadius: '8px',
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: t.textPrimary,
  cursor: 'pointer',
});

const inputStyle = (t: ThemeTokens) => ({
  flex: 1,
  minWidth: 0,
  height: '30px',
  padding: '0 9px',
  background: t.fieldBg,
  border: `1px solid ${t.fieldBorder}`,
  borderRadius: '6px',
  color: t.textPrimary,
  fontFamily: 'inherit',
  fontSize: '12px',
  letterSpacing: 'inherit',
  outline: 'none',
  boxSizing: 'border-box' as const,
});

const saveBtn = (t: ThemeTokens) => ({
  flexShrink: 0,
  height: '30px',
  padding: '0 12px',
  background: t.submitBg,
  color: t.submitText,
  border: 'none',
  borderRadius: '6px',
  fontFamily: 'inherit',
  fontSize: '12px',
  fontWeight: 500,
  letterSpacing: 'inherit',
});
