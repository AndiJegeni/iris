import type { Server } from 'bun';
import { Hono } from 'hono';
import { resolveAuth, type AuthState } from './auth';

export const VERSION = '0.0.1';

export type StartOptions = {
  repoRoot: string;
  port?: number;
  flagAnthropic?: string | undefined;
  flagOpenai?: string | undefined;
};

export type Orchestrator = {
  server: Server;
  port: number;
  auth: AuthState;
  stop: () => Promise<void>;
};

export async function start(opts: StartOptions): Promise<Orchestrator> {
  const port = opts.port ?? 4747;
  const auth = resolveAuth({
    repoRoot: opts.repoRoot,
    flagAnthropic: opts.flagAnthropic,
    flagOpenai: opts.flagOpenai,
  });

  const app = new Hono();

  // CORS for the overlay loaded from the user's dev server (different origin).
  app.use('*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  app.options('*', (c) => c.body(null, 204));

  app.get('/health', (c) =>
    c.json({
      ok: true as const,
      repo: opts.repoRoot,
      version: VERSION,
    }),
  );

  app.get('/auth/status', (c) =>
    c.json({
      anthropic: {
        configured: Boolean(auth.anthropic),
        source: auth.source.anthropic,
      },
      openai: {
        configured: Boolean(auth.openai),
        source: auth.source.openai,
      },
    }),
  );

  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });

  return {
    server,
    port: server.port,
    auth,
    stop: async () => {
      server.stop(true);
    },
  };
}
