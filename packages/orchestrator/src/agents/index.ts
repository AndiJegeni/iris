import type { Backend } from '@iris/shared';
import type { AuthState } from '../auth';
import type { ClaudeBinary } from '../claude-binary';
import { createClaudeRunner } from './claude';
import { createCodexRunner } from './codex';
import { echoRunner } from './echo';
import type { AgentRunner } from './types';

/** Resolve a backend identifier to a runner. */
export function getRunner(
  backend: Backend,
  auth: AuthState,
  claudeBinary?: ClaudeBinary,
): AgentRunner | null {
  if (backend === 'claude') return createClaudeRunner(auth.anthropic, claudeBinary);
  if (backend === 'codex') return createCodexRunner(auth.openai);
  if (backend === 'echo') return echoRunner;
  return null;
}

export type { AgentRunner, RunEvent, RunRequest } from './types';
