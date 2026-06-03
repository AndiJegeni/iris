/** @jsxImportSource preact */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { type SelectModeController, startSelectMode } from './select-mode';
import {
  type Resolution,
  collectComponentPath,
  getFiberFromDom,
  resolveSource,
} from './source-map';
import { ElementOutline, type OutlineLabel } from './ui/element-outline';
import { PickedPopover } from './ui/picked-popover';
import { Pill } from './ui/pill';
import { SettingsPanel } from './ui/settings-panel';
import { TaskPanel } from './ui/task-panel';
import type { OverlayTheme } from './ui/theme';
import { useTransport } from './use-transport';

type PickState = {
  element: Element;
  resolution: Resolution;
};

type PillPos = { left: number; top: number };
type DragState = {
  startX: number;
  startY: number;
  origLeft: number;
  origTop: number;
  w: number;
  h: number;
  moved: boolean;
};

// Pixels the pointer must travel before a press becomes a drag (vs. a click).
const DRAG_THRESHOLD = 4;
// Keep the pill this far from the viewport edges while dragging.
const MARGIN = 8;
const PILL_POS_KEY = 'localagents:pill-pos';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Restore the dragged pill position, clamped into the current viewport. */
function loadPillPos(): PillPos | null {
  try {
    const raw = localStorage.getItem(PILL_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PillPos;
    if (typeof p?.left !== 'number' || typeof p?.top !== 'number') return null;
    return {
      left: clamp(p.left, MARGIN, window.innerWidth - MARGIN),
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
  const [pillPos, setPillPos] = useState<PillPos | null>(loadPillPos);
  const dragRef = useRef<DragState | null>(null);
  const controllerRef = useRef<SelectModeController | null>(null);
  // Theme follows the host page's color scheme, but the Settings panel can
  // override it (null = follow the system preference).
  const systemTheme = usePrefersColorScheme();
  const [themeOverride, setThemeOverride] = useState<OverlayTheme | null>(null);
  const theme = themeOverride ?? systemTheme;
  const { state, send, cancel, retry, sendMessage, fetchTranscript } = useTransport();

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

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't swallow Esc inside textareas/inputs unless they're empty —
      // but we WANT Esc to close the popover. Keep simple for v0.
      if (e.key === 'Escape') closePopover();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picked, closePopover]);

  // Escape closes the chat composer / settings panel (whichever is open).
  useEffect(() => {
    if (!chatOpen && !showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setChatOpen(false);
      setShowSettings(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [chatOpen, showSettings]);

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
      origLeft: rect.left,
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
      const left = clamp(d.origLeft + dx, MARGIN, window.innerWidth - d.w - MARGIN);
      const top = clamp(d.origTop + dy, MARGIN, window.innerHeight - d.h - MARGIN);
      setPillPos({ left, top });
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

  const pillPositionStyle = pillPos
    ? { top: `${pillPos.top}px`, left: `${pillPos.left}px`, right: 'auto', bottom: 'auto' }
    : undefined;

  const hoverOutline =
    selecting && hovered && !picked ? (
      <ElementOutline element={hovered} label={hoverLabel ?? undefined} />
    ) : null;
  const pickedOutline = picked ? <ElementOutline element={picked.element} /> : null;

  return (
    <>
      <style>{`
        @keyframes localagents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
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
          onClose={closePopover}
          onSubmit={async (annotation) => {
            await send(annotation);
          }}
        />
      ) : null}
      {/* Chat composer: the element-less mode of PickedPopover (no `element` →
          anchors bottom-right, submits a general annotation). Opened by the
          pill's chat button. The Background Tasks drawer below is separate and
          self-manages via its own launcher. */}
      {chatOpen ? (
        <PickedPopover
          theme={theme}
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
        onSendMessage={(id, text) => sendMessage(id, text)}
        onOpenChat={(id) => void fetchTranscript(id)}
        onRetry={(id) => void retry(id)}
      />
      {showSettings ? (
        <SettingsPanel
          theme={theme}
          onClose={() => setShowSettings(false)}
          onToggleTheme={() => setThemeOverride(theme === 'dark' ? 'light' : 'dark')}
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
 * like Agentation's breadcrumb (`<Gallery> <Section>`).
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
