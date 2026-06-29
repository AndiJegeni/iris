/** @jsxImportSource preact */
import type { Task } from '@localagents/shared';
import { CloseSmallIcon, PlusThinIcon, ThinChevronLeftIcon } from './icons';
import type { OverlayTheme, ThemeTokens } from './theme';

/** One open chat in the tab strip. */
export type ChatTab = { id: string; title: string; status: Task['status'] };

/** The tabbed window header — an editor-style strip with every open chat. */
export function ChatTabBar({
  tabs,
  activeId,
  t,
  theme,
  onBack,
  onSelectTab,
  onCloseTab,
}: {
  tabs: ChatTab[];
  activeId: string;
  t: ThemeTokens;
  theme: OverlayTheme;
  onBack: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}) {
  // Flipped: the bar is the plain surface (white in light) and the *selected*
  // tab carries the subtle gray.
  const barBg = t.surfaceBg;
  const selectedBg = theme === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.07)';
  return (
    <div style={{ ...tabBar(t), background: barBg }}>
      <button type="button" style={tabBackBtn(t)} onClick={onBack} aria-label="Back to tasks">
        <ThinChevronLeftIcon />
      </button>
      <div style={tabsRow}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              style={active ? { ...activeTab(t), background: selectedBg } : inactiveTab(t)}
              title={tab.title}
            >
              <button
                type="button"
                style={tabSelectBtn}
                onClick={active ? undefined : () => onSelectTab(tab.id)}
              >
                <span style={tabTitle}>{tab.title}</span>
              </button>
              <button
                type="button"
                style={tabClose(t)}
                onClick={() => onCloseTab(tab.id)}
                aria-label="Close chat"
              >
                <CloseSmallIcon />
              </button>
            </div>
          );
        })}
      </div>
      <div style={tabActions}>
        <button type="button" style={tabIconBtn(t)} onClick={onBack} aria-label="Back to tasks">
          <PlusThinIcon />
        </button>
      </div>
    </div>
  );
}

// ---------- styles ----------

const tabBar = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '6px 8px',
  background: t.controlBg,
  flexShrink: 0,
});

const tabsRow = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  minWidth: 0,
  flex: 1,
  overflowX: 'auto' as const,
  scrollbarWidth: 'none' as const,
};

const tabBackBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '26px',
  height: '26px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: t.textMuted,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
});

const activeTab = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  minWidth: '90px',
  maxWidth: '180px',
  flexShrink: 0,
  padding: '6px 6px 6px 10px',
  background: t.surfaceBg,
  borderRadius: '8px',
  color: t.textPrimary,
  fontSize: '12px',
});

const inactiveTab = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  minWidth: '90px',
  maxWidth: '180px',
  flexShrink: 0,
  padding: '6px 6px 6px 10px',
  background: 'transparent',
  borderRadius: '8px',
  color: t.textMuted,
  fontSize: '12px',
  cursor: 'pointer',
});

const tabSelectBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  textAlign: 'left' as const,
};

const tabTitle = {
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
  minWidth: 0,
};

const tabClose = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: t.textMuted,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
});

const tabActions = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  flexShrink: 0,
};

const tabIconBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '26px',
  height: '26px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: t.textMuted,
  cursor: 'pointer',
  padding: 0,
});
