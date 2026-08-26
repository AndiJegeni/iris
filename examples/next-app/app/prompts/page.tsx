'use client';

import { TaskChat } from '@iris/overlay/ui/task-chat';
import { SURFACE_PALETTE } from '@iris/overlay/ui/theme';
import type { Task, TranscriptEntry } from '@iris/shared';
import { h, render } from 'preact';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type Theme = 'light' | 'dark';

// Mount a Preact component (the overlay is Preact) into a React-managed div.
function PreactMount({
  component,
  props,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: preact/react bridge
  component: any;
  // biome-ignore lint/suspicious/noExplicitAny: preact/react bridge
  props: any;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    render(h(component, props), el);
    return () => render(null, el);
  }, [component, props]);
  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}

// A TaskChat wired to local state so the flow is clickable: answering records the
// choice as a turn and advances a batch until every question is answered, exactly
// as the daemon does once it delivers the answer. ↺ replays.
function InteractiveChat({
  task: initialTask,
  entries: initialEntries,
  theme,
}: {
  task: Task;
  entries: TranscriptEntry[];
  theme: Theme;
}) {
  const [task, setTask] = useState<Task>(initialTask);
  const [entries, setEntries] = useState<TranscriptEntry[]>(initialEntries);
  const onSend = async (text: string) => {
    setEntries((e) => [...e, { id: `ans-${e.length}`, role: 'user', at: Date.now(), text }]);
    setTask((t) => {
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

function makeTask(partial: Partial<Task>): Task {
  const now = Date.now();
  return {
    id: Math.random().toString(36).slice(2),
    worktreeSlug: 'main',
    backend: 'claude',
    prompt: '',
    source: null,
    status: 'awaiting-input',
    createdAt: now - 8000,
    updatedAt: now,
    ...partial,
  };
}

const now = Date.now();

// A multiple-choice question — two in the batch, so the 1/2 progress pill shows.
const questionEntries: TranscriptEntry[] = [
  { id: 'q-u', role: 'user', at: now, text: 'Wire up the newsletter signup form' },
  {
    id: 'q-t',
    role: 'thinking',
    at: now,
    durationMs: 6000,
    text: 'There is no backend for signups yet, so I should ask where they ought to go before wiring the form to anything.',
  },
];
const questionTask = makeTask({
  id: 'qflow',
  prompt: 'Wire up the newsletter signup form',
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

// A permission prompt — the compact approve/deny card for a gated tool.
const permissionEntries: TranscriptEntry[] = [
  { id: 'p-u', role: 'user', at: now, text: 'Make the CTA bigger, then run the tests' },
  {
    id: 'p-e',
    role: 'tool',
    at: now,
    toolName: 'Edit',
    toolInput: 'app/globals.css',
    toolStatus: 'ok',
    toolOutput: 'Updated .cta: padding 12px 22px; box-shadow: 0 4px 14px rgba(0,0,0,0.12)',
    durationMs: 120,
  },
  {
    id: 'p-a',
    role: 'assistant',
    at: now,
    text: 'Bumped the CTA padding and added a soft shadow. Now running the test suite to confirm nothing broke.',
  },
];
const permissionTask = makeTask({
  id: 'pflow',
  prompt: 'Make the CTA bigger, then run the tests',
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

function Frame({ label, theme, children }: { label: string; theme: Theme; children: ReactNode }) {
  const p = SURFACE_PALETTE[theme];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          color: p.soft,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: 'relative',
          height: 560,
          border: `1px solid ${p.stroke}`,
          borderRadius: 10,
          overflow: 'hidden',
          background: p.surface,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function PromptsPage() {
  const [theme, setTheme] = useState<Theme>('light');
  const page = theme === 'dark' ? '#0a0a0a' : '#fafafa';
  const ink = theme === 'dark' ? '#f5f5f5' : '#373734';
  return (
    <main
      style={
        {
          minHeight: '100vh',
          background: page,
          color: ink,
          padding: '40px 32px 96px',
          fontFamily:
            'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          letterSpacing: '-0.01em',
        } as CSSProperties
      }
    >
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 28,
            gap: 16,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
              Agent questions &amp; permission prompts
            </h1>
            <p style={{ fontSize: 14, opacity: 0.6, margin: '6px 0 0' }}>
              Click an option or the buttons — the cards are live. ↺ resets each one.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}
            style={{
              flex: 'none',
              fontSize: 13,
              padding: '7px 14px',
              borderRadius: 8,
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
              background: 'transparent',
              color: ink,
              cursor: 'pointer',
            }}
          >
            {theme === 'dark' ? '☀︎ Light' : '☾ Dark'}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: 24,
          }}
        >
          <Frame label="Asking a question — multiple choice" theme={theme}>
            <InteractiveChat task={questionTask} entries={questionEntries} theme={theme} />
          </Frame>
          <Frame label="Asking permission — Bash command" theme={theme}>
            <InteractiveChat task={permissionTask} entries={permissionEntries} theme={theme} />
          </Frame>
        </div>
      </div>
    </main>
  );
}
