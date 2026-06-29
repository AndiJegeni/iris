/** @jsxImportSource preact */
import type { TranscriptEntry } from '@localagents/shared';
import { useState } from 'preact/hooks';
import { ResultCheckIcon, ThinChevronRightIcon } from './icons';
import type { OverlayTheme, ThemeTokens } from './theme';

export function formatDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return '<1s';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export function Entry({
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
          <ResultCheckIcon />
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

export function ThinkingRow({ entry, t }: { entry: TranscriptEntry; t: ThemeTokens }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '2px 0' }}>
      <button type="button" style={thinkingHeader(t)} onClick={() => setOpen((o) => !o)}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-flex' }}>
          <ThinChevronRightIcon />
        </span>
        <span>Thought for {formatDuration(entry.durationMs) || 'a moment'}</span>
      </button>
      {open && entry.text ? <div style={thinkingBody(t)}>{entry.text}</div> : null}
    </div>
  );
}

export function ToolRow({
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
            <ThinChevronRightIcon />
          </span>
        ) : null}
      </button>
      {open && hasOutput ? (
        <pre style={{ ...toolOutput(t), background: outBg }}>{entry.toolOutput}</pre>
      ) : null}
    </div>
  );
}

export function WorkingRow({ t }: { t: ThemeTokens }) {
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

// ---------- styles ----------

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

export const assistantText = (t: ThemeTokens) => ({
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
