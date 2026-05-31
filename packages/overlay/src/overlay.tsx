/** @jsxImportSource preact */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { type SelectModeController, startSelectMode } from './select-mode';
import { type Resolution, resolveSource } from './source-map';
import { ElementOutline } from './ui/element-outline';
import { PickedPopover } from './ui/picked-popover';
import { Pill } from './ui/pill';
import { TaskPanel } from './ui/task-panel';
import type { OverlayTheme } from './ui/theme';
import { useTransport } from './use-transport';

type PickState = {
  element: Element;
  resolution: Resolution;
};

export function Overlay() {
  // `armed` is the sticky pill state; `selecting` is armed-or-Alt and drives hover outlines.
  const [armed, setArmed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [picked, setPicked] = useState<PickState | null>(null);
  const controllerRef = useRef<SelectModeController | null>(null);
  const theme = usePrefersColorScheme();
  const { state, send, cancel } = useTransport();

  useEffect(() => {
    const controller = startSelectMode({
      onSelectingChange: (s) => {
        setSelecting(s);
        if (!s) setHovered(null);
      },
      onArmedChange: setArmed,
      onHover: (el) => setHovered(el),
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

  const hoverOutline =
    selecting && hovered && !picked ? <ElementOutline element={hovered} /> : null;
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
        onArm={() => controllerRef.current?.arm()}
        onDisarm={() => controllerRef.current?.disarm()}
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
      <TaskPanel tasks={state.tasks} logs={state.logs} onCancel={(id) => void cancel(id)} />
    </>
  );
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
