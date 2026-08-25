import type {
  AgentQuestion,
  AttachedImage,
  ReasoningEffort,
  SourceLocation,
  TranscriptEntry,
} from '@iris/shared';

/** A user's answers to one question set, keyed by question text. */
export type QuestionAnswer = { id: string; answers: Record<string, string> };

/**
 * How an answer reaches a run that is already in flight.
 *
 * The queue owns the object and hands it to the runner in the RunRequest; the
 * runner installs `deliver` for exactly as long as its agent process can still
 * receive one, and clears it when the run ends. That null is what makes a late
 * answer — the user clicking just as the run dies — a no-op the queue can see
 * and report, rather than a promise nobody will ever resolve.
 */
export type AnswerChannel = {
  deliver: ((answer: QuestionAnswer) => void) | null;
};

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
  /**
   * Present when the runner is allowed to block on the user. Backends that
   * cannot ask questions simply ignore it.
   */
  answers?: AnswerChannel;
  signal: AbortSignal;
};

export type RunEvent =
  | { kind: 'status'; status: 'running' | 'editing' }
  /**
   * The agent asked and is now blocked. `id` is its tool-call id, which an
   * answer must quote back so it resolves the right pending call.
   */
  | { kind: 'question'; id: string; questions: AgentQuestion[] }
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

/**
 * Splits a byte stream into JSON lines. Both halves of the parent↔worker pipe
 * speak this — events out, answers in — so it lives beside the wire format
 * rather than being written twice.
 *
 * A chunk is not a line: a pipe can deliver half a line, three lines at once, or
 * a multi-byte character split across the boundary. The unterminated tail is
 * therefore carried into the next `push`, and `flush` is what a caller uses at
 * end-of-stream for a final line that arrived without its newline.
 */
export class LineBuffer {
  private buffer = '';
  private readonly decoder = new TextDecoder();

  /** Complete lines contained in `chunk`, with the tail held back. */
  push(chunk: Uint8Array | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) lines.push(line);
      nl = this.buffer.indexOf('\n');
    }
    return lines;
  }

  /** Whatever is left when the stream ends, as a line (or nothing). */
  flush(): string[] {
    const tail = this.buffer.trim();
    this.buffer = '';
    return tail ? [tail] : [];
  }
}
