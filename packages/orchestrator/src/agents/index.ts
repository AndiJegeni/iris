import type { Backend } from '@localagents/shared';
import { createClaudeRunner } from './claude';
import { createCodexRunner } from './codex';
import { echoRunner } from './echo';
import type { AgentRunner } from './types';

export type RunnerFactoryOpts = {
  anthropicKey: string | null;
  openaiKey: string | null;
};

/** Resolve a backend identifier to a runner. */
export function getRunner(backend: Backend, opts: RunnerFactoryOpts): AgentRunner | null {
  if (backend === 'claude') return createClaudeRunner({ anthropicKey: opts.anthropicKey });
  if (backend === 'codex') return createCodexRunner({ openaiKey: opts.openaiKey });
  if (backend === 'echo') return echoRunner;
  return null;
}

export type { AgentRunner, RunEvent, RunRequest } from './types';
