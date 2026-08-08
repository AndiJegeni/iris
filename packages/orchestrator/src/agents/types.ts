import type { AttachedImage, ReasoningEffort, SourceLocation, TranscriptEntry } from '@iris/shared';

export type RunRequest = {
  prompt: string;
  /**
   * The model the user picked, as its backend spells it (see MODELS in the
   * shared protocol) — `claude-opus-5` for the SDK, `gpt-5.6-sol` for
   * `codex --model`. Unset means "let the backend use its own default".
   */
  model?: string;
  /**
   * Reasoning effort for this run. The values are already what each backend
   * accepts (SDK `effort`, codex `model_reasoning_effort`), so runners pass
   * them straight through.
   */
  effort?: ReasoningEffort;
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
  /**
   * The conversation so far, set on follow-up turns. Backends that can resume
   * their own session (Claude, via `resumeSessionId`) ignore this; those that
   * cannot replay it into the prompt so a follow-up still has context.
   */
  priorTranscript?: TranscriptEntry[];
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
