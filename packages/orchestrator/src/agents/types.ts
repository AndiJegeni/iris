import type { AttachedImage, SourceLocation } from '@localagents/shared';

export type RunRequest = {
  prompt: string;
  source: SourceLocation | null;
  componentPath: string[];
  selector: string;
  text: string | null;
  /** Images the user attached in the popover (base64). Empty when none. */
  images: AttachedImage[];
  /** Absolute path to the working directory the agent should operate in. */
  cwd: string;
  signal: AbortSignal;
};

export type RunEvent =
  | { kind: 'status'; status: 'running' | 'editing' }
  | { kind: 'log'; line: string }
  | { kind: 'edit'; file: string; description?: string }
  | { kind: 'done'; summary?: string }
  | { kind: 'error'; message: string };

/**
 * Backend-agnostic agent runner. Each implementation drives one task to
 * completion, yielding events the queue forwards over WebSocket.
 */
export type AgentRunner = (req: RunRequest) => AsyncGenerator<RunEvent, void, void>;
