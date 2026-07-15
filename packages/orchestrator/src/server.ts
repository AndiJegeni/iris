import { Annotation } from '@localagents/shared';
import { Hono } from 'hono';
import { getRunner } from './agents';
import type { RunRequest } from './agents/types';
import { type AuthState, resolveAuth, writeConfig } from './auth';
import { backendProvider } from './auth-errors';
import { EventBus, type WsClientData } from './events';
import { loginAnthropic, loginOpenai, logoutAnthropic, logoutOpenai } from './login';
import { bundleOverlay } from './overlay-bundle';
import { TaskQueue } from './queue';
import { shellHtml } from './shell-html';
import { WorktreeManager } from './worktrees';

type BunServer = ReturnType<typeof Bun.serve>;

export const VERSION = '0.0.1';

export type StartOptions = {
  repoRoot: string;
  port?: number | undefined;
  mainPort?: number | undefined;
  devCmd?: string | undefined;
  flagAnthropic?: string | undefined;
  flagOpenai?: string | undefined;
};

export type Orchestrator = {
  server: BunServer;
  port: number;
  mainPort: number;
  auth: AuthState;
  queue: TaskQueue;
  worktrees: WorktreeManager;
  bus: EventBus;
  stop: () => Promise<void>;
};

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
  const authStatus = () => ({
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
  const queue = new TaskQueue(bus, (backend, ok) => {
    const provider = backendProvider(backend);
    if (!provider) return;
    if (ok) expired.delete(provider);
    else expired.add(provider);
  });
  const worktrees = new WorktreeManager(opts.repoRoot, bus, mainPort, {
    devCmd: opts.devCmd,
  });

  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  app.options('*', (c) => c.body(null, 204));

  // Root: shell page with iframe + viewport switcher (M5).
  app.get('/', (c) => c.html(shellHtml(mainPort), 200, { 'Cache-Control': 'no-store' }));

  app.get('/health', (c) => c.json({ ok: true as const, repo: opts.repoRoot, version: VERSION }));

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
      const code = await bundleOverlay();
      return new Response(code, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`/* localagents overlay bundle failed:\n${msg}\n*/`, 500, {
        'Content-Type': 'application/javascript; charset=utf-8',
      });
    }
  });

  app.get('/worktrees', (c) => c.json(worktrees.list()));
  app.post('/worktrees/spawn', async (c) => {
    try {
      const wt = await worktrees.spawnWorktree();
      return c.json({ worktree: wt });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  app.post('/worktrees/:slug/ship', async (c) => {
    const slug = c.req.param('slug');
    const result = await worktrees.shipIt(slug);
    if (result.ok) return c.json({ ok: true });
    return c.json({ error: result.error }, 400);
  });
  app.delete('/worktrees/:slug', async (c) => {
    const slug = c.req.param('slug');
    try {
      await worktrees.remove(slug);
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

    const runner = getRunner(annotation.backend, auth);
    if (!runner) {
      return c.json({ error: `backend "${annotation.backend}" not available yet` }, 400);
    }

    let worktreeSlug = 'main';
    let worktreePath = opts.repoRoot;

    if (annotation.worktreeMode === 'new') {
      try {
        const wt = await worktrees.spawnWorktree();
        worktreeSlug = wt.slug;
        worktreePath = wt.path;
        // Readiness is best-effort (only affects preview availability, not the
        // agent run). Swallow its rejection so a slow/failed dev server can't
        // crash the daemon.
        worktrees.waitForReady(wt.slug).catch((err) => {
          console.error(`[localagents] worktree ${wt.slug} dev server not ready:`, String(err));
        });
      } catch (err) {
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
    };

    const task = queue.enqueue(annotation, runner, request, worktreeSlug);
    return c.json({ task });
  });

  app.delete('/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = queue.cancel(id);
    return c.json({ cancelled: ok });
  });

  // Full structured transcript for a task (chat history beyond the live buffer).
  app.get('/tasks/:id/transcript', (c) => {
    const id = c.req.param('id');
    return c.json({ entries: queue.getTranscript(id) });
  });

  // Follow-up message: resume the task's session with a new prompt.
  app.post('/tasks/:id/message', async (c) => {
    const id = c.req.param('id');
    const raw = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
    if (!text) return c.json({ error: 'message text required' }, 400);
    const result = queue.continue(id, text);
    if (!result.ok) {
      const status = result.error === 'task not found' ? 404 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({ task: result.task });
  });

  const server = Bun.serve<WsClientData, never>({
    port,
    // Subscription-login endpoints block while the user completes the browser
    // OAuth flow (claude setup-token / codex login can take a minute-plus). The
    // default 10s idle timeout would kill the request — and leave an orphaned
    // CLI process — long before the user finishes. Bun caps this at 255s.
    idleTimeout: 255,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/tasks' && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const upgraded = srv.upgrade(req, { data: { id: crypto.randomUUID() } as WsClientData });
        if (upgraded) return undefined;
        return new Response('upgrade failed', { status: 426 });
      }
      return app.fetch(req);
    },
    websocket: {
      open(ws) {
        bus.attach(ws);
        bus.sendHello(ws, worktrees.list(), queue.list());
      },
      message() {
        // No inbound messages in v0.
      },
      close(ws) {
        bus.detach(ws);
      },
    },
  });

  return {
    server,
    port: server.port ?? port,
    mainPort,
    auth,
    queue,
    worktrees,
    bus,
    stop: async () => {
      await worktrees.cleanup();
      server.stop(true);
    },
  };
}
