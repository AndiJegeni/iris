/** @jsxImportSource preact */
import type { Task } from '@iris/shared';
import { CloseSmallIcon, PlusThinIcon, ThinChevronLeftIcon } from './icons';
import { type OverlayTheme, surfacePalette } from './theme';

/** One open chat in the tab strip. */
export type ChatTab = { id: string; title: string; status: Task['status'] };

/** The tabbed window header — an editor-style strip with every open chat. */
export function ChatTabBar({
  tabs,
  activeId,
  theme,
  onBack,
  onSelectTab,
  onCloseTab,
}: {
  tabs: ChatTab[];
  activeId: string;
  theme: OverlayTheme;
  onBack: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}) {
  // No bar fill and no bespoke selected tint — the bar sits on the panel and the
  // selected tab uses the pill's hover ink, the chat's only fill.
  return (
    <div style={tabBar(theme)}>
      <style>{tabBarCss(theme)}</style>
      <button
        type="button"
        className="la-tc-tabicon"
        style={tabBackBtn}
        onClick={onBack}
        aria-label="Back to tasks"
      >
        <ThinChevronLeftIcon />
      </button>
      <div style={tabsRow}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              style={active ? activeTab(theme) : inactiveTab(theme)}
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
                className="la-tc-tabicon"
                style={tabClose}
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
        <button
          type="button"
          className="la-tc-tabicon"
          style={tabIconBtn}
          onClick={onBack}
          aria-label="Back to tasks"
        >
          <PlusThinIcon />
        </button>
      </div>
    </div>
  );
}

// ---------- styles ----------

// The bar's icons rest at `soft` and come up to full ink on hover. Both colours
// live in the rule, never inline: an inline `color` would outrank `:hover`.
const tabBarCss = (theme: OverlayTheme): string => {
  const p = surfacePalette(theme);
  return `.la-tc-tabicon{color:${p.soft};transition:color 90ms}.la-tc-tabicon:hover{color:${p.ink}}`;
};

const tabBar = (theme: OverlayTheme) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '8px',
  // Same stroke as every container below it (see chatInk) so the divider is the
  // same line, not a second grey.
  borderBottom: `1px solid ${surfacePalette(theme).stroke}`,
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

const tabBackBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '26px',
  height: '26px',
  background: 'transparent',
  border: 'none',
  borderRadius: '999px',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const activeTab = (theme: OverlayTheme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  minWidth: '90px',
  maxWidth: '180px',
  flexShrink: 0,
  padding: '6px 6px 6px 10px',
  // Selection is carried by ink alone. A fill here made the row read as a
  // browser tab strip — chrome competing with the transcript underneath.
  background: 'transparent',
  borderRadius: '6px',
  color: surfacePalette(theme).ink,
  fontSize: '13px',
});

const inactiveTab = (theme: OverlayTheme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  minWidth: '90px',
  maxWidth: '180px',
  flexShrink: 0,
  padding: '6px 6px 6px 10px',
  background: 'transparent',
  borderRadius: '6px',
  color: surfacePalette(theme).soft,
  fontSize: '13px',
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

const tabClose = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
  background: 'transparent',
  border: 'none',
  borderRadius: '999px',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const tabActions = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  flexShrink: 0,
};

const tabIconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '26px',
  height: '26px',
  background: 'transparent',
  border: 'none',
  borderRadius: '999px',
  cursor: 'pointer',
  padding: 0,
};
