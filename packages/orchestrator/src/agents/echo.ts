import type { AgentRunner, RunEvent, RunRequest } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * No-op agent that simulates a task end-to-end without making API calls.
 * Useful for testing the wire format / UI without burning Anthropic credits.
 *
 * Selected via the `backend: 'echo'` value on an annotation when developing.
 */
export const echoRunner: AgentRunner = async function* (req: RunRequest): AsyncGenerator<RunEvent> {
  yield { kind: 'status', status: 'running' };
  yield { kind: 'log', line: `Echo received prompt: "${req.prompt.slice(0, 80)}"` };
  await sleep(400);

  if (req.source) {
    yield {
      kind: 'log',
      line: `Would edit ${req.source.file}:${req.source.line} (component: ${req.componentPath[0] ?? '?'})`,
    };
    await sleep(400);
    yield { kind: 'status', status: 'editing' };
    yield { kind: 'edit', file: req.source.file, description: 'mock edit' };
    await sleep(400);
  } else {
    yield {
      kind: 'log',
      line: `No source resolved — selector "${req.selector}", text: ${req.text ? `"${req.text}"` : 'none'}`,
    };
    await sleep(400);
  }

  yield { kind: 'done', summary: 'Echo run complete (no real changes made)' };
};
