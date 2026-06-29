/** @jsxImportSource preact */
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
  anchorStyle,
  onToggleTheme,
  blockInteractions = false,
  onToggleBlockInteractions,
  apiKeys,
  onSaveKey,
}: SettingsPanelProps) {
  const t = tokens(theme);
  const [view, setView] = useState<'settings' | 'keys'>('settings');

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
  onToggleTheme,
  blockInteractions,
  onToggleBlockInteractions,
  onOpenKeys,
}: {
  t: ThemeTokens;
  theme: OverlayTheme;
  onToggleTheme: (() => void) | undefined;
  blockInteractions: boolean;
  onToggleBlockInteractions: ((next: boolean) => void) | undefined;
  onOpenKeys: () => void;
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

        <button type="button" className="la-sp-row" style={rowStyle(t)} onClick={onOpenKeys}>
          <span style={{ fontSize: '12px', color: t.textPrimary }}>Manage API keys</span>
          <span style={{ display: 'inline-flex', color: t.textFaint }}>
            <ChevronRightIcon size={14} />
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
      {/* Override the shared header's left padding (12px) → 10px so the back
          chevron's glyph (centered in a 28px button, +6px) lines up with the
          provider input boxes' left edge (container padding 16px). */}
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
                htmlFor={`la-key-${p.id}`}
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: t.textPrimary,
                  marginBottom: '5px',
                  marginLeft: '2px',
                }}
              >
                {p.label}
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  id={`la-key-${p.id}`}
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
                  style={{
                    ...saveBtn(t),
                    opacity: dirty ? 1 : 0.4,
                    cursor: dirty ? 'pointer' : 'default',
                  }}
                  disabled={!dirty}
                  onClick={() => onSaveKey?.(p.id, value)}
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}

        <style>{'.la-sp-field::placeholder{color:var(--la-ph);opacity:1}'}</style>

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
      {checked ? <CheckboxCheckIcon /> : null}
    </span>
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
});
