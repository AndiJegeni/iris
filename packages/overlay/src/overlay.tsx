import { useEffect, useRef, useState } from 'preact/hooks';
import { startSelectMode, type SelectController } from './select-mode';
import { resolveSource, type Resolution } from './source-map';
import { ElementOutline } from './ui/element-outline';
import { PickedPopover } from './ui/picked-popover';
import { Pill } from './ui/pill';
import { TaskPanel } from './ui/task-panel';
import { useTransport } from './use-transport';

type SelectState = {
  active: boolean;
  hovered: Element | null;
};

type PickState = {
  element: Element;
  resolution: Resolution;
};

export function Overlay() {
  const [select, setSelect] = useState<SelectState>({ active: false, hovered: null });
  const [picked, setPicked] = useState<PickState | null>(null);
  const controllerRef = useRef<SelectController | null>(null);
  const { state, send, cancel } = useTransport();

  useEffect(() => {
    const controller = startSelectMode({
      onEnter: () => setSelect({ active: true, hovered: null }),
      onHover: (el) => setSelect((s) => (s.active ? { ...s, hovered: el } : s)),
      onCancel: () => setSelect({ active: false, hovered: null }),
      onPick: (el) => {
        const resolution = resolveSource(el);
        setSelect({ active: false, hovered: null });
        setPicked({ element: el, resolution });
      },
    });
    controllerRef.current = controller;
    return controller.dispose;
  }, []);

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't swallow Esc inside textareas/inputs unless they're empty —
      // but we WANT Esc to close the popover. Keep simple for v0.
      if (e.key === 'Escape') setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picked]);

  const hoverOutline =
    select.active && select.hovered ? <ElementOutline element={select.hovered} /> : null;
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
        active={select.active}
        connection={state.status}
        onToggle={() => controllerRef.current?.toggleSticky()}
      />
      {hoverOutline}
      {pickedOutline}
      {picked ? (
        <PickedPopover
          element={picked.element}
          resolution={picked.resolution}
          onClose={() => setPicked(null)}
          onSubmit={async (annotation) => {
            await send(annotation);
          }}
        />
      ) : null}
      <TaskPanel tasks={state.tasks} logs={state.logs} onCancel={(id) => void cancel(id)} />
    </>
  );
}
