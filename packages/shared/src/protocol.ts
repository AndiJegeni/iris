import { z } from 'zod';

/**
 * Released version, surfaced by the CLI banner, `GET /health`, and the overlay's
 * Settings panel. Kept here so those three can't disagree; bump it together with
 * the package.json versions when cutting a release.
 */
export const VERSION = '0.1.0';

// ---------- Capabilities ----------

/**
 * What this daemon can actually do, given the machine it's running on. The
 * overlay uses it to disable affordances up front rather than let a task fail
 * on submit.
 */
export const Capabilities = z.object({
  /** Worktree mode clones the repo — false outside a git work tree. */
  git: z.boolean(),
  /** A git remote is configured, so a branch has somewhere to be pushed. */
  remote: z.boolean().default(false),
  /**
   * The GitHub CLI is on PATH. Without it Iris still pushes the branch, but
   * hands back a compare URL instead of opening the PR itself.
   */
  gh: z.boolean().default(false),
});
export type Capabilities = z.infer<typeof Capabilities>;

// ---------- Health ----------

/** Body of `GET /health`. */
export const HealthResponse = z.object({
  ok: z.literal(true),
  repo: z.string(),
  version: z.string(),
  capabilities: Capabilities,
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------- Auth ----------

/** The two credential providers the daemon can authenticate against. */
export const Provider = z.enum(['anthropic', 'openai']);
export type Provider = z.infer<typeof Provider>;

/** How a provider authenticates: a pay-per-use API key, a subscription login, or nothing. */
export const AuthMethod = z.enum(['api-key', 'oauth', 'none']);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const ProviderAuthStatus = z.object({
  method: AuthMethod,
  configured: z.boolean(),
  /** Where the credential came from: flag, config, oauth, or missing. */
  source: z.string(),
  /**
   * A real run was rejected by this credential (expired subscription session or
   * a bad key). The daemon's own record can look healthy while this is true.
   */
  expired: z.boolean().optional(),
});
export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatus>;

/** Body of `GET /auth/status`. */
export const AuthStatus = z.object({
  anthropic: ProviderAuthStatus,
  openai: ProviderAuthStatus,
});
export type AuthStatus = z.infer<typeof AuthStatus>;

// ---------- Source location ----------

export const SourceLocation = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const SourceConfidence = z.enum(['high', 'medium', 'low']);
export type SourceConfidence = z.infer<typeof SourceConfidence>;

// ---------- Attached image ----------

export const ImageMediaType = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export type ImageMediaType = z.infer<typeof ImageMediaType>;

/**
 * Upper bound on one attachment's base64 payload (~10MB of image). The daemon
 * parses the whole JSON body before validating, so without a per-image cap the
 * count cap below still admits an effectively unbounded POST.
 */
export const MAX_IMAGE_BASE64_CHARS = 14_000_000;

export const AttachedImage = z.object({
  /** Original filename when known — helps the agent and debugging. */
  name: z.string().optional(),
  mediaType: ImageMediaType,
  /** Raw base64 payload, WITHOUT the `data:<type>;base64,` URI prefix. */
  dataBase64: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
});
export type AttachedImage = z.infer<typeof AttachedImage>;

/** Soft cap on attachments per annotation (keeps the JSON POST reasonable). */
export const MAX_IMAGES_PER_ANNOTATION = 6;

/**
 * Attachments on a follow-up message (`POST /tasks/:id/message`) — same shape
 * and cap as an annotation's, so the two composers can't drift apart on what
 * an image is allowed to be.
 */
export const FollowUpImages = z.array(AttachedImage).max(MAX_IMAGES_PER_ANNOTATION);

// ---------- Annotation ----------

export const Backend = z.enum(['claude', 'codex', 'echo']);
export type Backend = z.infer<typeof Backend>;

/** Model family, which decides both the picker grouping and the effort tiers. */
export const ModelProvider = z.enum(['claude', 'gpt']);
export type ModelProvider = z.infer<typeof ModelProvider>;

export type ModelSpec = {
  value: string;
  label: string;
  provider: ModelProvider;
  /** Which runner executes this model. */
  backend: Backend;
};

/**
 * Every model the UI offers, in display order. Single source of truth: the
 * picker, the task panel's label lookup, and the backend routing all read this,
 * so adding a model is a one-line change here. Claude legacy models are
 * intentionally omitted.
 *
 * `value` is the runner's real model identifier — `claude-*` as the Claude
 * Agent SDK spells it, and whatever `codex --model` accepts for GPT — not a
 * display slug. Today the value only rides through to the UI label (see
 * queue.ts), but keeping it wire-accurate means passing the user's choice to
 * the agent is a one-line change rather than a translation table.
 *
 * No 1M-context variant: on the Claude 5 family a 1M window is the default and
 * the maximum, so it is no longer a separate choice.
 */
export const MODELS: ModelSpec[] = [
  { value: 'claude-fable-5', label: 'Fable 5', provider: 'claude', backend: 'claude' },
  { value: 'claude-opus-5', label: 'Opus 5', provider: 'claude', backend: 'claude' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8', provider: 'claude', backend: 'claude' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5', provider: 'claude', backend: 'claude' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', provider: 'claude', backend: 'claude' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'gpt', backend: 'codex' },
  { value: 'gpt-5.4', label: 'GPT-5.4', provider: 'gpt', backend: 'codex' },
];

/** Pre-selected model for a new task. */
export const DEFAULT_MODEL = 'claude-opus-5';

/** Stand-in when a stored model value is no longer in the catalog. */
export const FALLBACK_MODEL: ModelSpec = MODELS[0] as ModelSpec;

/** Display label for a model value, falling back to the raw value. */
export function modelLabel(value: string): string {
  return MODELS.find((m) => m.value === value)?.label ?? value;
}

/**
 * Reasoning effort. Like `MODELS.value`, these are the runners' real wire
 * values, not display slugs: the union is the Claude Agent SDK's `EffortLevel`
 * (low|medium|high|xhigh|max) plus codex's `model_reasoning_effort` enum
 * (low|medium|high|xhigh|ultra). The two overlap on the first four and diverge
 * only at the top tier, so a selection rides straight through to the agent with
 * no translation — and the UI filters the list per provider (see EFFORTS).
 */
export const ReasoningEffort = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type ReasoningEffort = z.infer<typeof ReasoningEffort>;

/** Selectable effort tiers per model family, in display order. */
export const EFFORTS: Record<ModelProvider, { value: ReasoningEffort; label: string }[]> = {
  claude: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
    { value: 'max', label: 'Max' },
  ],
  gpt: [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
    { value: 'ultra', label: 'Ultra' },
  ],
};

export const WorktreeMode = z.enum(['same', 'new']);
export type WorktreeMode = z.infer<typeof WorktreeMode>;

export const Annotation = z.object({
  prompt: z.string().min(1),
  source: SourceLocation.nullable(),
  selector: z.string().nullable(),
  componentPath: z.array(z.string()).default([]),
  nearbyText: z.string().nullable(),
  confidence: SourceConfidence,
  worktreeMode: WorktreeMode,
  backend: Backend,
  model: z.string().default(''),
  reasoningEffort: ReasoningEffort.default('medium'),
  images: z.array(AttachedImage).max(MAX_IMAGES_PER_ANNOTATION).default([]),
});
export type Annotation = z.infer<typeof Annotation>;

// ---------- Worktree ----------

export const DevServerStatus = z.enum(['booting', 'ready', 'crashed', 'stopped']);
export type DevServerStatus = z.infer<typeof DevServerStatus>;

export const Worktree = z.object({
  slug: z.string(), // "main" | "agent-1" | ...
  path: z.string(),
  branch: z.string(),
  port: z.number().int().positive(),
  devServerStatus: DevServerStatus,
});
export type Worktree = z.infer<typeof Worktree>;

/** Result of `POST /worktrees/:slug/pr`. Failures use the plain `{ error }` shape. */
export const PullRequestResult = z.object({
  ok: z.literal(true),
  /** The branch reached the remote. True even when PR creation itself fell back. */
  pushed: z.literal(true),
  /** A new PR was opened. False = one already existed, or `url` is a compare page. */
  created: z.boolean(),
  /**
   * `url` is a compare page rather than a pull request — the GitHub CLI is
   * missing or refused, so opening it is still on the user. `created` can't
   * answer this on its own: it is equally false when an existing PR was found.
   */
  compare: z.boolean().default(false),
  /** PR, existing-PR, or compare URL. Null when there's none to name (non-GitHub host). */
  url: z.string().nullable(),
  branch: z.string(),
  /** Why we fell back, when we did — shown to the user verbatim. */
  note: z.string().optional(),
});
export type PullRequestResult = z.infer<typeof PullRequestResult>;

// ---------- Task ----------

/**
 * `awaiting-input` is the agent asking and getting nothing back: the run is
 * live — its process is up, its worktree slot is held, its session is mid-turn —
 * but no work is happening until the user answers. It is deliberately neither
 * `running` (nothing is happening) nor `done` (it isn't), because the whole
 * problem it solves is a question that read as a finished task.
 */
export const TaskStatus = z.enum([
  'queued',
  'running',
  'editing',
  'awaiting-input',
  'done',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ---------- Agent questions ----------

/** One choice the agent offered for a question. */
export const QuestionOption = z.object({
  label: z.string(),
  /** What picking this means — the agent writes it; may be empty. */
  description: z.string().default(''),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const AgentQuestion = z.object({
  question: z.string(),
  /** The agent's own short chip label for the question (≤12 chars). */
  header: z.string().default(''),
  /** 2-4 choices. Always answerable in free text as well — see PendingQuestion. */
  options: z.array(QuestionOption).default([]),
});
export type AgentQuestion = z.infer<typeof AgentQuestion>;

/**
 * A question set the agent is blocked on. In-memory on the daemon for exactly
 * as long as the agent process is alive: it is persisted with the task, but the
 * promise it is holding open lives in that process, so a reload can only ever
 * find a question nobody can answer. `TaskQueue.load` therefore strips it along
 * with demoting the status — see the invariant there.
 *
 * The agent may ask up to four questions at once. They are answered one at a
 * time (`answers` is what has come back so far) and the run resumes only once
 * every one of them has an answer.
 */
export const PendingQuestion = z.object({
  /** The agent's tool-call id — what routes an answer back to the right promise. */
  id: z.string(),
  questions: z.array(AgentQuestion).min(1),
  /** Answers so far, keyed by question text (the shape the agent expects back). */
  answers: z.record(z.string(), z.string()).default({}),
});
export type PendingQuestion = z.infer<typeof PendingQuestion>;

/** The first question in the set that has no answer yet, or null when complete. */
export function nextUnanswered(pending: PendingQuestion): AgentQuestion | null {
  return pending.questions.find((q) => pending.answers[q.question] === undefined) ?? null;
}

export const Task = z.object({
  id: z.string(),
  worktreeSlug: z.string(),
  backend: Backend,
  /** Display name of the model used (e.g. "Opus 4.8"); falls back to backend. */
  model: z.string().optional(),
  prompt: z.string(),
  source: SourceLocation.nullable(),
  status: TaskStatus,
  message: z.string().optional(),
  /** Set exactly while `status` is `awaiting-input`; see PendingQuestion. */
  question: PendingQuestion.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Task = z.infer<typeof Task>;

// ---------- Transcript ----------

/**
 * One entry in a task's conversation transcript. Unlike the flat `logs`
 * channel, these are structured so the chat UI can render user/assistant
 * turns, thinking ("Thought for Ns"), and tool calls (with their inputs,
 * status, and outputs) the way Cursor / Claude Code do.
 *
 * `id` is stable within a task: a `tool` entry is first emitted with
 * `toolStatus: 'running'`, then *re-emitted with the same id* once its result
 * arrives so the client can update it in place (running → ok/error).
 */
export const TranscriptRole = z.enum(['user', 'assistant', 'thinking', 'tool', 'result', 'error']);
export type TranscriptRole = z.infer<typeof TranscriptRole>;

export const ToolStatus = z.enum(['running', 'ok', 'error']);
export type ToolStatus = z.infer<typeof ToolStatus>;

export const TranscriptEntry = z.object({
  id: z.string(),
  role: TranscriptRole,
  at: z.number(),
  /** Body text for user/assistant/thinking/result/error roles. */
  text: z.string().optional(),
  // ----- tool role only -----
  toolName: z.string().optional(),
  /** Pretty-printed (and truncated) tool input. */
  toolInput: z.string().optional(),
  toolStatus: ToolStatus.optional(),
  /** Truncated tool result/output, present once the call finishes. */
  toolOutput: z.string().optional(),
  /** Elapsed time for a thinking block, a tool call, or the whole run. */
  durationMs: z.number().optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;

/**
 * Append a transcript entry, or merge it into the existing one with the same id.
 * Entries stream in as partials (a tool call is emitted when it starts, then
 * again with its result), so a same-id arrival updates rather than duplicates.
 *
 * Shared because the daemon and the overlay each keep their own copy of the
 * transcript and must fold updates in identically.
 */
export function mergeTranscriptEntry(
  cur: TranscriptEntry[],
  entry: TranscriptEntry,
): { entries: TranscriptEntry[]; merged: TranscriptEntry } {
  const idx = cur.findIndex((e) => e.id === entry.id);
  if (idx < 0) return { entries: [...cur, entry], merged: entry };
  const merged = { ...cur[idx], ...entry };
  const entries = [...cur];
  entries[idx] = merged;
  return { entries, merged };
}

// ---------- WebSocket events ----------

export const WsEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    worktrees: z.array(Worktree),
    tasks: z.array(Task),
    capabilities: Capabilities,
  }),
  z.object({ type: z.literal('task:created'), task: Task }),
  z.object({ type: z.literal('task:updated'), task: Task }),
  z.object({ type: z.literal('task:log'), id: z.string(), line: z.string() }),
  z.object({ type: z.literal('task:entry'), id: z.string(), entry: TranscriptEntry }),
  z.object({ type: z.literal('task:removed'), id: z.string() }),
  z.object({ type: z.literal('worktree:created'), worktree: Worktree }),
  z.object({ type: z.literal('worktree:updated'), worktree: Worktree }),
  z.object({ type: z.literal('worktree:removed'), slug: z.string() }),
  z.object({ type: z.literal('needs-auth'), backend: Backend }),
]);
export type WsEvent = z.infer<typeof WsEvent>;
