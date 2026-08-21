import { createServer } from 'node:net';
import { join } from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import {
  Annotation,
  type AuthStatus,
  type Capabilities,
  type HealthResponse,
  ReasoningEffort,
  VERSION,
} from '@iris/shared';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { getRunner } from './agents';
import type { RunRequest } from './agents/types';
import { type AuthState, resolveAuth, writeConfig } from './auth';
import { backendProvider } from './auth-errors';
import { type ClaudeBinary, resolveClaudeBinary } from './claude-binary';
import { EventBus } from './events';
import { loginAnthropic, loginOpenai, logoutAnthropic, logoutOpenai } from './login';
import { getOverlayJs } from './overlay-bundle';
import { hasGhCli, isGitRepo, resolveRemoteName } from './project';
import { TaskQueue } from './queue';
import { shellHtml } from './shell-html';
import { WorktreeManager } from './worktrees';

// Re-exported so consumers (the CLI banner) keep importing it from here.
export { VERSION };

export type StartOptions = {
  repoRoot: string;
  port?: number | undefined;
  mainPort?: number | undefined;
  devCmd?: string | undefined;
  flagAnthropic?: string | undefined;
  flagOpenai?: string | undefined;
};

export type Orchestrator = {
  port: number;
  mainPort: number;
  auth: AuthState;
  /** Which Claude Code executable agent runs will use. */
  claudeBinary: ClaudeBinary;
  queue: TaskQueue;
  worktrees: WorktreeManager;
  bus: EventBus;
  stop: () => Promise<void>;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reject with the real listen error (EADDRINUSE / EACCES) if `port` can't be
 * bound, so the caller can explain it instead of crashing mid-startup.
 */
function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once('error', rejectPort);
    probe.once('listening', () => probe.close(() => resolvePort()));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * A localhost dev tool that can run code must not accept cross-site requests.
 * Allow requests from any loopback origin (the user's app may run on any port);
 * reject everything else. Requests without an Origin header are non-browser
 * (curl / server-to-server) and are allowed — the daemon binds to loopback only.
 */
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export async function start(opts: StartOptions): Promise<Orchestrator> {
  const port = opts.port ?? 4747;
  const mainPort = opts.mainPort ?? 3000;
  // Mutable so login/logout/save-key endpoints can refresh it in place; the
  // /annotate handler reads the latest value when routing a task.
  let auth = resolveAuth({
    repoRoot: opts.repoRoot,
    flagAnthropic: opts.flagAnthropic,
    flagOpenai: opts.flagOpenai,
  });
  const reResolveAuth = (): AuthState => {
    auth = resolveAuth({
      repoRoot: opts.repoRoot,
      flagAnthropic: opts.flagAnthropic,
      flagOpenai: opts.flagOpenai,
    });
    return auth;
  };

  // Providers whose credential a real run has rejected. The CLIs' cached login
  // records can't be trusted on their own — `claude auth status` still reports a
  // logged-in claude.ai session after its OAuth token has expired beyond refresh
  // — so a run's 401 is what actually tells us the session is dead, and it
  // overrides the record until the user reconnects or a later run succeeds.
  const expired = new Set<'anthropic' | 'openai'>();
  const authStatus = (): AuthStatus => ({
    anthropic: {
      method: auth.anthropic.method,
      configured: auth.anthropic.method !== 'none',
      source: auth.anthropic.source,
      expired: expired.has('anthropic'),
    },
    openai: {
      method: auth.openai.method,
      configured: auth.openai.method !== 'none',
      source: auth.openai.source,
      expired: expired.has('openai'),
    },
  });

  const bus = new EventBus();
  // Task history lives under .git/ — never in the working tree, gone with the
  // repo. A repo without git gets no persistence, matching its no-worktrees
  // capability: everything about it is already session-scoped.
  const taskStateDir = isGitRepo(opts.repoRoot)
    ? join(opts.repoRoot, '.git', 'iris', 'tasks')
    : undefined;
  const queue = new TaskQueue(
    bus,
    (backend, ok) => {
      const provider = backendProvider(backend);
      if (!provider) return;
      if (ok) expired.delete(provider);
      else expired.add(provider);
    },
    taskStateDir,
  );

  const worktrees = new WorktreeManager(opts.repoRoot, bus, mainPort, {
    devCmd: opts.devCmd,
  });

  // Probed once at startup: a repo doesn't become a git repo mid-session, and
  // re-shelling out to git on every /health would be wasteful.
  const capabilities: Capabilities = {
    git: isGitRepo(opts.repoRoot),
    remote: resolveRemoteName(opts.repoRoot) !== null,
    gh: hasGhCli(),
  };

  // Resolved once: shelling out to `claude --version` per run would add
  // latency to every task for an answer that can't change mid-session.
  const claudeBinary = resolveClaudeBinary();

  // Reload persisted task history — before any client connects, so the hello
  // frames already carry it. (Down here because runners need `claudeBinary`.)
  queue.load((backend) => getRunner(backend, auth, claudeBinary));

  const app = new Hono();

  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    // Block cross-site state-changing requests (CSRF / drive-by from any page
    // the user happens to be visiting). See isLoopbackOrigin.
    if (MUTATING_METHODS.has(c.req.method) && origin && !isLoopbackOrigin(origin)) {
      return c.json({ error: 'cross-origin request blocked' }, 403);
    }
    await next();
    if (isLoopbackOrigin(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  app.options('*', (c) => c.body(null, 204));

  // Root: shell page with iframe + viewport switcher.
  app.get('/', (c) => c.html(shellHtml(mainPort), 200, { 'Cache-Control': 'no-store' }));

  app.get('/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      repo: opts.repoRoot,
      version: VERSION,
      capabilities,
    };
    return c.json(body);
  });

  app.get('/auth/status', (c) => c.json(authStatus()));

  // Subscription login: shells out to the provider CLI's OAuth flow (opens the
  // user's browser). On success we pin the method to 'oauth' so the stored
  // credential is used even if an API key is also present.
  app.post('/auth/login/:provider', async (c) => {
    const provider = c.req.param('provider');
    const result =
      provider === 'anthropic'
        ? await loginAnthropic()
        : provider === 'openai'
          ? await loginOpenai()
          : { ok: false, error: `unknown provider "${provider}"` };
    if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
    writeConfig(
      opts.repoRoot,
      provider === 'anthropic' ? { anthropicAuthMethod: 'oauth' } : { openaiAuthMethod: 'oauth' },
    );
    // Fresh session — drop any expired flag from the old one.
    expired.delete(provider === 'anthropic' ? 'anthropic' : 'openai');
    reResolveAuth();
    return c.json({ ok: true, status: authStatus() });
  });

  app.post('/auth/logout/:provider', async (c) => {
    const provider = c.req.param('provider');
    if (provider === 'anthropic') {
      await logoutAnthropic();
      writeConfig(opts.repoRoot, { anthropicAuthMethod: 'none' });
      expired.delete('anthropic');
    } else if (provider === 'openai') {
      await logoutOpenai();
      writeConfig(opts.repoRoot, { openaiAuthMethod: 'none' });
      expired.delete('openai');
    } else {
      return c.json({ ok: false, error: `unknown provider "${provider}"` }, 400);
    }
    reResolveAuth();
    return c.json({ ok: true, status: authStatus() });
  });

  // Save (or clear) an API key, and switch the provider to API-key auth.
  app.post('/auth/key/:provider', async (c) => {
    const provider = c.req.param('provider');
    const raw = (await c.req.json().catch(() => null)) as { key?: unknown } | null;
    const key = typeof raw?.key === 'string' ? raw.key.trim() : '';
    if (provider !== 'anthropic' && provider !== 'openai') {
      return c.json({ ok: false, error: `unknown provider "${provider}"` }, 400);
    }
    writeConfig(
      opts.repoRoot,
      provider === 'anthropic'
        ? { anthropicApiKey: key || undefined, anthropicAuthMethod: key ? 'api-key' : 'none' }
        : { openaiApiKey: key || undefined, openaiAuthMethod: key ? 'api-key' : 'none' },
    );
    // New credential — the previous rejection no longer applies.
    expired.delete(provider);
    reResolveAuth();
    return c.json({ ok: true, status: authStatus() });
  });

  app.get('/overlay.js', async (c) => {
    try {
      const code = await getOverlayJs();
      return c.body(code, 200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`/* iris overlay bundle failed:\n${msg}\n*/`, 500, {
        'Content-Type': 'application/javascript; charset=utf-8',
      });
    }
  });

  app.get('/worktrees', (c) => c.json(worktrees.list()));
  app.post('/worktrees/spawn', async (c) => {
    if (!capabilities.git) {
      return c.json({ error: 'worktree mode needs a git repository' }, 409);
    }
    // Optional `{ prompt }` names the worktree after the task. No body (or an
    // unparseable one) is fine — that's an unnamed spawn, as before.
    const body = await c.req.json().catch(() => null);
    const prompt =
      body && typeof body === 'object' && typeof (body as { prompt?: unknown }).prompt === 'string'
        ? (body as { prompt: string }).prompt
        : undefined;
    try {
      const { worktree, checkout } = await worktrees.spawnWorktree(prompt);
      // The clone continues past this response. Nobody is awaiting it here, so
      // swallow the rejection rather than leaving it unhandled — it is already
      // reported through the worktree's own status.
      checkout.catch(() => {});
      return c.json({ worktree });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  app.post('/worktrees/:slug/ship', async (c) => {
    const slug = c.req.param('slug');
    const result = await worktrees.shipIt(slug);
    // `replaced` names uncommitted files the merge overwrote. They're in a git
    // stash; the UI has to say so or the only trace is a daemon log line.
    if (result.ok) return c.json({ ok: true, replaced: result.replaced ?? [] });
    return c.json({ error: result.error }, 400);
  });
  app.post('/worktrees/:slug/pr', async (c) => {
    if (!capabilities.git) {
      return c.json({ error: 'pull requests need a git repository' }, 409);
    }
    if (!capabilities.remote) {
      return c.json(
        { error: 'no git remote configured — add one with `git remote add origin <url>`' },
        409,
      );
    }
    // Optional `{ title, body }` overrides. No body is the normal case: the
    // title then falls back to the branch's head commit subject.
    const raw = await c.req.json().catch(() => null);
    const body = raw && typeof raw === 'object' ? (raw as { title?: unknown; body?: unknown }) : {};
    const result = await worktrees.createPullRequest(c.req.param('slug'), {
      ...(typeof body.title === 'string' && body.title.trim() ? { title: body.title.trim() } : {}),
      ...(typeof body.body === 'string' ? { body: body.body } : {}),
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result);
  });
  app.delete('/worktrees/:slug', async (c) => {
    const slug = c.req.param('slug');
    try {
      await worktrees.remove(slug);
      // Their records too: rows that outlive their worktree would reload at
      // the next boot with every button pointing at deleted files.
      queue.removeBySlug(slug);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.post('/annotate', async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = Annotation.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid annotation', details: parsed.error.format() }, 400);
    }
    const annotation = parsed.data;

    const runner = getRunner(annotation.backend, auth, claudeBinary);
    if (!runner) {
      return c.json({ error: `backend "${annotation.backend}" not available yet` }, 400);
    }

    let worktreeSlug = 'main';
    let worktreePath = opts.repoRoot;

    if (annotation.worktreeMode === 'new' && !capabilities.git) {
      return c.json(
        { error: 'worktree mode needs a git repository — re-run in one, or pick "same".' },
        409,
      );
    }

    // Gates the agent on the worktree's clone. Undefined for same-worktree runs,
    // which have nothing to wait for.
    let checkout: Promise<void> | undefined;

    if (annotation.worktreeMode === 'new') {
      try {
        const pending = await worktrees.spawnWorktree(annotation.prompt);
        worktreeSlug = pending.worktree.slug;
        worktreePath = pending.worktree.path;
        checkout = pending.checkout;
        // Readiness is best-effort (only affects preview availability, not the
        // agent run). Swallow its rejection so a slow/failed dev server can't
        // crash the daemon.
        worktrees.waitForReady(worktreeSlug).catch((err) => {
          console.error(`[iris] worktree ${worktreeSlug} dev server not ready:`, String(err));
        });
      } catch (err) {
        // Only naming/port allocation can fail this early; the clone itself
        // reports through the task row.
        return c.json({ error: `worktree spawn failed: ${String(err)}` }, 500);
      }
    }

    const request: Omit<RunRequest, 'signal'> = {
      prompt: annotation.prompt,
      source: annotation.source,
      componentPath: annotation.componentPath,
      selector: annotation.selector ?? '',
      text: annotation.nearbyText,
      images: annotation.images,
      cwd: worktreePath,
      // The picker's values are already in each backend's own spelling, so the
      // user's choice rides straight through to the runner. `model` defaults to
      // '' (nothing picked) — omit it then so the backend keeps its default.
      ...(annotation.model ? { model: annotation.model } : {}),
      effort: annotation.reasoningEffort,
    };

    const task = queue.enqueue(annotation, runner, request, worktreeSlug, checkout);
    return c.json({ task });
  });

  app.delete('/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = queue.cancel(id);
    return c.json({ cancelled: ok });
  });

  // Archive: drop a finished task's row, transcript, and file for good. The
  // drawer's Archive button calls this alongside its local hide — without the
  // server half, persistence would resurrect every archived row at boot.
  app.post('/tasks/:id/archive', (c) => {
    const result = queue.archive(c.req.param('id'));
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ ok: true });
  });

  // Full structured transcript for a task (chat history beyond the live buffer).
  app.get('/tasks/:id/transcript', (c) => {
    const id = c.req.param('id');
    return c.json({ entries: queue.getTranscript(id) });
  });

  // Follow-up message: resume the task's session with a new prompt.
  app.post('/tasks/:id/message', async (c) => {
    const id = c.req.param('id');
    const raw = (await c.req.json().catch(() => null)) as {
      text?: unknown;
      model?: unknown;
      reasoningEffort?: unknown;
    } | null;
    const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
    if (!text) return c.json({ error: 'message text required' }, 400);
    // The chat composer carries its own model + effort pickers, so a follow-up
    // can change either mid-thread. Both are optional: an older client that
    // sends only `text` keeps whatever the previous turn ran with.
    const effort = ReasoningEffort.safeParse(raw?.reasoningEffort);
    const result = queue.continue(id, text, {
      ...(typeof raw?.model === 'string' && raw.model ? { model: raw.model } : {}),
      ...(effort.success ? { effort: effort.data } : {}),
    });
    if (!result.ok) {
      const status = result.error === 'task not found' ? 404 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({ task: result.task });
  });

  // Bind to loopback only: the daemon runs agents that edit files and execute
  // shell commands, so it must never be reachable from the LAN.
  //
  // Subscription-login endpoints block while the user completes the browser
  // OAuth flow (claude setup-token / codex login can take a minute-plus).
  // Node's default requestTimeout is 300s, comfortably above login.ts's
  // 180s LOGIN_TIMEOUT_MS, so no override is needed here (Bun's 10s default
  // did need one).
  //
  // Check the port before handing it to serve(). A failed bind surfaces
  // asynchronously as an 'error' event on a server we don't own, which Node
  // reports as an unhandled 'error' — the CLI would print a success banner and
  // only then fall over. Failing here instead lets start() reject cleanly so
  // the CLI can explain the collision. (Racy in principle; harmless for a
  // single-user localhost daemon.)
  await assertPortAvailable(port);
  const server: ServerType = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });

  // WebSocket for live task/worktree updates, sharing the HTTP server.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // malformed URL; reject below
    }
    if (pathname !== '/tasks' || (req.headers.origin && !isLoopbackOrigin(req.headers.origin))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      bus.attach(ws);
      bus.sendHello(ws, worktrees.list(), queue.list(), capabilities);
      ws.on('close', () => bus.detach(ws));
    });
  });

  return {
    port,
    mainPort,
    auth,
    claudeBinary,
    queue,
    worktrees,
    bus,
    stop: async () => {
      // Stop dev servers but KEEP the worktrees: they're durable now, and the
      // next boot's reconcile() re-adopts them. Deleting here is how a plain
      // Ctrl-C used to destroy unmerged agent work.
      await worktrees.shutdown();
      for (const client of wss.clients) client.terminate();
      wss.close();
      // `close()` alone waits for idle keep-alive sockets — a single open
      // browser tab kept the old daemon alive through SIGTERM forever. Sever
      // them explicitly (guarded: Bun's http shim may not implement it).
      (server as Partial<{ closeAllConnections: () => void }>).closeAllConnections?.();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}
