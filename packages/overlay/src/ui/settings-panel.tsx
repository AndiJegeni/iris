/** @jsxImportSource preact */
import { type AuthStatus, type Provider, type ProviderAuthStatus, VERSION } from '@iris/shared';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  CheckboxCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClaudeLogoIcon,
  MoonIcon,
  OpenAILogoIcon,
  PlusThinIcon,
  SunIcon,
} from './icons';
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
  /** Daemon-wide yolo mode: agents run with no approval prompts when on. */
  bypassPermissions?: boolean;
  onToggleBypassPermissions?: (next: boolean) => void | Promise<void>;
  /** Current provider auth status from the daemon (null until fetched). */
  auth?: AuthStatus | null;
  /** Start a subscription login (opens the browser via the daemon). */
  onLogin?: (provider: Provider) => Promise<void>;
  /** Log out of a subscription / clear a key. */
  onLogout?: (provider: Provider) => Promise<void>;
  /** Persist (or clear, when empty) a provider API key. */
  onSaveKey?: (provider: Provider, value: string) => Promise<void>;
};

const PANEL_WIDTH = 320;

/** Red used for both the expired-credential state and inline errors. */
const DANGER = '#e5484d';

/** Claude's clay orange — the one brand hue in the panel, on the spark only. */
const CLAUDE_BRAND = '#d97757';

/**
 * Providers shown in the "Accounts" sub-view, in display order.
 *
 * `account` names what you log in *with* — it differs from the provider label
 * on the OpenAI side (the agent is Codex, the plan is ChatGPT).
 */
const PROVIDERS: {
  id: Provider;
  label: string;
  account: string;
  logo: (props: { size: number }) => JSX.Element;
}[] = [
  {
    id: 'anthropic',
    label: 'Claude',
    account: 'Claude',
    logo: ({ size }) => <ClaudeLogoIcon size={size} style={{ color: CLAUDE_BRAND }} />,
  },
  {
    id: 'openai',
    label: 'Codex',
    account: 'ChatGPT',
    logo: ({ size }) => <OpenAILogoIcon size={size} />,
  },
];

/**
 * Route a pasted key to its provider by prefix — Anthropic keys are
 * `sk-ant-…`, OpenAI's are plain `sk-…`. This is what lets the panel offer a
 * single key field instead of one per provider.
 */
function detectKeyProvider(key: string): Provider | null {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (/^sk-./.test(key)) return 'openai';
  return null;
}

/**
 * Floating Settings modal opened from the active Pill's gear button. Anchored
 * bottom-right above the pill, theme-aware (dark/light) like the TaskPanel.
 * Two views toggled by internal state (mirrors TaskPanel's list⇄chat pattern):
 * the settings list, and an "Accounts" sub-view for provider credentials.
 */
export function SettingsPanel({
  theme = 'dark',
  anchorStyle,
  onToggleTheme,
  blockInteractions = false,
  onToggleBlockInteractions,
  bypassPermissions = false,
  onToggleBypassPermissions,
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
          bypassPermissions={bypassPermissions}
          onToggleBypassPermissions={onToggleBypassPermissions}
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
  bypassPermissions,
  onToggleBypassPermissions,
  onOpenAccounts,
}: {
  t: ThemeTokens;
  theme: OverlayTheme;
  onToggleTheme: (() => void) | undefined;
  blockInteractions: boolean;
  onToggleBlockInteractions: ((next: boolean) => void) | undefined;
  bypassPermissions: boolean;
  onToggleBypassPermissions: ((next: boolean) => void | Promise<void>) | undefined;
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

        {/* Yolo mode: turns off the per-tool approval prompt for every agent.
            Two-line so the consequence is spelled out — it's a footgun, not a
            preference. */}
        <button
          type="button"
          className="la-sp-row"
          style={rowStyle(t)}
          onClick={() => {
            void Promise.resolve(onToggleBypassPermissions?.(!bypassPermissions)).catch(() => {});
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: '12px', color: t.textPrimary }}>
              Bypass permissions
            </span>
            <span
              style={{ display: 'block', fontSize: '11px', color: t.textFaint, marginTop: '1px' }}
            >
              Agents run with no approval prompts
            </span>
          </span>
          <Checkbox checked={bypassPermissions} t={t} />
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

/**
 * The Accounts sub-view, modeled like a website's account chooser: connected
 * credentials are *accounts* — logo, name, method, one quiet action — and
 * adding one always happens on a single sign-in screen (`ConnectView`). With
 * nothing connected the sign-in screen IS the view; with accounts, a
 * "+ Log in with another account" row loops back to it.
 */
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
  const [adding, setAdding] = useState(false);

  const accounts = PROVIDERS.filter((p) => (auth?.[p.id]?.method ?? 'none') !== 'none');
  const connectOpen = adding || accounts.length === 0;
  // From the sign-in screen, back returns to the account list when there is
  // one; otherwise (and from the list) it returns to the settings view.
  const backToList = connectOpen && accounts.length > 0;

  return (
    <>
      {/* Override the shared header's left padding (12px) → 10px so the back
          chevron's glyph (centered in a 28px button, +6px) lines up with the
          content's left edge (container padding 16px). */}
      <div style={{ ...panelHeader(t), paddingLeft: '10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className="la-sp-icon"
            style={iconBtn(t)}
            onClick={backToList ? () => setAdding(false) : onBack}
            aria-label="Back"
          >
            <ChevronLeftIcon />
          </button>
          <span style={{ fontWeight: 500, fontSize: '13px', color: t.textPrimary }}>
            {backToList ? 'Add account' : 'Accounts'}
          </span>
        </span>
      </div>

      <div style={{ padding: '4px 16px 14px' }}>
        {connectOpen ? (
          <ConnectView
            t={t}
            onLogin={onLogin}
            onSaveKey={onSaveKey}
            onDone={() => setAdding(false)}
          />
        ) : (
          <>
            {accounts.map((p) => (
              <AccountRow
                key={p.id}
                t={t}
                provider={p}
                status={auth?.[p.id]}
                onLogin={onLogin}
                onLogout={onLogout}
                onSaveKey={onSaveKey}
                onReplace={() => setAdding(true)}
              />
            ))}
            <button
              type="button"
              className="la-sp-quiet"
              style={addRowStyle}
              onClick={() => setAdding(true)}
            >
              <span style={avatarStyle(t, true)}>
                <PlusThinIcon size={12} />
              </span>
              <span style={{ fontSize: '12px' }}>Add a new account</span>
            </button>
          </>
        )}

        <style>
          {`.la-sp-field::placeholder{color:var(--la-ph);opacity:1}
.la-sp-quiet{color:${t.textFaint};cursor:pointer;transition:color 80ms}
.la-sp-quiet:hover{color:${t.textPrimary}}
.la-sp-quiet:disabled{color:${t.textFaint};cursor:default}
.la-sp-act{color:${t.textPrimary};cursor:pointer}
.la-sp-act:hover{text-decoration:underline}
.la-sp-act:disabled{text-decoration:none;cursor:default}
.la-sp-prov{background:transparent;transition:background 80ms}
.la-sp-prov:hover{background:${t.controlBg}}`}
        </style>
      </div>
    </>
  );
}

/**
 * The sign-in screen. The API key field comes first — one field for every
 * provider, routed by `detectKeyProvider` — with "or log in with" and the two
 * provider buttons below it. Any success reports back through `onDone`.
 */
function ConnectView({
  t,
  onLogin,
  onSaveKey,
  onDone,
}: {
  t: ThemeTokens;
  onLogin: ((provider: Provider) => Promise<void>) | undefined;
  onSaveKey: ((provider: Provider, value: string) => Promise<void>) | undefined;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<null | 'save' | Provider>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const key = keyDraft.trim();
  const detected = detectKeyProvider(key);
  // Keys belong to the platforms, not the agents — name them accordingly.
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveKey = () => {
    if (detected && onSaveKey && busy === null) {
      run('save', () => onSaveKey(detected, key));
    }
  };

  return (
    <>
      {/* The field is the bordered box; the input and its submit share it so
          the plus sits inside the writing area, search-bar style. */}
      <div style={fieldWrap(t)}>
        <input
          type="password"
          value={keyDraft}
          placeholder="Paste an API key"
          onInput={(e) => setKeyDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveKey();
          }}
          // biome-ignore lint/suspicious/noExplicitAny: CSS custom property for ::placeholder color
          style={{ ...fieldInput(t), '--la-ph': t.textFaint } as any}
          className="la-sp-field"
        />
        {/* Lights up once the key's prefix identifies a provider. */}
        <button
          type="button"
          className="la-sp-act"
          style={{ ...keyAddBtn, opacity: detected && busy === null ? 1 : 0.35 }}
          disabled={!detected || busy !== null}
          onClick={saveKey}
          aria-label="Add API key"
        >
          <PlusThinIcon size={14} />
        </button>
      </div>

      {/* Short flanking dashes rather than full-width rules — a label with
          ticks, not a section divider. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          margin: '12px 0 9px',
        }}
      >
        <span style={{ height: '1px', width: '24px', background: t.controlBorder }} />
        <span style={{ fontSize: '10px', color: t.textFaint, letterSpacing: '0.03em' }}>
          or log in with
        </span>
        <span style={{ height: '1px', width: '24px', background: t.controlBorder }} />
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="la-sp-prov"
            style={providerBtn(t)}
            disabled={busy !== null}
            onClick={() => onLogin && run(p.id, () => onLogin(p.id))}
          >
            <p.logo size={15} />
            {busy === p.id ? 'Waiting…' : p.account}
          </button>
        ))}
      </div>

      {error ? (
        <p style={{ fontSize: '11px', color: DANGER, lineHeight: 1.4, margin: '8px 0 0' }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * One connected account: avatar, name, one quiet action. Red is reserved for a
 * credential the daemon saw a real run reject — the stored record still
 * *looks* valid, so only that flag says it stopped working. An expired
 * subscription heals with "Log in again"; a rejected key with "Replace", which
 * jumps to the sign-in screen.
 */
function AccountRow({
  t,
  provider,
  status,
  onLogin,
  onLogout,
  onSaveKey,
  onReplace,
}: {
  t: ThemeTokens;
  provider: (typeof PROVIDERS)[number];
  status: ProviderAuthStatus | undefined;
  onLogin: ((provider: Provider) => Promise<void>) | undefined;
  onLogout: ((provider: Provider) => Promise<void>) | undefined;
  onSaveKey: ((provider: Provider, value: string) => Promise<void>) | undefined;
  onReplace: () => void;
}) {
  const [busy, setBusy] = useState<null | 'login' | 'logout' | 'remove'>(null);
  const [error, setError] = useState<string | null>(null);

  const method = status?.method ?? 'none';
  const expired = Boolean(status?.expired);
  const oauth = method === 'oauth';

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' }}>
        <span style={avatarStyle(t)}>
          <provider.logo size={15} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{ display: 'block', fontSize: '12px', color: t.textPrimary, lineHeight: 1.35 }}
          >
            {provider.label}
          </span>
          {/* The sub-line exists only to carry bad news — a healthy account is
              just its name. */}
          {expired ? (
            <span style={{ display: 'block', fontSize: '11px', color: DANGER, lineHeight: 1.35 }}>
              {oauth ? 'Session expired' : 'API key rejected'}
            </span>
          ) : null}
        </span>
        <span style={{ display: 'inline-flex', gap: '12px' }}>
          {expired ? (
            <button
              type="button"
              className="la-sp-act"
              style={quietBtn}
              disabled={busy !== null}
              onClick={
                oauth ? () => onLogin && run('login', () => onLogin(provider.id)) : onReplace
              }
            >
              {busy === 'login' ? 'Waiting…' : oauth ? 'Log in again' : 'Replace'}
            </button>
          ) : null}
          {oauth ? (
            <button
              type="button"
              className="la-sp-quiet"
              style={quietBtn}
              disabled={busy !== null}
              onClick={() => onLogout && run('logout', () => onLogout(provider.id))}
            >
              {busy === 'logout' ? 'Logging out…' : 'Log out'}
            </button>
          ) : (
            <button
              type="button"
              className="la-sp-quiet"
              style={quietBtn}
              disabled={busy !== null}
              onClick={() => onSaveKey && run('remove', () => onSaveKey(provider.id, ''))}
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          )}
        </span>
      </div>

      {error ? (
        <p style={{ fontSize: '11px', color: DANGER, lineHeight: 1.4, margin: '0 0 6px 36px' }}>
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

/** The key field's bordered shell; holds the input and its inline plus. */
const fieldWrap = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  height: '30px',
  paddingRight: '3px',
  background: t.fieldBg,
  border: `1px solid ${t.fieldBorder}`,
  borderRadius: '6px',
  boxSizing: 'border-box' as const,
});

/** The bare input inside `fieldWrap` — the shell owns the box, this owns the text. */
const fieldInput = (t: ThemeTokens) => ({
  flex: 1,
  minWidth: 0,
  height: '100%',
  padding: '0 9px',
  background: 'transparent',
  border: 'none',
  color: t.textPrimary,
  fontFamily: 'inherit',
  fontSize: '12px',
  letterSpacing: 'inherit',
  outline: 'none',
});

/**
 * The account-row avatar: a small circle holding the provider logo (or, dashed,
 * the add-row's plus — an empty seat where the next account will sit).
 */
const avatarStyle = (t: ThemeTokens, dashed = false) => ({
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  width: '26px',
  height: '26px',
  borderRadius: '50%',
  flexShrink: 0,
  background: dashed ? 'transparent' : t.controlBg,
  border: dashed ? `1px dashed ${t.controlBorder}` : '1px solid transparent',
  boxSizing: 'border-box' as const,
});

/** The "+ Log in with another account" row under the account list. */
const addRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '7px 0',
  background: 'transparent',
  border: 'none',
  fontFamily: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'left' as const,
};

/** Sign-in-screen provider button: outlined, logo + name, hover fill via class. */
const providerBtn = (t: ThemeTokens) => ({
  flex: 1,
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: '7px',
  height: '32px',
  border: `1px solid ${t.controlBorder}`,
  borderRadius: '8px',
  color: t.textPrimary,
  fontFamily: 'inherit',
  fontSize: '12px',
  fontWeight: 500,
  letterSpacing: 'inherit',
  cursor: 'pointer',
});

/**
 * Text-only action (Log out / Replace / Remove / Add). Color and cursor come
 * from the `.la-sp-quiet` / `.la-sp-act` classes so :hover and :disabled can
 * restyle them — inline values would outrank the stylesheet.
 */
const quietBtn = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: '11px',
  letterSpacing: 'inherit',
  whiteSpace: 'nowrap' as const,
};

/** The key field's submit: a bare plus riding inside the field's right edge. */
const keyAddBtn = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  width: '24px',
  height: '24px',
  flexShrink: 0,
  padding: 0,
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
};
