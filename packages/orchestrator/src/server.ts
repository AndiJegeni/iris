import { type ServerType, serve } from '@hono/node-server';
import { Annotation } from '@localagents/shared';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { getRunner } from './agents';
import type { RunRequest } from './agents/types';
import { type AuthState, resolveAuth } from './auth';
import { EventBus } from './events';
import { getOverlayJs } from './overlay-bundle';
import { TaskQueue } from './queue';
import { shellHtml } from './shell-html';
import { WorktreeManager } from './worktrees';

export const VERSION = '0.1.0';

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
  queue: TaskQueue;
  worktrees: WorktreeManager;
  bus: EventBus;
  stop: () => Promise<void>;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
  const auth = resolveAuth({
    repoRoot: opts.repoRoot,
    flagAnthropic: opts.flagAnthropic,
    flagOpenai: opts.flagOpenai,
  });

  const bus = new EventBus();
  const queue = new TaskQueue(bus);
  const worktrees = new WorktreeManager(opts.repoRoot, bus, mainPort, {
    devCmd: opts.devCmd,
  });

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

  app.get('/health', (c) => c.json({ ok: true as const, repo: opts.repoRoot, version: VERSION }));

  app.get('/auth/status', (c) =>
    c.json({
      anthropic: { configured: Boolean(auth.anthropic), source: auth.source.anthropic },
      openai: { configured: Boolean(auth.openai), source: auth.source.openai },
    }),
  );

  app.get('/overlay.js', async (c) => {
    try {
      const code = await getOverlayJs();
      return c.body(code, 200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
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

    const runner = getRunner(annotation.backend, {
      anthropicKey: auth.anthropic,
      openaiKey: auth.openai,
    });
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

  // Bind to loopback only: the daemon runs agents that edit files and execute
  // shell commands, so it must never be reachable from the LAN.
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
      bus.sendHello(ws, worktrees.list(), queue.list());
      ws.on('close', () => bus.detach(ws));
    });
  });

  return {
    port,
    mainPort,
    auth,
    queue,
    worktrees,
    bus,
    stop: async () => {
      await worktrees.cleanup();
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}
