/** @jsxImportSource preact */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { type SelectModeController, startSelectMode } from './select-mode';
import {
  type Resolution,
  collectComponentPath,
  getFiberFromDom,
  resolveSource,
} from './source-resolution';
import { ElementOutline, type OutlineLabel } from './ui/element-outline';
import { InteractionShield } from './ui/interaction-shield';
import { PickedPopover } from './ui/picked-popover';
import { PILL_CIRCLE, PILL_TOOLBAR_W, Pill } from './ui/pill';
import { SettingsPanel } from './ui/settings-panel';
import { TaskPanel } from './ui/task-panel';
import { isRunning } from './ui/task-row';
import type { OverlayTheme } from './ui/theme';
import { useTransport } from './use-transport';

type PickState = {
  element: Element;
  resolution: Resolution;
};

// Anchored by distance from the viewport's RIGHT edge (not left) so the
// circle→toolbar morph always grows leftward from a fixed right edge — matching
// the parked, never-dragged pill. Pinning `left` instead would let the toolbar
// expand rightward (opening left-to-right) once the pill had been dragged.
type PillPos = { right: number; top: number };
type DragState = {
  startX: number;
  startY: number;
  origRight: number;
  origTop: number;
  w: number;
  h: number;
  moved: boolean;
};

// Pixels the pointer must travel before a press becomes a drag (vs. a click).
const DRAG_THRESHOLD = 4;
// Keep the pill this far from the viewport edges while dragging.
const MARGIN = 8;
const PILL_POS_KEY = 'iris:pill-pos';
// "Block page interactions" survives reloads: it's a working mode you stay in
// while annotating, and the page navigating out from under you would otherwise
// silently drop it.
const BLOCK_KEY = 'iris:block-interactions';
// The gap a panel leaves above the pill. The settings + chat panels — and now
// the task panel — open just above wherever the pill currently sits, so this
// keeps them tethered to it. Pill dimensions come from pill.tsx itself.
const PANEL_GAP = 8;
// Widest panel (the chat composer) — used to keep a panel on-screen when the
// pill has been dragged toward the left edge.
const PANEL_MAX_W = 380;
/**
 * Shortest the task drawer is allowed to get. It runs from the top edge down to
 * just above the pill, so a pill dragged near the top of the window would
 * otherwise give it a negative height and collapse it entirely.
 */
const TASKS_PANEL_MIN_H = 220;
// Background Tasks launcher: a 40px circle that widens to carry a running count
// beside the glyph (40 empty, ~57 with one digit, ~67 with two). Deliberately
// over-estimated — this only decides which side of the pill it parks on, and
// guessing wide just flips it a few pixels early. Only drawn when we're standing
// on our own: under the orchestrator shell the button lives in its top bar.
const TASKS_LAUNCHER_W = 68;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Restore the dragged pill position, clamped into the current viewport. */
function loadPillPos(): PillPos | null {
  try {
    const raw = localStorage.getItem(PILL_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PillPos;
    if (typeof p?.right !== 'number' || typeof p?.top !== 'number') return null;
    return {
      right: clamp(p.right, MARGIN, window.innerWidth - MARGIN),
      top: clamp(p.top, MARGIN, window.innerHeight - MARGIN),
    };
  } catch {
    return null;
  }
}

function savePillPos(p: PillPos): void {
  try {
    localStorage.setItem(PILL_POS_KEY, JSON.stringify(p));
  } catch {
    // ignore (private mode / disabled storage)
  }
}

function loadBlockInteractions(): boolean {
  try {
    return localStorage.getItem(BLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function Overlay() {
  // `armed` is the sticky pill state; `selecting` is armed-or-Alt and drives hover outlines.
  const [armed, setArmed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [hoverLabel, setHoverLabel] = useState<OutlineLabel | null>(null);
  const [picked, setPicked] = useState<PickState | null>(null);
  // Pill toolbar panels: the gear opens Settings, the chat icon opens the
  // element-less composer (a PickedPopover with no anchored element). The two
  // are mutually exclusive — opening one closes the other.
  const [showSettings, setShowSettings] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Background Tasks drawer — opened from the tasks button, which only exists
  // while tasks do. Mutually exclusive with the chat/settings panels.
  const [tasksOpen, setTasksOpen] = useState(false);
  // Counts the orchestrator shell's pings. Non-zero means the shell is there and
  // owns the Background Tasks button (top bar, left of the viewport switcher),
  // so we drop our own floating launcher. It's a counter rather than a flag
  // because the shell re-pings on every navigation, having cleared what it knew
  // about us — each ping has to pull a fresh report back out. See the handshake
  // below.
  const [shellPings, setShellPings] = useState(0);
  const inShell = shellPings > 0;
  const [pillPos, setPillPos] = useState<PillPos | null>(loadPillPos);
  // Makes the host page inert (see InteractionShield) so clicking around to
  // annotate never triggers the app itself.
  const [blockInteractions, setBlockInteractions] = useState(loadBlockInteractions);
  const dragRef = useRef<DragState | null>(null);
  const controllerRef = useRef<SelectModeController | null>(null);
  // Theme follows the host page's color scheme, but the Settings panel can
  // override it (null = follow the system preference).
  const systemTheme = usePrefersColorScheme();
  const [themeOverride, setThemeOverride] = useState<OverlayTheme | null>(null);
  const theme = themeOverride ?? systemTheme;
  const {
    state,
    send,
    cancel,
    retry,
    sendMessage,
    fetchTranscript,
    login,
    logout,
    saveApiKey,
    ship,
    createPr,
    discard,
  } = useTransport();

  useEffect(() => {
    const controller = startSelectMode({
      onSelectingChange: (s) => {
        setSelecting(s);
        if (!s) {
          setHovered(null);
          setHoverLabel(null);
        }
      },
      onArmedChange: setArmed,
      onHover: (el) => {
        setHovered(el);
        setHoverLabel(el ? describeHover(el) : null);
      },
      onPick: (el) => {
        const resolution = resolveSource(el);
        setHovered(null);
        // Pause hover/pick while the popover is open — but stay armed so the
        // pill keeps showing the active toolbar across sends.
        controller.pause();
        setPicked({ element: el, resolution });
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const closePopover = useCallback(() => {
    setPicked(null);
    controllerRef.current?.resume();
  }, []);

  // Report the resolved theme to the orchestrator shell when we're running in
  // its iframe. The shell is a different origin, so it can't read our state and
  // `prefers-color-scheme` alone would miss the manual sun/moon override — its
  // top bar would sit dark above a light overlay. Harmless if there's no shell:
  // the message just goes nowhere.
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage({ source: 'iris', type: 'theme', theme }, '*');
  }, [theme]);

  // The drawer and the pill's panels are mutually exclusive — three surfaces
  // stacked in the same corner is unreadable.
  const openTasksPanel = useCallback((next: boolean) => {
    if (next) {
      setChatOpen(false);
      setShowSettings(false);
    }
    setTasksOpen(next);
  }, []);
  // Read by the shell's toggle message, whose listener is registered once.
  const tasksOpenRef = useRef(tasksOpen);
  tasksOpenRef.current = tasksOpen;

  // Two-way handshake with the orchestrator shell, which hosts the Background
  // Tasks button in its top bar. It's a different origin, so it can neither read
  // our task list nor call into the drawer: we post the counts up, it posts a
  // toggle back. Either side may come up first — the shell pings on iframe load,
  // and answers our first report with the same ping — so `shell:hello` is what
  // establishes the connection rather than any particular ordering.
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    const onMessage = (ev: MessageEvent) => {
      // Only our own embedder, and only the two messages it may send.
      if (ev.source !== window.parent) return;
      const data = ev.data as { source?: string; type?: string } | null;
      if (!data || data.source !== 'iris-shell') return;
      if (data.type !== 'shell:hello' && data.type !== 'tasks:toggle') return;
      setShellPings((n) => n + 1);
      if (data.type === 'tasks:toggle') openTasksPanel(!tasksOpenRef.current);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [openTasksPanel]);

  // Report the drawer's state upward so the shell's button can mirror it: shown
  // only while there's work (same rule the floating launcher follows), carrying
  // the running count, and lit while the drawer is open. Re-sent on every ping
  // as well as on every change, so a shell that has just reset itself gets the
  // current picture rather than waiting for the next task event. Harmless if
  // there's no shell — the message just goes nowhere.
  const taskCount = state.tasks.length;
  const runningCount = state.tasks.filter(isRunning).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: shellPings is the point, not a stale read — a new ping means a shell that has forgotten our counts and needs them re-sent.
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage(
      { source: 'iris', type: 'tasks', total: taskCount, running: runningCount, open: tasksOpen },
      '*',
    );
  }, [taskCount, runningCount, tasksOpen, shellPings]);

  const toggleBlockInteractions = useCallback((next: boolean) => {
    setBlockInteractions(next);
    try {
      localStorage.setItem(BLOCK_KEY, next ? '1' : '0');
    } catch {
      // ignore (private mode / disabled storage)
    }
  }, []);

  // Esc-to-close is handled inside PickedPopover so it runs through the exit
  // animation before unmounting (rather than dropping the popover instantly).

  // Escape closes the settings panel. The chat composer is a PickedPopover, which
  // handles its own Esc internally so it runs through the exit animation before
  // unmounting (see closePopover comment above) — so it's deliberately not here.
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowSettings(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [showSettings]);

  // Pause select-mode (hover crosshair + picking) while a panel is open so no
  // outline lingers behind the composer/settings; resume when both close.
  useEffect(() => {
    const c = controllerRef.current;
    if (!c) return;
    if (chatOpen || showSettings) c.pause();
    else c.resume();
  }, [chatOpen, showSettings]);

  // Drag the pill from anywhere on its surface. A click that never crosses the
  // DRAG_THRESHOLD still arms/toggles; once it does, we move the pill (top/left)
  // and swallow the trailing click so the buttons underneath don't fire.
  const onPillDragStart = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    const root = e.currentTarget as HTMLElement;
    const rect = root.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origRight: window.innerWidth - rect.right,
      origTop: rect.top,
      w: rect.width,
      h: rect.height,
      moved: false,
    };
    const onMove = (me: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = me.clientX - d.startX;
      const dy = me.clientY - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      me.preventDefault();
      // Dragging right (positive dx) shrinks the distance from the right edge.
      const right = clamp(d.origRight - dx, MARGIN, window.innerWidth - d.w - MARGIN);
      const top = clamp(d.origTop + dy, MARGIN, window.innerHeight - d.h - MARGIN);
      setPillPos({ right, top });
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      if (!d?.moved) return;
      // Eat the click that fires right after a drag so it doesn't toggle the pill.
      const swallow = (ce: MouseEvent) => {
        ce.stopPropagation();
        ce.preventDefault();
        window.removeEventListener('click', swallow, true);
      };
      window.addEventListener('click', swallow, true);
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 60);
      setPillPos((p) => {
        if (p) savePillPos(p);
        return p;
      });
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }, []);

  const pillRight = pillPos ? pillPos.right : 16;
  const pillTopFromBottom = pillPos ? window.innerHeight - pillPos.top : 16 + PILL_CIRCLE;

  const pillPositionStyle = pillPos
    ? { top: `${pillPos.top}px`, right: `${pillPos.right}px`, left: 'auto', bottom: 'auto' }
    : undefined;

  // Settings + chat panels open just above the pill, right-aligned to it, and
  // track its dragged position (default: bottom-right). `right`/`bottom` mirror
  // the pill's own anchor; clamp `right` so a panel stays on-screen when the pill
  // is dragged toward the left edge.
  const panelRight = Math.min(
    pillRight,
    Math.max(MARGIN, window.innerWidth - PANEL_MAX_W - MARGIN),
  );
  const panelAnchorStyle = {
    right: `${panelRight}px`,
    bottom: `${pillTopFromBottom + PANEL_GAP}px`,
    left: 'auto',
    top: 'auto',
  };

  // The launcher shares the pill's row, immediately to its left. The pill keeps
  // a fixed right edge and grows leftward when armed, so offset by whichever
  // width it currently has and reuse its morph timing — the circle slides in
  // step with the toolbar instead of being jumped aside.
  const pillWidth = armed ? PILL_TOOLBAR_W : PILL_CIRCLE;
  const leftOfPill = pillRight + pillWidth + PANEL_GAP;
  // Dragged against the left edge there's no room on that side and the circle
  // would hang off-screen. Fall back to the pill's right flank, which by
  // definition has space in that case.
  const tasksRight =
    window.innerWidth - leftOfPill - TASKS_LAUNCHER_W >= MARGIN
      ? leftOfPill
      : Math.max(MARGIN, pillRight - TASKS_LAUNCHER_W - PANEL_GAP);
  const tasksLauncherStyle = {
    right: `${tasksRight}px`,
    bottom: `${pillTopFromBottom - PILL_CIRCLE}px`,
    left: 'auto',
    top: 'auto',
    transition: 'right 320ms cubic-bezier(0.19, 1, 0.22, 1)',
  };

  // The drawer runs from the top edge down to just above the pill row, so it
  // gets nearly the full height without ever sharing space with the toolbar.
  //
  // It docks to the right edge of the *window*, not to the pill. The settings
  // and chat panels track the pill because they belong to it — they open out of
  // the button you just pressed. The task drawer is a place, not a popover: it
  // holds work that outlives the toolbar's position, and having it slide across
  // the screen because the toolbar was dragged made it read as a menu hanging
  // off the pill rather than somewhere tasks live.
  //
  // Vertically it still clears the pill row wherever that has been dragged to,
  // and the bottom is clamped so a pill parked near the top can't invert the
  // drawer into a negative height.
  const tasksPanelBottom = Math.min(
    pillTopFromBottom + PANEL_GAP,
    Math.max(MARGIN, window.innerHeight - TASKS_PANEL_MIN_H - MARGIN),
  );
  const tasksPanelStyle = {
    top: `${MARGIN}px`,
    right: `${MARGIN}px`,
    bottom: `${tasksPanelBottom}px`,
    left: 'auto',
  };

  const hoverOutline =
    selecting && hovered && !picked ? (
      <ElementOutline element={hovered} label={hoverLabel ?? undefined} />
    ) : null;
  const pickedOutline = picked ? <ElementOutline element={picked.element} /> : null;

  return (
    <>
      <style>{`
        @keyframes iris-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      {/* First child so every other piece of overlay chrome paints above it. */}
      {blockInteractions ? <InteractionShield /> : null}
      <Pill
        active={armed}
        theme={theme}
        onArm={() => controllerRef.current?.arm()}
        onDisarm={() => controllerRef.current?.disarm()}
        onChat={() => {
          setShowSettings(false);
          setChatOpen((o) => !o);
        }}
        onSettings={() => {
          setChatOpen(false);
          setShowSettings((s) => !s);
        }}
        positionStyle={pillPositionStyle}
        onDragStart={onPillDragStart}
      />
      {hoverOutline}
      {pickedOutline}
      {picked ? (
        <PickedPopover
          element={picked.element}
          resolution={picked.resolution}
          theme={theme}
          gitAvailable={state.capabilities?.git ?? true}
          onClose={closePopover}
          onSubmit={async (annotation) => {
            await send(annotation);
          }}
        />
      ) : null}
      {/* Chat composer: the element-less mode of PickedPopover (no `element` →
          floats just above the pill, submits a general annotation). Opened by the
          pill's chat button. */}
      {chatOpen ? (
        <PickedPopover
          theme={theme}
          gitAvailable={state.capabilities?.git ?? true}
          anchorStyle={panelAnchorStyle}
          onClose={() => setChatOpen(false)}
          onSubmit={async (annotation) => {
            await send(annotation);
          }}
        />
      ) : null}
      <TaskPanel
        tasks={state.tasks}
        logs={state.logs}
        transcripts={state.transcripts}
        theme={theme}
        onCancel={(id) => void cancel(id)}
        onSendMessage={(id, text, opts) => sendMessage(id, text, opts)}
        onOpenChat={(id) => void fetchTranscript(id)}
        onRetry={(id) => retry(id).then(() => undefined)}
        worktrees={state.worktrees}
        remoteAvailable={state.capabilities?.remote ?? true}
        onShip={ship}
        onCreatePr={(slug) => createPr(slug)}
        onDiscard={discard}
        open={tasksOpen}
        onOpenChange={openTasksPanel}
        showLauncher={!inShell}
        launcherStyle={tasksLauncherStyle}
        anchorStyle={tasksPanelStyle}
      />
      {showSettings ? (
        <SettingsPanel
          theme={theme}
          anchorStyle={panelAnchorStyle}
          onClose={() => setShowSettings(false)}
          onToggleTheme={() => setThemeOverride(theme === 'dark' ? 'light' : 'dark')}
          blockInteractions={blockInteractions}
          onToggleBlockInteractions={toggleBlockInteractions}
          auth={state.auth}
          onLogin={login}
          onLogout={logout}
          onSaveKey={saveApiKey}
        />
      ) : null}
    </>
  );
}

// Tags whose short text content is worth quoting in the leaf descriptor.
const TEXTY_TAGS = /^(h1|h2|h3|h4|h5|h6|button|a|label|p|li|summary)$/;

/**
 * Build the hover chip's label live from the React/Preact fiber. Uses only the
 * cheap fiber walk (collectComponentPath) — NOT the dispatcher probe in
 * resolveSource — since this runs on every hovered-element change. The component
 * path comes back innermost-first, so we reverse it to read outermost→innermost
 * as a breadcrumb (`<Gallery> <Section>`).
 */
function describeHover(el: Element): OutlineLabel {
  const fiber = getFiberFromDom(el);
  const path = fiber ? collectComponentPath(fiber) : [];
  return { path: [...path].reverse(), leaf: describeLeaf(el) };
}

function describeLeaf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (TEXTY_TAGS.test(tag)) {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return `${tag} "${text.length > 24 ? `${text.slice(0, 24)}…` : text}"`;
  }
  return tag;
}

/** Track the host page's color scheme so the overlay matches dark/light sites. */
function usePrefersColorScheme(): OverlayTheme {
  const [theme, setTheme] = useState<OverlayTheme>('dark');
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setTheme(mq.matches ? 'light' : 'dark');
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return theme;
}
