import { randomUUID } from 'node:crypto';
import type { TranscriptEntry } from '@localagents/shared';
import type { AgentRunner, RunEvent, RunRequest } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function entry(e: Omit<TranscriptEntry, 'at'>): RunEvent {
  return { kind: 'entry', entry: { ...e, at: Date.now() } };
}

/**
 * No-op agent that simulates a task end-to-end without making API calls.
 * Emits the full structured transcript (thinking, tool calls, assistant text)
 * plus a fake resumable session id, so the chat UI and the follow-up/resume
 * path can be exercised without burning Anthropic credits.
 *
 * Selected via the `backend: 'echo'` value on an annotation when developing.
 */
export const echoRunner: AgentRunner = async function* (req: RunRequest): AsyncGenerator<RunEvent> {
  yield { kind: 'status', status: 'running' };

  // First run mints a session; follow-ups (resume) reuse the existing one.
  const followUp = Boolean(req.resumeSessionId);
  if (!followUp) yield { kind: 'session', sessionId: `echo-${randomUUID()}` };

  yield entry({
    id: randomUUID(),
    role: 'thinking',
    text: 'Reading the request…',
    durationMs: 600,
  });
  await sleep(400);

  if (req.images.length > 0) {
    const names = req.images.map((img) => img.name ?? img.mediaType).join(', ');
    yield entry({
      id: randomUUID(),
      role: 'assistant',
      text: `Got ${req.images.length} image(s): ${names}`,
    });
    await sleep(300);
  }

  // A tool call that starts running then resolves — same id, updated in place.
  const toolId = randomUUID();
  yield entry({
    id: toolId,
    role: 'tool',
    toolName: 'Bash',
    toolInput: '$ bun run build',
    toolStatus: 'running',
  });
  await sleep(500);
  yield entry({
    id: toolId,
    role: 'tool',
    toolName: 'Bash',
    toolStatus: 'ok',
    toolOutput: 'Build succeeded in 0.4s',
    durationMs: 500,
  });

  if (req.source) {
    yield { kind: 'status', status: 'editing' };
    yield { kind: 'edit', file: req.source.file, description: 'mock edit' };
    yield entry({
      id: randomUUID(),
      role: 'assistant',
      text: `Would edit ${req.source.file}:${req.source.line} (component: ${req.componentPath[0] ?? '?'})`,
    });
    await sleep(300);
  } else {
    yield entry({
      id: randomUUID(),
      role: 'assistant',
      text: `No source resolved — selector "${req.selector}", text: ${req.text ? `"${req.text}"` : 'none'}`,
    });
    await sleep(300);
  }

  yield {
    kind: 'done',
    summary: followUp
      ? 'Echo follow-up complete (no real changes made)'
      : 'Echo run complete (no real changes made)',
  };
};
