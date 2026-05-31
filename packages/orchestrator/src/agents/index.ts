import type { Backend } from '@localagents/shared';
import { createClaudeRunner } from './claude';
import { echoRunner } from './echo';
import type { AgentRunner } from './types';

export type RunnerFactoryOpts = {
  anthropicKey: string | null;
  openaiKey: string | null;
};

/**
 * Resolve a backend identifier to a runner. Returns null if the requested
 * backend isn't available (e.g. Codex requested but not implemented yet).
 */
export function getRunner(backend: Backend | 'echo', opts: RunnerFactoryOpts): AgentRunner | null {
  if (backend === 'claude') return createClaudeRunner({ anthropicKey: opts.anthropicKey });
  if (backend === 'echo') return echoRunner;
  // 'codex' is M6.
  return null;
}

export type { AgentRunner, RunEvent, RunRequest } from './types';
