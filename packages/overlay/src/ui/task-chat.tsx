/** @jsxImportSource preact */
import type { ReasoningEffort, Task, TranscriptEntry } from '@localagents/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_MODEL, EFFORTS, MODELS, ModelReasoningPicker } from './picked-popover';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

/** One open chat in the tab strip. */
export type ChatTab = { id: string; title: string; status: Task['status'] };

type TaskChatProps = {
  task: Task;
  /** Every open chat, shown as tabs in the header. */
  tabs: ChatTab[];
  /** Structured conversation; falls back to `logsFallback` when empty. */
  entries: TranscriptEntry[];
  logsFallback: string[];
  theme?: OverlayTheme;
  /** True while the task is running / a follow-up is in flight (composer locks). */
  busy?: boolean;
  onBack: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onSend: (text: string) => void | Promise<void>;
  onCancel?: () => void;
};

function formatDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return '<1s';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

/**
 * Full-conversation chat for a background task: user/assistant turns, thinking
 * ("Thought for Ns"), and tool calls with their inputs/outputs — the way Cursor
 * / Claude Code render a transcript — plus a composer to send follow-up
 * messages that resume the task's session. Theme-aware; fills its container.
 */
export function TaskChat({
  task,
  tabs,
  entries,
  logsFallback,
  theme = 'dark',
  busy = false,
  onBack,
  onSelectTab,
  onCloseTab,
  onSend,
  onCancel,
}: TaskChatProps) {
  const t = tokens(theme);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Model + reasoning for the follow-up — defaults to the task's model.
  const [model, setModel] = useState<string>(
    MODELS.some((m) => m.value === task.model) ? (task.model as string) : DEFAULT_MODEL,
  );
  const [effort, setEffort] = useState<ReasoningEffort>('high');
  const selectedModel = MODELS.find((m) => m.value === model) ?? MODELS[0];
  const effortOptions = EFFORTS[selectedModel.provider];
  const changeModel = (value: string) => {
    setModel(value);
    const next = MODELS.find((m) => m.value === value);
    if (next && !EFFORTS[next.provider].some((e) => e.value === effort)) setEffort('high');
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to the latest message as the transcript grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, logsFallback.length, busy]);

  // Grow the composer with its content up to 3 lines, then scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_H)}px`;
  }, [draft]);

  const locked = busy || sending;
  const canSend = !!draft.trim() && !locked;

  const submit = async () => {
    const text = draft.trim();
    if (!text || locked) return;
    setDraft('');
    setSending(true);
    try {
      await onSend(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={shell(t)}>
      <ChatTabBar
        tabs={tabs}
        activeId={task.id}
        t={t}
        theme={theme}
        onBack={onBack}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />

      <div ref={scrollRef} style={messageList}>
        {entries.length > 0
          ? entries.map((e) => <Entry key={e.id} entry={e} t={t} theme={theme} />)
          : logsFallback.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines are positional
              <div key={i} style={assistantText(t)}>
                {line}
              </div>
            ))}
        {busy ? <WorkingRow t={t} /> : null}
      </div>

      {/* Composer — mirrors the picked-popover card: input on top, a footer with
          the model · effort picker on the left and attach · send on the right. */}
      <div style={composerCard(t)}>
        <style>
          {'.la-pp-dim{opacity:0.6;transition:opacity 80ms}.la-pp-dim:hover{opacity:1}' +
            '.la-pp-menu-row{background:transparent;transition:background 80ms}' +
            '.la-pp-menu-row:hover{background:rgba(127,127,127,0.12)}'}
        </style>
        <textarea
          ref={inputRef}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder={busy ? 'Agent is working…' : 'Reply or ask a follow-up'}
          disabled={busy}
          style={composerInput(t)}
        />
        <div style={composerFooter}>
          <ModelReasoningPicker
            models={MODELS.map((m) => ({ value: m.value, label: m.label }))}
            model={model}
            onModelSelect={changeModel}
            effortOptions={effortOptions}
            effort={effort}
            onEffortSelect={(v) => setEffort(v as ReasoningEffort)}
            modelLabel={selectedModel.label}
            effortLabel={effortOptions.find((e) => e.value === effort)?.label ?? effort}
            t={t}
          />
          <div style={composerActions}>
            <button
              type="button"
              className="la-pp-dim"
              style={attachBtn(t)}
              onClick={() => inputRef.current?.focus()}
              aria-label="Add"
            >
              <PlusIcon />
            </button>
            {onCancel && busy ? (
              <button type="button" style={sendBtn(t)} onClick={onCancel} aria-label="Stop">
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                style={{ ...sendBtn(t), opacity: canSend ? 1 : 0.3 }}
                disabled={!canSend}
                onClick={() => void submit()}
                aria-label="Send"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The tabbed window header — an editor-style strip with every open chat. */
function ChatTabBar({
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
        <ChevronLeft />
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
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>
      <div style={tabActions}>
        <button type="button" style={tabIconBtn(t)} onClick={onBack} aria-label="Back to tasks">
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

function Entry({
  entry,
  t,
  theme,
}: {
  entry: TranscriptEntry;
  t: ThemeTokens;
  theme: OverlayTheme;
}) {
  switch (entry.role) {
    case 'user':
      return (
        <div style={userRow}>
          <div style={userBubble(t)}>{entry.text}</div>
        </div>
      );
    case 'assistant':
      return <div style={assistantText(t)}>{entry.text}</div>;
    case 'thinking':
      return <ThinkingRow entry={entry} t={t} />;
    case 'tool':
      return <ToolRow entry={entry} t={t} theme={theme} />;
    case 'result':
      return (
        <div style={resultRow(t)}>
          <CheckIcon />
          <span>{entry.text}</span>
          {entry.durationMs != null ? (
            <span style={{ color: t.textFaint }}>· {formatDuration(entry.durationMs)}</span>
          ) : null}
        </div>
      );
    case 'error':
      return <div style={errorRow}>{entry.text}</div>;
    default:
      return null;
  }
}

function ThinkingRow({ entry, t }: { entry: TranscriptEntry; t: ThemeTokens }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '2px 0' }}>
      <button type="button" style={thinkingHeader(t)} onClick={() => setOpen((o) => !o)}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-flex' }}>
          <ChevronRight />
        </span>
        <span>Thought for {formatDuration(entry.durationMs) || 'a moment'}</span>
      </button>
      {open && entry.text ? <div style={thinkingBody(t)}>{entry.text}</div> : null}
    </div>
  );
}

function ToolRow({
  entry,
  t,
  theme,
}: {
  entry: TranscriptEntry;
  t: ThemeTokens;
  theme: OverlayTheme;
}) {
  const [open, setOpen] = useState(false);
  const hasOutput = Boolean(entry.toolOutput);
  // The output panel sits inside the (gray) card; tint it toward white so it
  // reads a touch *lighter* than the header rather than darker.
  const outBg = theme === 'light' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.05)';
  return (
    <div style={toolCard(t)}>
      <button type="button" style={toolHeader(t)} onClick={() => hasOutput && setOpen((o) => !o)}>
        <span style={{ fontWeight: 600 }}>{entry.toolName ?? 'tool'}</span>
        {entry.toolInput ? <span style={toolInput(t)}>{entry.toolInput}</span> : null}
        <span style={{ flex: 1 }} />
        {entry.durationMs != null ? (
          <span style={{ color: t.textFaint, fontSize: '11px' }}>
            {formatDuration(entry.durationMs)}
          </span>
        ) : null}
        {hasOutput ? (
          <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-flex' }}>
            <ChevronRight />
          </span>
        ) : null}
      </button>
      {open && hasOutput ? (
        <pre style={{ ...toolOutput(t), background: outBg }}>{entry.toolOutput}</pre>
      ) : null}
    </div>
  );
}

function WorkingRow({ t }: { t: ThemeTokens }) {
  return (
    <div style={{ ...thinkingHeader(t), cursor: 'default' }}>
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '999px',
          background: t.accent,
          animation: 'localagents-pulse 1.4s ease-in-out infinite',
        }}
      />
      <span>Working…</span>
    </div>
  );
}

// ---------- icons ----------

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M10 3 L5 8 L10 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M6 3 L11 8 L6 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5 L6.5 11.5 L12.5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M8 13 V3.5 M3.8 7.7 L8 3.5 L12.2 7.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// ---------- styles ----------

const shell = (t: ThemeTokens) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
  minHeight: 0,
  color: t.textPrimary,
});

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

const messageList = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '10px',
};

const userRow = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const userBubble = (t: ThemeTokens) => ({
  maxWidth: '85%',
  padding: '8px 11px',
  background: t.toggleActiveBg,
  color: t.toggleActiveText,
  borderRadius: '12px 12px 4px 12px',
  fontSize: '13px',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

const assistantText = (t: ThemeTokens) => ({
  color: t.textPrimary,
  fontSize: '13px',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

const thinkingHeader = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: t.textFaint,
  fontSize: '12px',
  fontFamily: 'inherit',
  cursor: 'pointer',
});

const thinkingBody = (t: ThemeTokens) => ({
  marginTop: '5px',
  marginLeft: '18px',
  paddingLeft: '10px',
  color: t.textMuted,
  fontSize: '12px',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

const toolCard = (t: ThemeTokens) => ({
  background: t.controlBg,
  borderRadius: '8px',
  overflow: 'hidden',
});

const toolHeader = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '7px 10px',
  color: t.textPrimary,
  fontSize: '12px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  textAlign: 'left' as const,
});

const toolInput = (t: ThemeTokens) => ({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '11px',
  color: t.textMuted,
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '60%',
});

const toolOutput = (t: ThemeTokens) => ({
  margin: 0,
  padding: '8px 10px',
  background: t.fieldBg,
  color: t.textMuted,
  fontSize: '11px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineHeight: 1.5,
  maxHeight: '180px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
});

const resultRow = (t: ThemeTokens) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
  color: t.textMuted,
  fontSize: '12px',
});

const errorRow = {
  color: '#ef4444',
  fontSize: '12px',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

// 12px font × 1.5 line-height × 3 lines — composer grows to here, then scrolls.
const COMPOSER_MAX_H = 54;

const composerCard = (t: ThemeTokens) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  margin: '10px 12px 12px',
  padding: '12px 12px 8px',
  background: t.surfaceBg,
  border: `1px solid ${t.controlBorder}`,
  borderRadius: '12px',
  flexShrink: 0,
});

const composerInput = (t: ThemeTokens) => ({
  width: '100%',
  minHeight: '24px',
  maxHeight: `${COMPOSER_MAX_H}px`,
  background: 'transparent',
  border: 'none',
  color: t.textPrimary,
  padding: 0,
  margin: 0,
  fontFamily: 'inherit',
  fontSize: '12px',
  lineHeight: 1.5,
  resize: 'none' as const,
  overflowY: 'auto' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
});

const composerFooter = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: '8px',
  gap: '8px',
};

const composerActions = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0,
};

const attachBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '23px',
  height: '23px',
  flexShrink: 0,
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: t.textPrimary,
  cursor: 'pointer',
  padding: 0,
});

// Solid send square (mirrors the picked-popover send button).
const sendBtn = (t: ThemeTokens) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '23px',
  height: '23px',
  flexShrink: 0,
  background: t.submitBg,
  border: 'none',
  borderRadius: '5px',
  color: t.submitText,
  cursor: 'pointer',
  padding: 0,
});
