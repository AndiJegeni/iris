'use client';

import { ElementOutline } from '@iris/overlay/ui/element-outline';
import { PickedPopover } from '@iris/overlay/ui/picked-popover';
import { Pill } from '@iris/overlay/ui/pill';
import { SettingsPanel } from '@iris/overlay/ui/settings-panel';
import { TaskChat } from '@iris/overlay/ui/task-chat';
import { TaskPanel } from '@iris/overlay/ui/task-panel';
import { taskPanelCss } from '@iris/overlay/ui/task-panel.styles';
import { TaskRow, type WorktreeAction } from '@iris/overlay/ui/task-row';
import { SURFACE_PALETTE } from '@iris/overlay/ui/theme';
import type { AuthStatus, ProviderAuthStatus, Task, TranscriptEntry } from '@iris/shared';
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Mount any Preact component into a div managed by React.
// Re-renders Preact when props identity changes.
//
// `source` pins the real source file via `data-iris-source`, so
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
      data-iris-source={source}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  );
}

// Card frame. The transform: translateZ(0) establishes a CSS containing block
// so children with `position: fixed` are anchored to this frame instead of the
// viewport — the Pill and the TaskPanel launcher both dock bottom-right of the frame.
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

/**
 * A TaskChat wired to local state so the question / permission flow is clickable
 * in the gallery. The task starts in `awaiting-input` carrying a PendingQuestion,
 * which is exactly what makes the real QuestionCard appear. Answering (clicking
 * an option, or typing a reply) clears the question and drops the choice in as a
 * user turn — the same thing the daemon does once it delivers the answer to the
 * agent. The ↺ button restores the pending state so the flow can be replayed.
 */
function InteractiveChat({
  task: initialTask,
  entries: initialEntries,
  theme,
}: {
  task: Task;
  entries: TranscriptEntry[];
  theme: ThemeName;
}) {
  const [task, setTask] = useState<Task>(initialTask);
  const [entries, setEntries] = useState<TranscriptEntry[]>(initialEntries);
  const onSend = async (text: string) => {
    setEntries((e) => [...e, { id: `ans-${e.length}`, role: 'user', at: Date.now(), text }]);
    setTask((t) => {
      // Advance through a batch the way the daemon does: record the answer
      // against the current unanswered question and stay in awaiting-input until
      // every question has one, then finish.
      const pending = t.question;
      if (pending) {
        const current = pending.questions.find((q) => pending.answers[q.question] === undefined);
        const answers = current
          ? { ...pending.answers, [current.question]: text }
          : pending.answers;
        if (pending.questions.some((q) => answers[q.question] === undefined)) {
          return { ...t, question: { ...pending, answers } };
        }
      }
      return { ...t, status: 'done', question: undefined };
    });
  };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PreactMount
        component={TaskChat}
        props={{
          task,
          tabs: [{ id: task.id, title: task.prompt, status: task.status }],
          entries,
          logsFallback: [],
          theme,
          busy: false,
          onBack: () => {},
          onSelectTab: () => {},
          onCloseTab: () => {},
          onSend,
        }}
        source="packages/overlay/src/ui/task-chat.tsx"
      />
      <button
        type="button"
        onClick={() => {
          setTask(initialTask);
          setEntries(initialEntries);
        }}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 5,
          fontSize: 11,
          padding: '3px 9px',
          borderRadius: 6,
          border: '1px solid rgba(128,128,128,0.4)',
          background: 'rgba(128,128,128,0.12)',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        ↺ reset
      </button>
    </div>
  );
}

/**
 * A TaskRow on the drawer's own surface, at the drawer's own width.
 *
 * The row is the real component with the real class names, so it needs the
 * drawer's stylesheet to look like itself — `taskPanelCss` is rendered once for
 * the whole page (see Gallery) rather than copied here, because a copy would
 * drift and this section's entire job is to be trustworthy about how a row looks.
 */
function RowStage({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  const p = SURFACE_PALETTE[theme];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        justifyContent: 'center',
        padding: 12,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          width: 356, // DRAWER_WIDTH (380) less its 12px gutters
          alignSelf: 'flex-start',
          background: p.surface,
          border: `1px solid ${p.stroke}`,
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Every worktree action wired to a no-op — spread, then override one field. */
const WT_IDLE: WorktreeAction = {
  available: true,
  canCreatePr: true,
  pending: false,
  onShip: () => {},
  onCreatePr: () => {},
  onDiscard: () => {},
};

/** AuthStatus with Codex left disconnected, so each frame shows a contrast pair. */
function authWith(anthropic: Partial<ProviderAuthStatus>): AuthStatus {
  return {
    anthropic: { method: 'none', configured: false, source: 'missing', ...anthropic },
    openai: { method: 'none', configured: false, source: 'missing' },
  };
}

type ThemeName = 'dark' | 'light';

// Gallery chrome + frame-canvas tokens, exposed as CSS variables on <main>.
// The overlay components are theme-aware (they take a `theme` prop, wired below),
// so this toggle swaps both the gallery scaffolding and the components themselves —
// letting you preview each one in light vs dark side by side.
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

  // Bumping this remounts the entrance-test popover, replaying its open animation.
  const [replayKey, setReplayKey] = useState(0);

  // Live spacing tokens for the playground — drive the popover's CSS variables.
  const [pad, setPad] = useState({ padX: 10, padT: 10, padB: 8, gap: 8 });

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
      nearbyText: 'iris',
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
      model: 'claude-opus-4-8',
      message: 'patching globals.css',
      createdAt: now - 8000,
      updatedAt: now,
    }),
    makeTask({
      id: 'p2',
      status: 'editing',
      prompt: 'Reword the feature copy',
      backend: 'codex',
      model: 'gpt-5.4',
      message: 'rewriting paragraphs',
      createdAt: now - 24000,
      updatedAt: now - 500,
    }),
    makeTask({
      id: 'p3',
      status: 'done',
      worktreeSlug: 'footer-link',
      prompt: 'Add a footer link',
      backend: 'echo',
      model: 'claude-haiku-4-5',
      createdAt: now - 90000,
      updatedAt: now - 60000,
    }),
    makeTask({
      id: 'p4',
      status: 'failed',
      worktreeSlug: 'routing',
      prompt: 'Refactor the routing layer',
      model: 'claude-sonnet-5',
      message: 'Error: cannot resolve @iris/router',
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
    p4: ['$ bun run typecheck', 'error: cannot resolve @iris/router', 'Task failed'],
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
  // Read from the overlay's own palette, never hand-picked here. This frame used
  // to paint #161619 / #27272a — lighter and bluer than the popover's card — so
  // the chat looked like a different surface in the gallery than in the product.
  // TaskChat paints its own background now; the frame only supplies the outline.
  const chatSurface = 'transparent';
  const chatBorder = SURFACE_PALETTE[theme].stroke;

  // --- Question flow (multiple-choice) + permission flow (Bash) ---
  // Both put the task in `awaiting-input` with a PendingQuestion, which is what
  // makes the real QuestionCard render inside TaskChat. The permission prompt is
  // just a question the worker synthesises for a gated tool (see ASK_TOOLS /
  // permissionHandler in claude-worker.ts): tool name as header, the command as
  // the body, and Allow / Allow-for-task / Deny as the options.
  const questionFlowEntries: TranscriptEntry[] = [
    { id: 'qf-u', role: 'user', at: now, text: 'Wire up the newsletter signup form' },
    {
      id: 'qf-t',
      role: 'thinking',
      at: now,
      durationMs: 6000,
      text: 'There is no backend for signups yet, so I should ask where they ought to go before wiring the form to anything.',
    },
  ];
  const questionFlowTask = makeTask({
    id: 'qflow',
    status: 'awaiting-input',
    prompt: 'Wire up the newsletter signup form',
    backend: 'claude',
    createdAt: now - 9000,
    updatedAt: now,
    question: {
      id: 'q1',
      questions: [
        {
          question: 'Where should newsletter signups go?',
          header: 'Signup sink',
          options: [
            { label: 'Console log for now', description: 'Stub it — wire a real endpoint later' },
            { label: 'POST to /api/subscribe', description: 'Create the route and call it' },
            { label: 'Mailchimp', description: 'Use the Mailchimp API (needs a key)' },
          ],
        },
        {
          question: 'How should the form report success?',
          header: 'Success UX',
          options: [
            { label: 'Inline message', description: 'Swap the form for a thank-you line' },
            { label: 'Toast', description: 'A dismissable toast in the corner' },
          ],
        },
      ],
      answers: {},
    },
  });

  const permissionFlowEntries: TranscriptEntry[] = [
    { id: 'pf-u', role: 'user', at: now, text: 'Make the CTA bigger, then run the tests' },
    {
      id: 'pf-e',
      role: 'tool',
      at: now,
      toolName: 'Edit',
      toolInput: 'app/globals.css',
      toolStatus: 'ok',
      toolOutput: 'Updated .cta: padding 12px 22px; box-shadow: 0 4px 14px rgba(0,0,0,0.12)',
      durationMs: 120,
    },
    {
      id: 'pf-a',
      role: 'assistant',
      at: now,
      text: 'Bumped the CTA padding and added a soft shadow. Now running the test suite to confirm nothing broke.',
    },
  ];
  const permissionFlowTask = makeTask({
    id: 'pflow',
    status: 'awaiting-input',
    prompt: 'Make the CTA bigger, then run the tests',
    backend: 'claude',
    createdAt: now - 12000,
    updatedAt: now,
    question: {
      id: 'perm1',
      questions: [
        {
          kind: 'permission',
          question: 'Run this command?',
          resource: 'npm test',
          header: 'Bash',
          options: [
            { label: 'Allow once', description: 'Run it this once' },
            { label: 'Allow for this task', description: "Don't ask again for Bash this run" },
            { label: 'Deny', description: 'Skip it — the agent continues without it' },
          ],
        },
      ],
      answers: {},
    },
  });

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
          letterSpacing: '-0.02em',
        } as CSSProperties
      }
    >
      {/* The drawer's own rules, so a TaskRow rendered outside TaskPanel (the
          row-states section) still hovers like the real thing. Rendered from the
          exported string rather than copied, so it can't drift. */}
      <style>{taskPanelCss(theme)}</style>
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
            iris. The overlay components are pinned to their real source via{' '}
            <code
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                background: 'var(--ga-banner-code-bg)',
                padding: '1px 5px',
                borderRadius: 4,
              }}
            >
              data-iris-source
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
              props={{
                active: v.active,
                theme,
                onArm: () => {},
                onDisarm: () => {},
              }}
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
            <Frame key={v.label} label={`PickedPopover / ${v.label}`} height={520} hint={v.hint}>
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

      <Section title="PickedPopover · entrance animation" columns={1}>
        {(() => {
          const targetRect = { top: 20, left: 16, width: 140, height: 32 };
          const el = fakeElement(targetRect);
          const resolution = {
            source: { file: 'app/page.tsx', line: 14, column: 9 },
            selector: 'main > section.card > button.cta',
            componentPath: ['Home', 'Card', 'Button'],
            text: 'Get started',
            confidence: 'high' as const,
          };
          return (
            <div style={{ maxWidth: 520 }}>
              <button
                type="button"
                onClick={() => setReplayKey((k) => k + 1)}
                style={{
                  marginBottom: 10,
                  padding: '7px 14px',
                  background: 'var(--ga-frame-bg)',
                  color: 'var(--ga-text)',
                  border: '1px solid var(--ga-frame-border)',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ↻ Replay entrance
              </button>
              <Frame
                label="PickedPopover / entrance"
                height={520}
                hint="click Replay to watch the open animation"
              >
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
                {/* key={replayKey} forces a remount on Replay, replaying the CSS
                    entrance animation from a fresh mount. */}
                <PreactMount
                  key={replayKey}
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
            </div>
          );
        })()}
      </Section>

      <Section title="PickedPopover · spacing playground" columns={1}>
        {(() => {
          const targetRect = { top: 20, left: 16, width: 140, height: 32 };
          const el = fakeElement(targetRect);
          const resolution = {
            source: { file: 'app/page.tsx', line: 14, column: 9 },
            selector: 'main > section.card > button.cta',
            componentPath: ['Home', 'Card', 'Button'],
            text: 'Get started',
            confidence: 'high' as const,
          };
          const sliders: { key: keyof typeof pad; label: string; min: number; max: number }[] = [
            { key: 'padX', label: 'Card padding · X', min: 0, max: 40 },
            { key: 'padT', label: 'Card padding · top', min: 0, max: 40 },
            { key: 'padB', label: 'Card padding · bottom', min: 0, max: 40 },
            { key: 'gap', label: 'Row gap', min: 0, max: 32 },
          ];
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
              {/* Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {sliders.map((s) => (
                  <label key={s.key} style={{ display: 'block' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 12,
                        color: 'var(--ga-label)',
                        marginBottom: 6,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      <span>{s.label}</span>
                      <span style={{ color: 'var(--ga-muted)' }}>{pad[s.key]}px</span>
                    </div>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      value={pad[s.key]}
                      onChange={(e) => setPad((p) => ({ ...p, [s.key]: Number(e.target.value) }))}
                      style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer' }}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setPad({ padX: 10, padT: 10, padB: 8, gap: 8 })}
                  style={{
                    marginTop: 4,
                    padding: '6px 12px',
                    background: 'var(--ga-frame-bg)',
                    color: 'var(--ga-text)',
                    border: '1px solid var(--ga-frame-border)',
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Reset to defaults
                </button>
                <div
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 11,
                    color: 'var(--ga-hint)',
                    lineHeight: 1.6,
                  }}
                >
                  padding: {pad.padT}px {pad.padX}px {pad.padB}px;
                  <br />
                  row-gap: {pad.gap}px;
                </div>
              </div>

              {/* Live popover — CSS vars on this wrapper cascade into it. */}
              <div
                style={
                  {
                    '--la-pp-pad-x': `${pad.padX}px`,
                    '--la-pp-pad-t': `${pad.padT}px`,
                    '--la-pp-pad-b': `${pad.padB}px`,
                    '--la-pp-gap': `${pad.gap}px`,
                  } as CSSProperties
                }
              >
                <Frame
                  label="PickedPopover / live"
                  height={340}
                  hint="drag the sliders to adjust spacing"
                >
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
              </div>
            </div>
          );
        })()}
      </Section>

      <Section title="Background tasks · panel" minColWidth={440}>
        {/* Constrain width so the 380px drawer (anchored to the frame's right
            edge) stays fully in view, instead of docking far off to the side. */}
        <Frame
          label="TaskPanel / launcher — idle"
          height={200}
          hint="the circle only exists once there's work; no badge with nothing running"
        >
          <PreactMount
            component={TaskPanel}
            props={{
              tasks: [makeTask({ id: 'l1', status: 'done' })],
              logs: {},
              theme,
              onCancel: () => {},
            }}
            source="packages/overlay/src/ui/task-panel.tsx"
          />
        </Frame>

        <Frame
          label="TaskPanel / launcher — running count"
          height={200}
          hint="the badge counts only queued + running + editing"
        >
          <PreactMount
            component={TaskPanel}
            props={{
              tasks: [
                makeTask({ id: 'l2', status: 'running' }),
                makeTask({ id: 'l3', status: 'editing' }),
                makeTask({ id: 'l4', status: 'done' }),
              ],
              logs: {},
              theme,
              onCancel: () => {},
            }}
            source="packages/overlay/src/ui/task-panel.tsx"
          />
        </Frame>

        <Frame label="TaskPanel / drawer — empty" height={300} hint="first run, nothing queued yet">
          <PreactMount
            component={TaskPanel}
            props={{
              tasks: [],
              logs: {},
              theme,
              defaultOpen: true,
              showLauncher: false,
              onCancel: () => {},
            }}
            source="packages/overlay/src/ui/task-panel.tsx"
          />
        </Frame>

        <Frame
          label="TaskPanel / drawer — Running + Finished"
          height={560}
          hint="click the layers circle to open; 'View chat' swaps the drawer into the transcript"
        >
          <PreactMount
            component={TaskPanel}
            props={{
              tasks: panelTasks,
              logs: panelLogs,
              transcripts: panelTranscripts,
              theme,
              defaultOpen: true,
              worktrees: [{ slug: 'footer-link' }, { slug: 'routing' }],
              onCancel: () => {},
              onSendMessage: async () => {},
              onOpenChat: () => {},
              onRetry: () => {},
              onShip: async () => {},
              onCreatePr: async () => ({ url: null, created: false }),
              onDiscard: async () => {},
            }}
            source="packages/overlay/src/ui/task-panel.tsx"
          />
        </Frame>
      </Section>

      {/* Every row state, driven directly rather than by clicking through the
          drawer. Most of these live in TaskPanel's internal per-row state
          (pending / prUrl / note / error), so they're unreachable from the
          outside — which is exactly why they were the least-reviewed pixels in
          the overlay and belong here. */}
      <Section title="Background tasks · row states" minColWidth={400}>
        {(
          [
            {
              label: 'queued',
              height: 120,
              hint: 'no model yet — nothing has started',
              task: { id: 'r1', status: 'queued', prompt: 'Tighten the hero headline' },
              props: {},
            },
            {
              label: 'awaiting input · needs you',
              height: 130,
              hint: 'blocked on a question / permission — amber dot, the way failed is red',
              task: {
                id: 'rq',
                status: 'awaiting-input',
                prompt: 'Wire up the newsletter signup form',
                model: 'claude-opus-5',
                question: {
                  id: 'gq',
                  questions: [
                    {
                      question: 'Where should newsletter signups go?',
                      header: 'Signup sink',
                      options: [
                        { label: 'Console log for now', description: '' },
                        { label: 'POST to /api/subscribe', description: '' },
                      ],
                    },
                  ],
                  answers: {},
                },
              },
              props: { onCancel: () => {} },
            },
            {
              label: 'running · Stop + View chat',
              height: 150,
              hint: 'Stop sits far right at 50% ink, lifting on hover',
              task: {
                id: 'r2',
                status: 'running',
                prompt: 'Make the CTA button larger',
                model: 'claude-opus-5',
              },
              props: { onCancel: () => {} },
            },
            {
              label: 'editing · live message',
              height: 150,
              hint: 'the status line becomes whatever the agent is doing',
              task: {
                id: 'r3',
                status: 'editing',
                prompt: 'Reword the feature copy',
                model: 'gpt-5.4',
                message: 'rewriting app/page.tsx',
              },
              props: { onCancel: () => {} },
            },
            {
              label: 'done · ran in your checkout',
              height: 120,
              hint: 'worktreeSlug "main" — no worktree, so nothing to land',
              task: {
                id: 'r4',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-haiku-4-5',
              },
              props: {},
            },
            {
              label: 'done · worktree',
              height: 175,
              hint: 'click Merge locally or Discard to see the "Sure?" confirm step',
              task: {
                id: 'r5',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-opus-5',
                worktreeSlug: 'footer-link',
              },
              props: { worktree: WT_IDLE },
            },
            {
              label: 'done · no git remote',
              height: 175,
              hint: 'Create PR disabled — nowhere to push. Merge locally still works',
              task: {
                id: 'r6',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-opus-5',
                worktreeSlug: 'footer-link',
              },
              props: { worktree: { ...WT_IDLE, canCreatePr: false } },
            },
            {
              label: 'done · request in flight',
              height: 175,
              hint: 'all three disabled while the push runs',
              task: {
                id: 'r7',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-opus-5',
                worktreeSlug: 'footer-link',
              },
              props: { worktree: { ...WT_IDLE, pending: true } },
            },
            {
              label: 'done · PR opened',
              height: 175,
              hint: 'the PR takes Create PR’s slot — a link the user clicks, never a popup',
              task: {
                id: 'r8',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-opus-5',
                worktreeSlug: 'footer-link',
              },
              props: {
                worktree: {
                  ...WT_IDLE,
                  prUrl: 'https://github.com/AndiJegeni/iris/pull/42',
                  prLabel: 'View PR',
                },
              },
            },
            {
              label: 'done · pushed, no gh',
              height: 220,
              hint: '"Open PR" not "View PR" — a compare page is a form, not a PR',
              task: {
                id: 'r9',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-opus-5',
                worktreeSlug: 'footer-link',
              },
              props: {
                worktree: {
                  ...WT_IDLE,
                  prUrl: 'https://github.com/AndiJegeni/iris/compare/la/footer-link',
                  prLabel: 'Open PR',
                  // "from Iris", not "from here" — the row now carries an Open PR
                  // pill, and telling someone they can't open a PR right next to
                  // a control that opens one is two messages fighting. It also
                  // matches what the orchestrator actually sends (pull-request.ts).
                  note: 'Pushed the branch. Install the GitHub CLI to open PRs from Iris.',
                },
              },
            },
            {
              label: 'done · action failed',
              height: 200,
              hint: 'the one place the drawer uses a hue, because failure must read as failure',
              task: {
                id: 'r10',
                status: 'done',
                prompt: 'Add a footer link',
                model: 'claude-opus-5',
                worktreeSlug: 'footer-link',
              },
              props: {
                worktree: {
                  ...WT_IDLE,
                  error: 'merge into main failed (resolve conflicts manually)',
                },
              },
            },
            {
              label: 'failed · Retry',
              height: 175,
              hint: 'the only row with a status dot; no Merge — a failed run has nothing to land',
              task: {
                id: 'r11',
                status: 'failed',
                prompt: 'Refactor the routing layer',
                model: 'claude-sonnet-5',
                message: 'Error: cannot resolve @iris/router',
                worktreeSlug: 'routing',
              },
              props: { onRetry: () => {}, worktree: WT_IDLE },
            },
            {
              label: 'cancelled',
              height: 150,
              hint: 'Discard only — you stopped it, so there is nothing to merge',
              task: {
                id: 'r12',
                status: 'cancelled',
                prompt: 'Rewrite the pricing table',
                model: 'claude-opus-5',
                worktreeSlug: 'pricing',
              },
              props: { worktree: WT_IDLE },
            },
          ] as const
        ).map((s) => (
          <Frame key={s.label} label={`TaskRow / ${s.label}`} height={s.height} hint={s.hint}>
            <RowStage theme={theme}>
              <PreactMount
                component={TaskRow}
                props={{
                  task: makeTask(s.task as Partial<Task>),
                  theme,
                  onOpenChat: () => {},
                  ...s.props,
                }}
                source="packages/overlay/src/ui/task-row.tsx"
              />
            </RowStage>
          </Frame>
        ))}
      </Section>

      <Section title="Toolbar · settings panel" minColWidth={440}>
        <Frame
          label="SettingsPanel / settings"
          height={340}
          hint="theme toggle drives this whole page; 'Accounts ›' opens the sub-view"
        >
          <PreactMount
            component={SettingsPanel}
            props={{
              theme,
              blockInteractions: true,
              auth: authWith({}),
              onClose: () => {},
              onToggleTheme: () => setTheme((tn) => (tn === 'dark' ? 'light' : 'dark')),
              onToggleBlockInteractions: () => {},
            }}
            source="packages/overlay/src/ui/settings-panel.tsx"
          />
        </Frame>

        {(
          [
            {
              label: 'not connected',
              hint: 'no accounts → the sign-in screen: one auto-detecting key field, logins below',
              anthropic: {},
            },
            {
              label: 'subscription connected',
              hint: 'the account list — a Claude row, plus "Add a new account"',
              anthropic: { method: 'oauth', configured: true, source: 'oauth' },
            },
            {
              label: 'API key set',
              hint: 'an API-key account row — Remove clears it',
              anthropic: { method: 'api-key', configured: true, source: 'config' },
            },
            {
              label: 'session expired',
              hint: 'a real run was rejected — red sub-line, Log in again',
              anthropic: { method: 'oauth', configured: true, source: 'oauth', expired: true },
            },
            {
              label: 'API key rejected',
              hint: 'Replace jumps back to the sign-in screen',
              anthropic: { method: 'api-key', configured: true, source: 'config', expired: true },
            },
          ] as const
        ).map((s) => (
          <Frame
            key={s.label}
            label={`SettingsPanel / accounts — ${s.label}`}
            height={430}
            hint={s.hint}
          >
            <PreactMount
              component={SettingsPanel}
              props={{
                theme,
                defaultView: 'accounts',
                auth: authWith(s.anthropic as Partial<ProviderAuthStatus>),
                onClose: () => {},
                onLogin: async () => {},
                onLogout: async () => {},
                onSaveKey: async () => {},
              }}
              source="packages/overlay/src/ui/settings-panel.tsx"
            />
          </Frame>
        ))}
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

      <Section title="Agent questions & permission prompts" columns={2}>
        <Frame
          label="Asking a question — multiple choice"
          height={560}
          hint="agent blocks on awaiting-input; click an option or type a reply"
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
            <InteractiveChat task={questionFlowTask} entries={questionFlowEntries} theme={theme} />
          </div>
        </Frame>
        <Frame
          label="Asking permission — Bash command"
          height={560}
          hint="new: Bash / network tools stop for Allow · Allow-for-task · Deny"
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
            <InteractiveChat
              task={permissionFlowTask}
              entries={permissionFlowEntries}
              theme={theme}
            />
          </div>
        </Frame>
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
                <h1>iris</h1>
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
                <small>made with iris</small>
              </footer>
            </main>
          </div>
        </Frame>
      </Section>

      {/* Keyframe used by TaskPanel running-dot pulse animation */}
      <style>{`
        @keyframes iris-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </main>
  );
}
