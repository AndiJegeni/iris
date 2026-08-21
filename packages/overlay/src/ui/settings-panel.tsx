/** @jsxImportSource preact */
import { type AuthStatus, type Provider, type ProviderAuthStatus, VERSION } from '@iris/shared';
import { useState } from 'preact/hooks';
import { CheckboxCheckIcon, ChevronLeftIcon, ChevronRightIcon, MoonIcon, SunIcon } from './icons';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

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
  /**
   * Which view to open on. The panel owns `view` after mount, so this only
   * seeds it — for the gallery, which renders the Accounts view's credential
   * states directly rather than making you click through to find them.
   * Mirrors TaskPanel's `defaultOpen`.
   */
  defaultView?: 'settings' | 'accounts';
};

const PANEL_WIDTH = 320;

/** Red used for both the expired-credential state and inline errors. */
const DANGER = '#e5484d';

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
  defaultView = 'settings',
}: SettingsPanelProps) {
  const t = tokens(theme);
  const [view, setView] = useState<'settings' | 'accounts'>(defaultView);

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
          <span style={{ fontWeight: 500, fontSize: '13px', color: t.textPrimary }}>Iris</span>
          <span style={{ fontSize: '11px', color: t.textFaint }}>v{VERSION}</span>
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
            <ChevronRightIcon size={14} />
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
            <ChevronLeftIcon />
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
  status: ProviderAuthStatus | undefined;
  onLogin: ((provider: Provider) => Promise<void>) | undefined;
  onLogout: ((provider: Provider) => Promise<void>) | undefined;
  onSaveKey: ((provider: Provider, value: string) => Promise<void>) | undefined;
  isLast: boolean;
}) {
  const [busy, setBusy] = useState<null | 'login' | 'logout' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const method = status?.method ?? 'none';
  // A credential the daemon has seen a real run rejected: the stored session
  // still *looks* valid, so only this tells us it no longer works.
  const expired = Boolean(status?.expired) && method !== 'none';
  const loggedIn = method === 'oauth' && !expired;
  const hasKey = method === 'api-key';

  const statusLabel = expired
    ? method === 'oauth'
      ? 'Session expired — log in again'
      : 'API key rejected'
    : loggedIn
      ? 'Subscription · connected'
      : hasKey
        ? 'API key set'
        : 'Not connected';
  const statusColor = expired ? DANGER : loggedIn ? t.accent : hasKey ? t.textPrimary : t.textFaint;

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
              opacity: loggedIn || hasKey || expired ? 1 : 0.5,
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
          {busy === 'login'
            ? 'Waiting for browser…'
            : expired && method === 'oauth'
              ? 'Log in again'
              : provider.loginLabel}
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
        <p style={{ fontSize: '11px', color: DANGER, lineHeight: 1.4, margin: '6px 2px 0' }}>
          {error}
        </p>
      ) : null}
    </div>
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

const dividerStyle = (t: ThemeTokens) => ({
  height: '1px',
  background: t.controlBorder,
  // Inset so the rule reads as a subtle hairline between the two rows rather
  // than a full-width separator.
  margin: '3px 40px',
});

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
      {checked ? <CheckboxCheckIcon /> : null}
    </span>
  );
}

const rowStyle = (_t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  gap: '12px',
  padding: '9px 8px',
  border: 'none',
  borderRadius: '8px',
  // No inline `background` — `.la-sp-row` rests at transparent so its :hover
  // fill can win. Named here it outranked the rule, and neither settings row
  // had ever highlighted under the cursor.
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'left' as const,
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
