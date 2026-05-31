import { z } from 'zod';

// ---------- Health ----------

export const HealthResponse = z.object({
  ok: z.literal(true),
  repo: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

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

export const AttachedImage = z.object({
  /** Original filename when known — helps the agent and debugging. */
  name: z.string().optional(),
  mediaType: ImageMediaType,
  /** Raw base64 payload, WITHOUT the `data:<type>;base64,` URI prefix. */
  dataBase64: z.string().min(1),
});
export type AttachedImage = z.infer<typeof AttachedImage>;

/** Soft cap on attachments per annotation (keeps the JSON POST reasonable). */
export const MAX_IMAGES_PER_ANNOTATION = 6;

// ---------- Annotation ----------

export const Backend = z.enum(['claude', 'codex', 'echo']);
export type Backend = z.infer<typeof Backend>;

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

// ---------- Task ----------

export const TaskStatus = z.enum(['queued', 'running', 'editing', 'done', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  worktreeSlug: z.string(),
  backend: Backend,
  prompt: z.string(),
  source: SourceLocation.nullable(),
  status: TaskStatus,
  message: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Task = z.infer<typeof Task>;

// ---------- WebSocket events ----------

export const WsEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), worktrees: z.array(Worktree), tasks: z.array(Task) }),
  z.object({ type: z.literal('task:created'), task: Task }),
  z.object({ type: z.literal('task:updated'), task: Task }),
  z.object({ type: z.literal('task:log'), id: z.string(), line: z.string() }),
  z.object({ type: z.literal('worktree:created'), worktree: Worktree }),
  z.object({ type: z.literal('worktree:updated'), worktree: Worktree }),
  z.object({ type: z.literal('worktree:removed'), slug: z.string() }),
  z.object({ type: z.literal('needs-auth'), backend: Backend }),
]);
export type WsEvent = z.infer<typeof WsEvent>;
