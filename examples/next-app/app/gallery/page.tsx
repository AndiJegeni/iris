'use client';

import { ElementOutline } from '@localagents/overlay/ui/element-outline';
import { PickedPopover } from '@localagents/overlay/ui/picked-popover';
import { Pill } from '@localagents/overlay/ui/pill';
import { TaskChat } from '@localagents/overlay/ui/task-chat';
import { TaskPanel } from '@localagents/overlay/ui/task-panel';
import type { Task, TranscriptEntry } from '@localagents/shared';
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Mount any Preact component into a div managed by React.
// Re-renders Preact when props identity changes.
//
// `source` pins the real source file via `data-localagents-source`, so
// Alt+clicking the rendered component resolves to e.g. packages/overlay/src/ui/
// pill.tsx instead of this wrapper. (resolveSource prefers that attribute.)
function PreactMount({
  component,
  props,
  source,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: bridge between preact + react
  component: any;
  // biome-ignore lint/suspicious/noExplicitAny: bridge between preact + react
  props: any;
  source: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    render(h(component, props), el);
    return () => {
      render(null, el);
    };
  }, [component, props]);
  return (
    <div
      ref={ref}
      data-localagents-source={source}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  );
}

// Card frame. The transform: translateZ(0) establishes a CSS containing block
// so children with `position: fixed` are anchored to this frame instead of the
// viewport — the Pill docks bottom-right and the TaskPanel button top-right of the frame.
function Frame({
  label,
  hint,
  height = 180,
  children,
}: {
  label: string;
  hint?: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 6,
          gap: 8,
        }}
      >
        <div
          style={{
            color: 'var(--ga-label)',
            fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {label}
        </div>
        {hint ? (
          <div style={{ color: 'var(--ga-hint)', fontSize: 10, textAlign: 'right' }}>{hint}</div>
        ) : null}
      </div>
      <div
        style={{
          position: 'relative',
          height,
          background: 'var(--ga-frame-bg)',
          border: '1px solid var(--ga-frame-border)',
          borderRadius: 8,
          overflow: 'hidden',
          transform: 'translateZ(0)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  columns = 2,
  minColWidth,
}: {
  title: string;
  children: ReactNode;
  columns?: number;
  /** When set, columns are responsive (auto-fit) and never shrink below this
   *  width — used by PickedPopover so its fixed 360px never clips. */
  minColWidth?: number;
}) {
  const gridTemplateColumns = minColWidth
    ? `repeat(auto-fit, minmax(${minColWidth}px, 1fr))`
    : `repeat(${columns}, minmax(0, 1fr))`;
  return (
    <section style={{ marginBottom: 56 }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ga-muted)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 16,
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns, gap: 16 }}>{children}</div>
    </section>
  );
}

// A fake DOM element whose getBoundingClientRect returns a fixed rect.
// Lets us drive ElementOutline / PickedPopover anchoring deterministically.
function fakeElement(rect: { top: number; left: number; width: number; height: number }): Element {
  const el = document.createElement('div');
  const r = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() {
      return this;
    },
  } as unknown as DOMRect;
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => r });
  return el;
}

function makeTask(partial: Partial<Task>): Task {
  const now = Date.now();
  return {
    id: Math.random().toString(36).slice(2),
    worktreeSlug: 'main',
    backend: 'claude',
    prompt: 'Make the hero headline tighter',
    source: null,
    status: 'running',
    createdAt: now - 1000,
    updatedAt: now,
    ...partial,
  };
}

type ThemeName = 'dark' | 'light';

// Gallery chrome + frame-canvas tokens, exposed as CSS variables on <main>.
// Note: the overlay components themselves have fixed colors (they're the product
// and must read on any host page) — the theme only swaps the gallery scaffolding
// and each frame's canvas, so you can preview a component on white vs dark.
const THEMES = {
  dark: {
    '--ga-page-bg': '#0a0a0a',
    '--ga-text': '#f4f4f5',
    '--ga-muted': '#a1a1aa',
    '--ga-label': '#e4e4e7',
    '--ga-hint': '#71717a',
    '--ga-frame-bg': '#050507',
    '--ga-frame-border': '#27272a',
    '--ga-target-border': 'rgba(255, 255, 255, 0.18)',
    '--ga-target-bg': 'rgba(255, 255, 255, 0.02)',
    '--ga-banner-text': '#bfdbfe',
    '--ga-banner-code-bg': 'rgba(255, 255, 255, 0.07)',
  },
  light: {
    '--ga-page-bg': '#f4f4f5',
    '--ga-text': '#18181b',
    '--ga-muted': '#52525b',
    '--ga-label': '#27272a',
    '--ga-hint': '#a1a1aa',
    '--ga-frame-bg': '#ffffff',
    '--ga-frame-border': '#e4e4e7',
    '--ga-target-border': 'rgba(0, 0, 0, 0.18)',
    '--ga-target-bg': 'rgba(0, 0, 0, 0.02)',
    '--ga-banner-text': '#1e40af',
    '--ga-banner-code-bg': 'rgba(0, 0, 0, 0.06)',
  },
} satisfies Record<ThemeName, Record<string, string>>;

export default function Gallery() {
  // Defer everything until client mount — fake DOM elements + Preact rendering
  // are not SSR-safe.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [theme, setTheme] = useState<ThemeName>('dark');
  // Paint the body too, so the margin around the centered <main> matches.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = THEMES[theme]['--ga-page-bg'];
    return () => {
      document.body.style.background = prev;
    };
  }, [theme]);

  if (!mounted) return null;

  // --- Pill variants ---
  const pillVariants: { label: string; active: boolean }[] = [
    { label: 'idle', active: false },
    { label: 'active', active: true },
  ];

  // --- ElementOutline variants ---
  const outlineVariants = [
    { label: 'small', rect: { top: 70, left: 50, width: 120, height: 32 } },
    { label: 'wide', rect: { top: 60, left: 40, width: 260, height: 48 } },
    { label: 'tall', rect: { top: 30, left: 60, width: 120, height: 130 } },
  ];

  // --- PickedPopover variants ---
  // Build fake target elements positioned so the popover anchors near the top of the frame.
  const popoverVariants: {
    label: string;
    hint: string;
    confidence: 'high' | 'medium' | 'low' | 'none';
    source: { file: string; line: number; column?: number } | null;
    componentPath: string[];
    selector: string | null;
    nearbyText: string | null;
  }[] = [
    {
      label: 'high · _debugSource',
      hint: 'source + path',
      confidence: 'high',
      source: { file: 'app/page.tsx', line: 14, column: 9 },
      componentPath: ['Home', 'Card', 'Button'],
      selector: 'main > section.card > button.cta',
      nearbyText: 'Get started',
    },
    {
      label: 'medium · dispatcher probe',
      hint: 'source only',
      confidence: 'medium',
      source: { file: 'components/Hero.tsx', line: 42 },
      componentPath: ['Hero'],
      selector: 'header.hero > h1',
      nearbyText: 'localagents',
    },
    {
      label: 'low · selector only',
      hint: 'no source',
      confidence: 'low',
      source: null,
      componentPath: [],
      selector: 'main > section.grid > article:nth-child(2)',
      nearbyText: 'Queue tasks',
    },
    {
      label: 'none · no fiber',
      hint: 'fallback',
      confidence: 'none',
      source: null,
      componentPath: [],
      selector: 'div.unknown',
      nearbyText: null,
    },
  ];

  // --- TaskPanel data (background-tasks button + drawer) ---
  const now = Date.now();
  const panelTasks: Task[] = [
    makeTask({
      id: 'p1',
      status: 'running',
      prompt: 'Make the CTA button larger',
      message: 'patching globals.css',
      createdAt: now - 8000,
      updatedAt: now,
    }),
    makeTask({
      id: 'p2',
      status: 'editing',
      prompt: 'Reword the feature copy',
      backend: 'codex',
      message: 'rewriting paragraphs',
      createdAt: now - 24000,
      updatedAt: now - 500,
    }),
    makeTask({
      id: 'p3',
      status: 'done',
      prompt: 'Add a footer link',
      backend: 'echo',
      createdAt: now - 90000,
      updatedAt: now - 60000,
    }),
    makeTask({
      id: 'p4',
      status: 'failed',
      prompt: 'Refactor the routing layer',
      message: 'Error: cannot resolve @localagents/router',
      createdAt: now - 130000,
      updatedAt: now - 110000,
    }),
  ];
  const panelLogs: Record<string, string[]> = {
    p1: ['$ bun run build', 'Editing app/globals.css', 'Bumped .cta padding → 12px 22px'],
    p3: [
      'Echo received prompt: "Add a footer link"',
      'Would edit app/page.tsx:38',
      'Echo complete',
    ],
    p4: ['$ bun run typecheck', 'error: cannot resolve @localagents/router', 'Task failed'],
  };

  // --- TaskChat data (full structured transcript) ---
  const chatEntries: TranscriptEntry[] = [
    { id: 'u1', role: 'user', at: now, text: 'Make the CTA button larger and add a subtle shadow' },
    {
      id: 't1',
      role: 'thinking',
      at: now,
      durationMs: 9000,
      text: 'The CTA is styled by `.cta` in app/globals.css. I should bump its padding and add a soft box-shadow so it reads larger without breaking the card layout.',
    },
    {
      id: 'b1',
      role: 'tool',
      at: now,
      toolName: 'Bash',
      toolInput: '$ rg "\\.cta" app/globals.css',
      toolStatus: 'ok',
      toolOutput: 'app/globals.css:42:.cta { padding: 8px 16px; border-radius: 8px; }',
      durationMs: 320,
    },
    {
      id: 'e1',
      role: 'tool',
      at: now,
      toolName: 'Edit',
      toolInput: 'app/globals.css',
      toolStatus: 'ok',
      toolOutput: 'Updated .cta: padding 12px 22px; box-shadow: 0 4px 14px rgba(0,0,0,0.12)',
      durationMs: 110,
    },
    {
      id: 'a1',
      role: 'assistant',
      at: now,
      text: 'Bumped the CTA padding to 12px 22px and added a soft shadow. It now reads larger and lifts off the card.',
    },
    { id: 'r1', role: 'result', at: now, text: 'Edited app/globals.css', durationMs: 14200 },
  ];
  const panelTranscripts: Record<string, TranscriptEntry[]> = { p1: chatEntries };
  const chatTask = makeTask({
    id: 'chat',
    status: 'done',
    prompt: 'Make the CTA button larger and add a subtle shadow',
    backend: 'claude',
    createdAt: now - 15000,
    updatedAt: now - 800,
  });
  const chatTabs = [
    {
      id: 'chat',
      title: 'Make the CTA button larger and add a subtle shadow',
      status: 'done' as const,
    },
    { id: 'p1', title: 'Reword the feature copy', status: 'running' as const },
    { id: 'p2', title: 'Add a footer link', status: 'editing' as const },
  ];
  const chatSurface = theme === 'dark' ? '#161619' : '#ffffff';
  const chatBorder = theme === 'dark' ? '#27272a' : '#e4e4e7';

  return (
    <main
      style={
        {
          ...THEMES[theme],
          maxWidth: 1200,
          margin: '0 auto',
          padding: '48px 32px 96px',
          background: 'var(--ga-page-bg)',
          color: 'var(--ga-text)',
          fontFamily:
            'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        } as CSSProperties
      }
    >
      <button
        type="button"
        onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 50,
          padding: '6px 12px',
          background: 'var(--ga-frame-bg)',
          color: 'var(--ga-text)',
          border: '1px solid var(--ga-frame-border)',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        title="Toggle gallery light / dark"
      >
        {theme === 'dark' ? '☀︎ Light' : '☾ Dark'}
      </button>

      <header style={{ marginBottom: 48 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}
        >
          UI gallery
        </h1>
        <p style={{ color: 'var(--ga-muted)', fontSize: 14 }}>
          Every overlay component in its main states, plus the example page chrome. Refer to
          variants by the label above each frame (e.g. &ldquo;Pill / active · connected&rdquo;).
        </p>

        <div
          style={{
            marginTop: 20,
            padding: '12px 14px',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 8,
            color: 'var(--ga-banner-text)',
            fontSize: 13,
            lineHeight: 1.5,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1.3 }}>⌥</span>
          <span>
            Dogfooding: hold <strong>Alt</strong> and click any component below to edit it with
            localagents. The overlay components are pinned to their real source via{' '}
            <code
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                background: 'var(--ga-banner-code-bg)',
                padding: '1px 5px',
                borderRadius: 4,
              }}
            >
              data-localagents-source
            </code>
            , so your prompt ships straight to{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
              packages/overlay/src/ui/
            </code>{' '}
            — not this gallery wrapper.
          </span>
        </div>
      </header>

      <Section title="Pill" columns={3}>
        {pillVariants.map((v) => (
          <Frame key={v.label} label={`Pill / ${v.label}`} height={140}>
            <PreactMount
              component={Pill}
              props={{ active: v.active, onArm: () => {}, onDisarm: () => {} }}
              source="packages/overlay/src/ui/pill.tsx"
            />
          </Frame>
        ))}
      </Section>

      <Section title="ElementOutline" columns={3}>
        {outlineVariants.map((v) => (
          <Frame
            key={v.label}
            label={`ElementOutline / ${v.label}`}
            height={200}
            hint="outline tracks the dashed target"
          >
            {/* Visible target so you can compare outline alignment */}
            <div
              style={{
                position: 'absolute',
                top: v.rect.top,
                left: v.rect.left,
                width: v.rect.width,
                height: v.rect.height,
                border: '1px dashed var(--ga-target-border)',
                borderRadius: 2,
                background: 'var(--ga-target-bg)',
                color: 'var(--ga-hint)',
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              target
            </div>
            <PreactMount
              component={ElementOutline}
              props={{ element: fakeElement(v.rect) }}
              source="packages/overlay/src/ui/element-outline.tsx"
            />
          </Frame>
        ))}
      </Section>

      <Section title="PickedPopover" minColWidth={420}>
        {popoverVariants.map((v) => {
          // Target rect chosen so the popover anchors visibly inside the frame.
          const targetRect = { top: 20, left: 16, width: 140, height: 32 };
          const el = fakeElement(targetRect);
          const resolution = {
            source: v.source,
            selector: v.selector,
            componentPath: v.componentPath,
            text: v.nearbyText,
            confidence: v.confidence,
          };
          return (
            <Frame key={v.label} label={`PickedPopover / ${v.label}`} height={360} hint={v.hint}>
              {/* Show the would-be target so the popover anchor reads naturally */}
              <div
                style={{
                  position: 'absolute',
                  top: targetRect.top,
                  left: targetRect.left,
                  width: targetRect.width,
                  height: targetRect.height,
                  border: '1px dashed var(--ga-target-border)',
                  borderRadius: 2,
                  color: 'var(--ga-hint)',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                target
              </div>
              <PreactMount
                component={PickedPopover}
                props={{
                  element: el,
                  resolution,
                  theme,
                  onClose: () => {},
                  onSubmit: async () => {},
                }}
                source="packages/overlay/src/ui/picked-popover.tsx"
              />
            </Frame>
          );
        })}
      </Section>

      <Section title="TaskPanel" columns={1}>
        {/* Constrain width so the 400px drawer (anchored to the frame's right
            edge) stays fully in view, instead of docking far off to the side. */}
        <div style={{ maxWidth: 480 }}>
          <Frame
            label="TaskPanel / background-tasks button + drawer"
            height={540}
            hint="click the button at the frame's top-right to open the panel"
          >
            <PreactMount
              component={TaskPanel}
              props={{
                tasks: panelTasks,
                logs: panelLogs,
                transcripts: panelTranscripts,
                theme,
                onCancel: () => {},
                onSendMessage: async () => {},
                onOpenChat: () => {},
              }}
              source="packages/overlay/src/ui/task-panel.tsx"
            />
          </Frame>
        </div>
      </Section>

      <Section title="TaskChat" columns={1}>
        <div style={{ maxWidth: 480 }}>
          <Frame
            label="TaskChat / full transcript + composer"
            height={560}
            hint="open via 'View transcript' on a task; supports follow-up messages"
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: chatSurface,
                border: `1px solid ${chatBorder}`,
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <PreactMount
                component={TaskChat}
                props={{
                  task: chatTask,
                  tabs: chatTabs,
                  entries: chatEntries,
                  logsFallback: [],
                  theme,
                  busy: false,
                  onBack: () => {},
                  onSelectTab: () => {},
                  onCloseTab: () => {},
                  onSend: async () => {},
                }}
                source="packages/overlay/src/ui/task-chat.tsx"
              />
            </div>
          </Frame>
        </div>
      </Section>

      <Section title="Example page chrome" columns={1}>
        <Frame label="Page / hero + card + feature grid + footer" height={720}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'auto',
              background: '#0a0a0a',
            }}
          >
            <main className="page">
              <header className="hero">
                <h1>localagents</h1>
                <p className="tag">Hold Alt and click an element to start.</p>
              </header>

              <section className="card">
                <h2>Pricing</h2>
                <p>Start free. Upgrade when you ship.</p>
                <button type="button" className="cta">
                  Get started
                </button>
              </section>

              <section className="grid">
                <article className="feature">
                  <h3>Click anything</h3>
                  <p>Outline the element you want changed.</p>
                </article>
                <article className="feature">
                  <h3>Queue tasks</h3>
                  <p>Send prompts without leaving the tab.</p>
                </article>
                <article className="feature">
                  <h3>Compare branches</h3>
                  <p>Flip between agent worktrees live.</p>
                </article>
              </section>

              <footer className="footer">
                <small>made with localagents</small>
              </footer>
            </main>
          </div>
        </Frame>
      </Section>

      {/* Keyframe used by TaskPanel running-dot pulse animation */}
      <style>{`
        @keyframes localagents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </main>
  );
}
