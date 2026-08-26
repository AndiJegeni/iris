/**
 * Claude agent worker — runs ONE task (or one follow-up turn) in its own process.
 *
 * Why a separate process: the Agent SDK resolves file edits against
 * `process.cwd()`, NOT the `cwd` option passed to `query()`. To isolate a task
 * to its worktree, the parent spawns this script with `{ cwd }` so this
 * process's cwd IS the worktree. Edits then land in the right place, and
 * parallel tasks (each its own process) never clobber each other's cwd.
 *
 * Protocol:
 *   - stdin:  JSON lines, and the stream stays OPEN for the life of the run.
 *             The first line is the start payload
 *             `{ prompt, resume?, model?, effort? }` (`resume` is a prior SDK
 *             session id, for follow-up messages; `model`/`effort` are the
 *             user's picks, already in SDK spelling). Every later line is an
 *             answer `{ type: 'answer', id, answers }` to a question this
 *             worker asked — see askUser below. Without a second direction
 *             there is nowhere for a human answer to go, and a blocked agent
 *             could only ever give up.
 *   - stdout: JSON-line RunEvents — besides the legacy `log`/`edit`/`status`/
 *             `done`/`error`, we now emit structured `entry` events (one per
 *             assistant text / thinking block / tool call), a `session` event
 *             carrying the resumable session id, and a `question` event when
 *             the agent needs the user before it can continue.
 *   ANTHROPIC_API_KEY is inherited from the spawn env.
 */
import { randomUUID } from 'node:crypto';
import { type CanUseTool, type SettingSource, query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentQuestion, TranscriptEntry } from '@iris/shared';
import { isAuthError } from '../auth-errors';
import { CLAUDE_BINARY_ENV } from '../claude-binary';
// The parent parses stdout back into this exact union, so it is the wire format
// between the two processes — import it rather than restating it here, where a
// silent drift would only surface as a dropped event at runtime.
import { LineBuffer, type RunEvent } from './types';

function emit(ev: RunEvent): void {
  process.stdout.write(`${JSON.stringify(ev)}\n`);
}

function emitEntry(entry: TranscriptEntry): void {
  emit({ kind: 'entry', entry });
}

/**
 * The SDK's built-in tool for putting a multiple-choice question to the user.
 *
 * It is reachable under `permissionMode: 'acceptEdits'` and without being named
 * in `allowedTools`: the tool declares `requiresUserInteraction`, and the CLI
 * returns its "ask" decision *before* it consults either the permission mode or
 * the allow rules. So the only thing standing between the agent and a human is
 * the `canUseTool` callback below.
 */
const ASK_USER_QUESTION = 'AskUserQuestion';

/**
 * Tools that run without asking. Reads, searches, edits inside the worktree, and
 * the agent's own scratch tools are the expected, low-blast-radius operations —
 * and edits are additionally covered by `permissionMode: 'acceptEdits'`.
 * Everything NOT listed here — `Bash` above all, plus anything that reaches the
 * network or spawns further work — falls through to `canUseTool` and asks the
 * user before it runs. This is the list the SDK auto-approves; keep it to
 * operations whose worst case is confined to the task's own worktree.
 */
const AUTO_ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite', 'NotebookEdit'];

/**
 * The tools whose every call must pause for the user. `permissionMode` and
 * `allowedTools` are NOT enough on their own: verified against the SDK
 * (v0.3.152), a tool the agent reaches for that isn't explicitly asked-for runs
 * *without* ever calling `canUseTool` — the non-interactive default is allow.
 * Only an explicit `ask` rule in the flag-settings layer routes a tool through
 * `canUseTool`, and that layer overrides every filesystem settings source
 * (user/project/local), including one that tries to escalate to
 * `bypassPermissions`. So this list is the real gate: shell execution and every
 * way out to the network or a subagent. Keep it in sync with the toolset — a
 * new execution/network tool not named here would run unprompted.
 */
const ASK_TOOLS = ['Bash', 'WebFetch', 'WebSearch', 'Task'];

// The option labels for a permission prompt. The user's click comes back as the
// exact label (queue.ts matches the click to an option label), so these strings
// are the wire contract between the prompt we emit and the decision we read.
const ALLOW_ONCE = 'Allow once';
const ALLOW_ALWAYS = 'Allow for this task';
const DENY = 'Deny';

/**
 * The line-oriented half of stdin, shared by the start payload and every answer
 * that follows.
 *
 * Nothing here unrefs the stream: before `query()` is running there is no other
 * work holding the event loop open, so an unref'd stdin would let the process
 * exit before the first line even arrived. `main` destroys it on the way out
 * instead, which is what actually lets the worker exit once the run is over.
 */
class StdinLines {
  private readonly buffer = new LineBuffer();
  private readonly pending: ((line: string | null) => void)[] = [];
  private readonly queued: string[] = [];
  private ended = false;

  constructor() {
    process.stdin.on('data', (chunk: Buffer) => {
      for (const line of this.buffer.push(chunk)) this.offer(line);
    });
    const end = () => {
      for (const line of this.buffer.flush()) this.offer(line);
      this.ended = true;
      // The parent closed the pipe (or died). Wake everyone waiting so the run
      // unwinds instead of hanging on an answer that can no longer arrive.
      for (const resolve of this.pending.splice(0)) resolve(null);
    };
    process.stdin.on('end', end);
    process.stdin.on('error', end);
  }

  /** The next line, or null once the stream has ended. */
  next(): Promise<string | null> {
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.pending.push(resolve));
  }

  close(): void {
    process.stdin.destroy();
  }

  private offer(line: string): void {
    const waiter = this.pending.shift();
    if (waiter) waiter(line);
    else this.queued.push(line);
  }
}

/**
 * The SDK's own `EffortLevel`. Our shared ReasoningEffort is the union of the
 * Claude and codex tiers, so the GPT-only top tier ("ultra") is a value this
 * backend would reject — the picker filters by provider, and this is the
 * belt-and-braces so a stale client can't 400 the run.
 */
const SDK_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * The turn cap and the note that makes the agent aware of it. 25 starved real
 * tasks — an agent that had already landed its edits burned the remainder
 * verifying and hit the wall mid-check, which surfaced as a hard failure over
 * finished work. 60 gives verification room while still bounding a runaway —
 * but the cap is an external guillotine the model can't see, so the note below
 * rides in on the system prompt to turn it into something it paces against.
 * One constant for both so the number the agent is told is the number that
 * kills it.
 */
const MAX_TURNS = 60;
const TURN_BUDGET_NOTE = [
  `Turn budget: this run is hard-capped at ${MAX_TURNS} agentic turns (each of`,
  'your messages, including one batch of tool calls, costs a turn). The cap is',
  'enforced externally and cuts the run off mid-action with no warning, so pace',
  'against it:',
  '- Land the requested change first. Then verify with the cheapest check that',
  '  gives real signal (a targeted typecheck or one focused test), not an',
  '  exhaustive sweep.',
  '- Batch independent tool calls into a single message; every extra',
  '  round-trip costs a turn and gets slower as the conversation grows.',
  '- If the work remaining looks like more turns than you plausibly have left,',
  '  stop and report instead: say what you changed, what you verified, and',
  '  what remains. A clean handoff beats being cut off mid-edit — the session',
  '  is resumable, so the user can send a follow-up to continue.',
].join('\n');

/**
 * Routes answers arriving on stdin back to the `canUseTool` calls waiting on
 * them, keyed by the agent's tool-call id.
 *
 * One reader, not one per question: the SDK may run two tool calls from the
 * same assistant message concurrently, and several `next()` waiters racing over
 * a shared stream would hand answers to whichever happened to be first in the
 * queue rather than to the call they name.
 */
class AnswerRouter {
  private readonly waiting = new Map<string, (answers: Record<string, string> | null) => void>();
  private closed = false;

  constructor(private readonly lines: StdinLines) {}

  /** Read until the parent closes stdin, dispatching each answer to its caller. */
  async pump(): Promise<void> {
    while (true) {
      const line = await this.lines.next();
      if (line === null) break;
      let msg: { type?: unknown; id?: unknown; answers?: unknown };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue; // a malformed line is not worth killing a live run over
      }
      if (msg.type !== 'answer' || typeof msg.id !== 'string') continue;
      const resolve = this.waiting.get(msg.id);
      if (!resolve) continue;
      this.waiting.delete(msg.id);
      resolve(
        msg.answers && typeof msg.answers === 'object'
          ? (msg.answers as Record<string, string>)
          : {},
      );
    }
    this.closed = true;
    for (const [id, resolve] of this.waiting) {
      this.waiting.delete(id);
      resolve(null);
    }
  }

  /** The answers for `id`, or null if the channel closed first. */
  await(id: string, signal: AbortSignal): Promise<Record<string, string> | null> {
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const settle = (answers: Record<string, string> | null) => {
        signal.removeEventListener('abort', onAbort);
        resolve(answers);
      };
      const onAbort = () => {
        this.waiting.delete(id);
        settle(null);
      };
      // The SDK aborts this signal when the run is torn down. Without unhooking
      // here, cancelling a task while a question was up would leave the promise
      // pending and the process alive with nothing left to do.
      if (signal.aborted) {
        settle(null);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiting.set(id, settle);
    });
  }
}

/**
 * Reads the agent's `AskUserQuestion` input into the shape the UI renders.
 * Returns null for anything that doesn't look like a question set, so an
 * unexpected schema falls back to letting the tool run rather than blocking a
 * run on a question nobody can see.
 */
// biome-ignore lint/suspicious/noExplicitAny: SDK tool input shape
function parseQuestions(input: any): AgentQuestion[] | null {
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: AgentQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) return null;
    questions.push({
      question: q.question,
      header: typeof q.header === 'string' ? q.header : '',
      options: Array.isArray(q.options)
        ? q.options
            .filter((o: unknown): o is { label: string; description?: unknown } =>
              Boolean(o && typeof (o as { label?: unknown }).label === 'string'),
            )
            .map((o: { label: string; description?: unknown }) => ({
              label: o.label,
              description: typeof o.description === 'string' ? o.description : '',
            }))
        : [],
    });
  }
  return questions;
}

/**
 * Splits a gated tool call into the title the user reads and the concrete
 * `resource` they're actually approving. Bash's command is the thing that most
 * needs to be seen verbatim; other tools show a short summary of their input.
 * The card renders `resource` in a monospace block under the title.
 */
// biome-ignore lint/suspicious/noExplicitAny: SDK tool input shape
function permissionPrompt(name: string, input: any): { title: string; resource?: string } {
  if (name === 'Bash' && input && typeof input.command === 'string') {
    return { title: 'Run this command?', resource: truncate(input.command, MAX_INPUT) };
  }
  const detail = summarizeInput(name, input);
  return detail
    ? { title: `Allow the ${name} tool to run?`, resource: detail }
    : { title: `Allow the ${name} tool to run?` };
}

/**
 * The permission callback, and the hinge of the whole feature.
 *
 * `canUseTool` is async and the SDK holds the turn open for as long as its
 * promise is pending — so awaiting a human here *is* the pause. It is invoked
 * only for tool calls the mode and `allowedTools` did NOT auto-approve, which is
 * exactly the set we want a human on: `AskUserQuestion`, `Bash`, and anything
 * that reaches the network or spawns more work.
 *
 * Two shapes of pause, both over the same question channel:
 *  - AskUserQuestion — the agent's own multiple-choice question. Answering is an
 *    `allow` carrying `updatedInput`: the tool reads `answers` out of its own
 *    input, exactly how the interactive CLI feeds a choice back, so the agent
 *    gets a real tool result and continues the same turn.
 *  - Everything else — a synthetic Allow / Allow-always / Deny prompt. We read
 *    the click and allow or deny the tool itself; nothing is written into the
 *    tool's input. "Allow for this task" remembers the tool for the rest of the
 *    run so the user isn't asked on every `Bash` call.
 *
 * Fail closed: a missing answer, a dropped channel, or any reply that isn't an
 * explicit allow is a deny, so the agent never runs a gated tool on silence.
 */
function permissionHandler(router: AnswerRouter): CanUseTool {
  const sessionAllowed = new Set<string>();
  return async (toolName, input, { signal, toolUseID }) => {
    if (toolName === ASK_USER_QUESTION) {
      const questions = parseQuestions(input);
      if (!questions) return { behavior: 'allow' };
      emit({ kind: 'question', id: toolUseID, questions });
      const answers = await router.await(toolUseID, signal);
      if (!answers) {
        // Cancelled, or the daemon went away. Deny with a reason rather than
        // hanging: if anything is still listening, the agent gets a coherent
        // tool result instead of a stall.
        return { behavior: 'deny', message: 'The user did not answer; stop and wait for them.' };
      }
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }

    // A tool the user already blessed for the rest of this run.
    if (sessionAllowed.has(toolName)) return { behavior: 'allow' };

    const { title, resource } = permissionPrompt(toolName, input);
    const question: AgentQuestion = {
      kind: 'permission',
      question: title,
      header: toolName.slice(0, 12),
      ...(resource ? { resource } : {}),
      options: [
        { label: ALLOW_ONCE, description: 'Run it this once' },
        { label: ALLOW_ALWAYS, description: `Don't ask again for ${toolName} this run` },
        { label: DENY, description: 'Skip it — the agent continues without it' },
      ],
    };
    emit({ kind: 'question', id: toolUseID, questions: [question] });
    const answers = await router.await(toolUseID, signal);
    // One question in the set, so its answer is the only value — read it
    // positionally rather than by the (long) question text used as the key.
    const choice = answers ? Object.values(answers)[0] : null;
    if (choice === ALLOW_ALWAYS) {
      sessionAllowed.add(toolName);
      return { behavior: 'allow' };
    }
    if (choice === ALLOW_ONCE) return { behavior: 'allow' };
    return {
      behavior: 'deny',
      message: `The user declined to run ${toolName}. Do not retry it; continue without it, or use AskUserQuestion to ask them how to proceed.`,
    };
  };
}

async function main(): Promise<void> {
  const lines = new StdinLines();
  const first = await lines.next();
  let prompt: string;
  let resume: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  // Yolo: the user turned on Settings → Bypass permissions, opting every agent
  // out of the approval prompt for this daemon session.
  let bypass = false;
  try {
    const parsed = JSON.parse(first ?? '') as {
      prompt: string;
      resume?: string;
      model?: string;
      effort?: string;
      bypass?: boolean;
    };
    prompt = parsed.prompt;
    resume = parsed.resume;
    model = parsed.model;
    effort = parsed.effort && SDK_EFFORTS.has(parsed.effort) ? parsed.effort : undefined;
    bypass = parsed.bypass === true;
  } catch {
    emit({ kind: 'error', message: 'worker: invalid input' });
    lines.close();
    return;
  }

  const router = new AnswerRouter(lines);
  // Deliberately not awaited: it runs until stdin closes, which is after this
  // function returns. Its rejection can only come from a destroyed stream.
  void router.pump().catch(() => {});

  // Hoisted out of the try: the catch below decides whether a thrown turn
  // limit is a failure or a soft landing by how far the run got.
  const tracker = new TranscriptTracker();

  // The permission posture, and the whole point of the Bypass toggle.
  //  - Off (default): 'acceptEdits' auto-accepts edits, while the `ask` rule
  //    routes Bash and the network/subagent tools through canUseTool so the user
  //    approves them. An `ask` rule is the ONLY thing that reaches canUseTool —
  //    without it the SDK's non-interactive default runs a tool unprompted — and
  //    the flag layer overrides any filesystem settings that would pre-allow it.
  //    `settingSources: ['project']` still loads the project's CLAUDE.md.
  //  - On (yolo): 'bypassPermissions' skips every check, exactly the pre-gate
  //    behaviour. `allowDangerouslySkipPermissions` is the SDK's required
  //    acknowledgement that the caller means it.
  const permissionOptions = bypass
    ? { permissionMode: 'bypassPermissions' as const, allowDangerouslySkipPermissions: true }
    : {
        permissionMode: 'acceptEdits' as const,
        settings: { permissions: { ask: ASK_TOOLS } },
        settingSources: ['project'] as SettingSource[],
      };

  try {
    const iter = query({
      prompt,
      options: {
        // process.cwd() is the worktree (set by the parent's spawn cwd).
        cwd: process.cwd(),
        // Auto-approve the low-blast-radius tools; edits are additionally
        // covered by the mode below.
        allowedTools: AUTO_ALLOWED_TOOLS,
        ...permissionOptions,
        // Fires for every tool the mode and allow-list did not auto-approve:
        // AskUserQuestion, plus (when not bypassing) everything in ASK_TOOLS.
        canUseTool: permissionHandler(router),
        maxTurns: MAX_TURNS,
        // The default Claude Code prompt plus our budget note — the preset form
        // appends; a plain string would REPLACE the default prompt and
        // lobotomize the agent's tool use.
        systemPrompt: { type: 'preset', preset: 'claude_code', append: TURN_BUDGET_NOTE },
        // Set when the daemon found a usable `claude` on PATH; omitted otherwise
        // so the SDK falls back to its own vendored executable.
        ...(process.env[CLAUDE_BINARY_ENV]
          ? { pathToClaudeCodeExecutable: process.env[CLAUDE_BINARY_ENV] }
          : {}),
        // Resume a prior session for follow-up messages (undefined → fresh run).
        ...(resume ? { resume } : {}),
        // The user's picks. Omitted entirely when unset so the SDK keeps its
        // own defaults rather than being handed an empty string.
        ...(model ? { model } : {}),
        ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
      },
    });

    let sessionSent = false;
    let summary: string | undefined;

    for await (const message of iter) {
      // Capture the resumable session id from the first message that carries it.
      if (!sessionSent && message && typeof message === 'object' && 'session_id' in message) {
        const sid = (message as { session_id?: unknown }).session_id;
        if (typeof sid === 'string' && sid) {
          emit({ kind: 'session', sessionId: sid });
          sessionSent = true;
        }
      }

      // Legacy events (status/edit) keep the task-panel status line working.
      const legacy = translateLegacy(message, tracker.editedFiles);
      if (legacy) emit(legacy);

      // Structured transcript entries for the chat UI.
      tracker.handle(message);

      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        (message as { type?: unknown }).type === 'result'
      ) {
        // biome-ignore lint/suspicious/noExplicitAny: SDK message
        const m = message as any;
        summary = m.result ?? m.summary;
        const durationMs = typeof m.duration_ms === 'number' ? m.duration_ms : undefined;
        // The SDK reports some auth failures as an error *result* rather than a
        // throw; treat both as needs-auth.
        if (m.is_error === true && typeof summary === 'string' && isAuthError(summary)) {
          emit({ kind: 'needs-auth', message: summary });
          return;
        }
        // The closing line is just "Done · 12s". The SDK's `result` is the full
        // final assistant message, which the transcript already carries as its
        // own assistant entry — re-emitting it here painted the whole reply a
        // second time, in the activity row's grey, right under the real one.
        // Same guard on the error path: the SDK often surfaces a failure as an
        // assistant message AND an error result carrying identical text.
        if (m.is_error === true && summary) {
          if (String(summary).trim() !== tracker.lastAssistantText.trim()) {
            emitEntry({ id: randomUUID(), role: 'error', at: Date.now(), text: String(summary) });
          }
        } else {
          emitEntry({
            id: randomUUID(),
            role: 'result',
            at: Date.now(),
            text: 'Done',
            ...(durationMs != null ? { durationMs } : {}),
          });
        }
      }
    }

    emit({
      kind: 'done',
      summary:
        summary ??
        (tracker.editedFiles.size > 0
          ? `Edited ${tracker.editedFiles.size} file(s)`
          : 'No changes'),
    });
  } catch (err) {
    // An expired subscription session / rejected key surfaces here as a thrown
    // 401. Flag it as such so the daemon can tell the user to re-authenticate
    // rather than reporting an opaque failure.
    const message = err instanceof Error ? err.message : String(err);
    if (isAuthError(message)) {
      emit({ kind: 'needs-auth', message });
      return;
    }
    // The SDK throws when the turn cap trips, even if the agent had already
    // finished the actual work and was only mid-verification — which painted a
    // completed change as "failed" with an opaque error. If edits landed, call
    // it done and say what happened; the session is resumable, so a follow-up
    // picks up exactly where the cap cut in. With no edits at all the cap
    // really did starve the task, and failure is the honest report.
    if (/maximum number of turns/i.test(message) && tracker.editedFiles.size > 0) {
      emitEntry({
        id: randomUUID(),
        role: 'error',
        at: Date.now(),
        text: 'Ran out of turns while verifying — the edits above are in the worktree. Send a follow-up to continue.',
      });
      emit({
        kind: 'done',
        summary: `Edited ${tracker.editedFiles.size} file(s), then ran out of turns while verifying`,
      });
      return;
    }
    emit({ kind: 'error', message });
  } finally {
    // stdin stayed open for the whole run so answers could arrive on it. Its
    // 'data' listener is also the last thing holding the event loop, so without
    // this the worker would sit there, finished, forever.
    lines.close();
  }
}

/**
 * Walks SDK messages and emits structured transcript entries. Tracks tool-call
 * start times so a result can be matched to its call (by tool_use id) and a
 * duration computed, and the prior boundary so a thinking block's duration is
 * the wall-clock time it represents.
 */
class TranscriptTracker {
  readonly editedFiles = new Set<string>();
  /** The most recent assistant text block, for de-duplicating the result. */
  lastAssistantText = '';
  private toolStart = new Map<string, number>();
  private lastBoundaryMs = Date.now();

  // biome-ignore lint/suspicious/noExplicitAny: SDK message shape
  handle(message: any): void {
    if (!message || typeof message !== 'object') return;
    const type = message.type;

    if (type === 'assistant') {
      const content = message.message?.content ?? message.content;
      const blocks = Array.isArray(content)
        ? content
        : typeof content === 'string'
          ? [{ type: 'text', text: content }]
          : [];
      for (const block of blocks) this.handleBlock(block);
      return;
    }

    if (type === 'user') {
      const content = message.message?.content ?? message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') this.handleToolResult(block);
        }
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK content block shape
  private handleBlock(block: any): void {
    if (!block || typeof block !== 'object') return;
    const now = Date.now();

    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      emitEntry({ id: randomUUID(), role: 'assistant', at: now, text: block.text });
      this.lastAssistantText = block.text;
      this.lastBoundaryMs = now;
      return;
    }

    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      emitEntry({
        id: randomUUID(),
        role: 'thinking',
        at: now,
        text: block.thinking,
        durationMs: Math.max(0, now - this.lastBoundaryMs),
      });
      this.lastBoundaryMs = now;
      return;
    }

    if (block.type === 'tool_use') {
      const id = typeof block.id === 'string' ? block.id : randomUUID();
      const name = String(block.name ?? 'tool');
      this.toolStart.set(id, now);
      emitEntry({
        id,
        role: 'tool',
        at: now,
        toolName: name,
        toolInput: summarizeInput(name, block.input),
        toolStatus: 'running',
      });
      // Track edits so the status line / summary can mention them.
      if ((name === 'Edit' || name === 'Write') && block.input) {
        const file = block.input.file_path ?? block.input.path;
        if (file && !this.editedFiles.has(file)) this.editedFiles.add(file);
      }
      this.lastBoundaryMs = now;
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK tool_result block shape
  private handleToolResult(block: any): void {
    const id = block.tool_use_id;
    if (typeof id !== 'string') return;
    const start = this.toolStart.get(id);
    const now = Date.now();
    this.toolStart.delete(id);
    emitEntry({
      id, // same id → client updates the running tool entry in place
      role: 'tool',
      at: now,
      toolStatus: block.is_error ? 'error' : 'ok',
      toolOutput: flattenToolResult(block.content),
      ...(start != null ? { durationMs: Math.max(0, now - start) } : {}),
    });
    this.lastBoundaryMs = now;
  }
}

/** Legacy status/edit events (kept so the task-panel status line is unchanged). */
// biome-ignore lint/suspicious/noExplicitAny: SDK message shape
function translateLegacy(message: any, edited: Set<string>): RunEvent | null {
  if (!message || typeof message !== 'object') return null;
  if (message.type !== 'assistant') return null;
  const content = message.message?.content ?? message.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'tool_use') {
      const name = block.name;
      if (name === 'Edit' || name === 'Write') {
        const file = block.input?.file_path ?? block.input?.path;
        if (file && edited.has(file)) {
          return { kind: 'edit', file, description: name === 'Write' ? 'wrote' : 'edited' };
        }
      }
      if (name) return { kind: 'status', status: 'editing' };
    }
  }
  return null;
}

const MAX_INPUT = 300;
const MAX_OUTPUT = 600;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** A short, human-readable summary of a tool's input for the chat row. */
// biome-ignore lint/suspicious/noExplicitAny: SDK tool input shape
function summarizeInput(name: string, input: any): string {
  if (input && typeof input === 'object') {
    // The question, not the JSON. This is the one tool whose input is prose the
    // user is about to read anyway, and it lands in the transcript right above
    // their own answer.
    if (name === ASK_USER_QUESTION) {
      const asked = parseQuestions(input);
      if (asked) return truncate(asked.map((q) => q.question).join(' · '), MAX_INPUT);
    }
    if (name === 'Bash' && typeof input.command === 'string') {
      return truncate(`$ ${input.command}`, MAX_INPUT);
    }
    const path = input.file_path ?? input.path ?? input.pattern;
    if (typeof path === 'string') return truncate(path, MAX_INPUT);
  }
  try {
    return truncate(JSON.stringify(input ?? {}), MAX_INPUT);
  } catch {
    return '';
  }
}

/** Tool results are a string or an array of `{type:'text',text}` blocks. */
// biome-ignore lint/suspicious/noExplicitAny: SDK tool_result content shape
function flattenToolResult(content: any): string {
  if (typeof content === 'string') return truncate(content, MAX_OUTPUT);
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    return truncate(text, MAX_OUTPUT);
  }
  return '';
}

void main();
