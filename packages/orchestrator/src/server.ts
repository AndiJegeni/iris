import { Annotation } from '@localagents/shared';
import { Hono } from 'hono';
import { getRunner } from './agents';
import type { RunRequest } from './agents/types';
import { resolveAuth, type AuthState } from './auth';
import { EventBus, type WsClientData } from './events';
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
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  app.options('*', (c) => c.body(null, 204));

  app.get('/', (c) =>
    c.html(shellHtml(mainPort), 200, {
      // Critical: allow our shell to embed user's dev server in an iframe.
      // We can't strip the user's app's X-Frame-Options/CSP from here, but most
      // dev servers (Next/Vite/etc.) don't set them by default.
      'Cache-Control': 'no-store',
    }),
  );

  app.get('/health', (c) =>
    c.json({ ok: true as const, repo: opts.repoRoot, version: VERSION }),
  );

  app.get('/auth/status', (c) =>
    c.json({
      anthropic: { configured: Boolean(auth.anthropic), source: auth.source.anthropic },
      openai: { configured: Boolean(auth.openai), source: auth.source.openai },
    }),
  );

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

  /**
   * POST /annotate
   * Body: Annotation. Picks the target worktree (same / new), enqueues a task,
   * returns the created task. Live progress via WS /tasks.
   */
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

    // Pick target worktree.
    let worktreeSlug = 'main';
    let worktreePath = opts.repoRoot;

    if (annotation.worktreeMode === 'new') {
      try {
        const wt = await worktrees.spawnWorktree();
        worktreeSlug = wt.slug;
        worktreePath = wt.path;
        // Kick off readiness wait in the background; queue serializes within slug
        // so the task starts only after the dev server is up.
        void worktrees.waitForReady(wt.slug);
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

  const server = Bun.serve<WsClientData, never>({
    port,
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
