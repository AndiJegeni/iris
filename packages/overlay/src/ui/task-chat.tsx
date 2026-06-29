/** @jsxImportSource preact */
import type { ReasoningEffort, Task, TranscriptEntry } from '@localagents/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type ChatTab, ChatTabBar } from './chat-tab-bar';
import { PlusThinIcon, SendIcon, StopIcon } from './icons';
import { DEFAULT_MODEL, EFFORTS, MODELS, ModelReasoningPicker } from './model-picker';
import { Entry, WorkingRow, assistantText } from './task-chat.transcript';
import { type OverlayTheme, type ThemeTokens, tokens } from './theme';

export type { ChatTab };

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
  const selectedModel = MODELS.find((m) => m.value === model) ?? MODELS[0]!;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize when draft changes
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
              <PlusThinIcon />
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

// ---------- styles ----------

const shell = (t: ThemeTokens) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
  minHeight: 0,
  color: t.textPrimary,
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
