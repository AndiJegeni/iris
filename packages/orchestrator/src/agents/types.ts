import type { AttachedImage, SourceLocation, TranscriptEntry } from '@localagents/shared';

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
  /**
   * When set, the runner resumes a prior agent session (for follow-up
   * messages) instead of starting fresh. Carries the backend's session id.
   */
  resumeSessionId?: string;
  signal: AbortSignal;
};

export type RunEvent =
  | { kind: 'status'; status: 'running' | 'editing' }
  | { kind: 'log'; line: string }
  | { kind: 'edit'; file: string; description?: string }
  /** A structured transcript entry for the chat UI (append-or-update by id). */
  | { kind: 'entry'; entry: TranscriptEntry }
  /** The backend's resumable session id, captured once per run. */
  | { kind: 'session'; sessionId: string }
  | { kind: 'done'; summary?: string }
  /**
   * The run died because the provider's credential is expired or rejected.
   * Distinct from 'error' so the daemon can mark the provider as needing a new
   * login instead of leaving the user with a raw 401.
   */
  | { kind: 'needs-auth'; message: string }
  | { kind: 'error'; message: string };

/**
 * Backend-agnostic agent runner. Each implementation drives one task to
 * completion, yielding events the queue forwards over WebSocket.
 */
export type AgentRunner = (req: RunRequest) => AsyncGenerator<RunEvent, void, void>;
