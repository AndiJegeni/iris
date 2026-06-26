/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import type { AuthStatus } from '../transport';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

type Provider = 'anthropic' | 'openai';

type SettingsPanelProps = {
  theme?: OverlayTheme;
  /** Position override (right/bottom/left/top) so the panel tracks the pill. */
  anchorStyle?: Record<string, string>;
  onClose: () => void;
  /** Flip the overlay between light and dark. */
  onToggleTheme?: () => void;
  /** Whether the overlay blocks clicks/scrolls on the host page. */
  blockInteractions?: boolean;
  onToggleBlockInteractions?: (next: boolean) => void;
  /** Current provider auth status from the daemon (null until fetched). */
  auth?: AuthStatus | null;
  /** Start a subscription login (opens the browser via the daemon). */
  onLogin?: (provider: Provider) => Promise<void>;
  /** Log out of a subscription / clear a key. */
  onLogout?: (provider: Provider) => Promise<void>;
  /** Persist (or clear, when empty) a provider API key. */
  onSaveKey?: (provider: Provider, value: string) => Promise<void>;
};

const VERSION = 'v0.1';

const PANEL_WIDTH = 320;

/** Providers shown in the "Accounts" sub-view, in display order. */
const PROVIDERS: {
  id: Provider;
  label: string;
  loginLabel: string;
  placeholder: string;
}[] = [
  { id: 'anthropic', label: 'Claude', loginLabel: 'Log in with Claude', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'Codex', loginLabel: 'Log in with ChatGPT', placeholder: 'sk-…' },
];

/**
 * Floating Settings modal opened from the active Pill's gear button. Anchored
 * bottom-right above the pill, theme-aware (dark/light) like the TaskPanel.
 * Two views toggled by internal state (mirrors TaskPanel's list⇄chat pattern):
 * the settings list, and a "Manage API keys" sub-view.
 */
export function SettingsPanel({
  theme = 'dark',
  anchorStyle,
  onToggleTheme,
  blockInteractions = false,
  onToggleBlockInteractions,
  auth,
  onLogin,
  onLogout,
  onSaveKey,
}: SettingsPanelProps) {
  const t = tokens(theme);
  const [view, setView] = useState<'settings' | 'accounts'>('settings');

  return (
    <div style={{ ...panelStyle(t), ...anchorStyle }}>
      <style>
        {`.la-sp-row{background:transparent;transition:background 80ms}.la-sp-row:hover{background:${t.controlBg}}.la-sp-icon{opacity:0.6;transition:opacity 80ms}.la-sp-icon:hover{opacity:1}`}
      </style>

      {view === 'settings' ? (
        <SettingsView
          t={t}
          theme={theme}
          onToggleTheme={onToggleTheme}
          blockInteractions={blockInteractions}
          onToggleBlockInteractions={onToggleBlockInteractions}
          onOpenAccounts={() => setView('accounts')}
        />
      ) : (
        <AccountsView
          t={t}
          auth={auth}
          onLogin={onLogin}
          onLogout={onLogout}
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
  onToggleTheme,
  blockInteractions,
  onToggleBlockInteractions,
  onOpenAccounts,
}: {
  t: ThemeTokens;
  theme: OverlayTheme;
  onToggleTheme: (() => void) | undefined;
  blockInteractions: boolean;
  onToggleBlockInteractions: ((next: boolean) => void) | undefined;
  onOpenAccounts: () => void;
}) {
  return (
    <>
      <div style={panelHeader(t)}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontWeight: 500, fontSize: '13px', color: t.textPrimary }}>lens</span>
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
        </div>
      </div>

      <div style={{ padding: '2px 8px 8px' }}>
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

        <button type="button" className="la-sp-row" style={rowStyle(t)} onClick={onOpenAccounts}>
          <span style={{ fontSize: '12px', color: t.textPrimary }}>Accounts</span>
          <span style={{ display: 'inline-flex', color: t.textFaint }}>
            <ChevronRight />
          </span>
        </button>
      </div>
    </>
  );
}

function AccountsView({
  t,
  auth,
  onLogin,
  onLogout,
  onSaveKey,
  onBack,
}: {
  t: ThemeTokens;
  auth: AuthStatus | null | undefined;
  onLogin: ((provider: Provider) => Promise<void>) | undefined;
  onLogout: ((provider: Provider) => Promise<void>) | undefined;
  onSaveKey: ((provider: Provider, value: string) => Promise<void>) | undefined;
  onBack: () => void;
}) {
  return (
    <>
      {/* Override the shared header's left padding (12px) → 10px so the back
          chevron's glyph (centered in a 28px button, +6px) lines up with the
          provider cards' left edge (container padding 16px). */}
      <div style={{ ...panelHeader(t), paddingLeft: '10px' }}>
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
          <span style={{ fontWeight: 500, fontSize: '13px', color: t.textPrimary }}>Accounts</span>
        </span>
      </div>

      <div style={{ padding: '4px 16px 14px' }}>
        {PROVIDERS.map((p, i) => (
          <ProviderCard
            key={p.id}
            t={t}
            provider={p}
            status={auth?.[p.id]}
            onLogin={onLogin}
            onLogout={onLogout}
            onSaveKey={onSaveKey}
            isLast={i === PROVIDERS.length - 1}
          />
        ))}

        <style>{'.la-sp-field::placeholder{color:var(--la-ph);opacity:1}'}</style>
      </div>
    </>
  );
}

function ProviderCard({
  t,
  provider,
  status,
  onLogin,
  onLogout,
  onSaveKey,
  isLast,
}: {
  t: ThemeTokens;
  provider: { id: Provider; label: string; loginLabel: string; placeholder: string };
  status: { method: string; configured: boolean } | undefined;
  onLogin: ((provider: Provider) => Promise<void>) | undefined;
  onLogout: ((provider: Provider) => Promise<void>) | undefined;
  onSaveKey: ((provider: Provider, value: string) => Promise<void>) | undefined;
  isLast: boolean;
}) {
  const [busy, setBusy] = useState<null | 'login' | 'logout' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const method = status?.method ?? 'none';
  const loggedIn = method === 'oauth';
  const hasKey = method === 'api-key';

  const statusLabel = loggedIn
    ? 'Subscription · connected'
    : hasKey
      ? 'API key set'
      : 'Not connected';
  const statusColor = loggedIn ? t.accent : hasKey ? t.textPrimary : t.textFaint;

  const run = async (kind: 'login' | 'logout' | 'save', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (kind === 'save') setKeyDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginBottom: isLast ? 0 : '14px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '7px',
          marginLeft: '2px',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 500, color: t.textPrimary }}>
          {provider.label}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: statusColor,
              opacity: loggedIn || hasKey ? 1 : 0.5,
            }}
          />
          <span style={{ fontSize: '11px', color: statusColor }}>{statusLabel}</span>
        </span>
      </div>

      {loggedIn ? (
        <button
          type="button"
          style={{ ...secondaryBtn(t), width: '100%' }}
          disabled={busy !== null}
          onClick={() => onLogout && run('logout', () => onLogout(provider.id))}
        >
          {busy === 'logout' ? 'Logging out…' : 'Log out'}
        </button>
      ) : (
        <button
          type="button"
          style={{ ...saveBtn(t), width: '100%', opacity: busy ? 0.6 : 1 }}
          disabled={busy !== null}
          onClick={() => onLogin && run('login', () => onLogin(provider.id))}
        >
          {busy === 'login' ? 'Waiting for browser…' : provider.loginLabel}
        </button>
      )}

      {/* API-key alternative */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 2px 7px' }}>
        <span style={{ height: '1px', flex: 1, background: t.controlBorder }} />
        <span style={{ fontSize: '10px', color: t.textFaint, letterSpacing: '0.04em' }}>OR</span>
        <span style={{ height: '1px', flex: 1, background: t.controlBorder }} />
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="password"
          value={keyDraft}
          placeholder={hasKey ? 'Replace API key…' : provider.placeholder}
          onInput={(e) => setKeyDraft((e.target as HTMLInputElement).value)}
          // biome-ignore lint/suspicious/noExplicitAny: CSS custom property for ::placeholder color
          style={{ ...inputStyle(t), '--la-ph': t.textFaint } as any}
          className="la-sp-field"
        />
        <button
          type="button"
          style={{
            ...secondaryBtn(t),
            opacity: keyDraft.trim() && !busy ? 1 : 0.4,
            cursor: keyDraft.trim() && !busy ? 'pointer' : 'default',
          }}
          disabled={!keyDraft.trim() || busy !== null}
          onClick={() => onSaveKey && run('save', () => onSaveKey(provider.id, keyDraft.trim()))}
        >
          {busy === 'save' ? '…' : 'Save'}
        </button>
      </div>

      {error ? (
        <p style={{ fontSize: '11px', color: '#e5484d', lineHeight: 1.4, margin: '6px 2px 0' }}>
          {error}
        </p>
      ) : null}
    </div>
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
  fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontSize: '12px',
  letterSpacing: '-0.02em',
  overflow: 'hidden',
});

const panelHeader = (_t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '9px 9px 5px 12px',
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
  // Inset further (was 8px) and thinner-feeling so the rule reads as a subtle
  // hairline between the two rows rather than a full-width separator.
  margin: '3px 40px',
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
  cursor: 'pointer',
});

/** Lower-emphasis button (log out, save key) — outlined rather than filled. */
const secondaryBtn = (t: ThemeTokens) => ({
  flexShrink: 0,
  height: '30px',
  padding: '0 12px',
  background: t.controlBg,
  color: t.textPrimary,
  border: `1px solid ${t.controlBorder}`,
  borderRadius: '6px',
  fontFamily: 'inherit',
  fontSize: '12px',
  fontWeight: 500,
  letterSpacing: 'inherit',
  cursor: 'pointer',
});
