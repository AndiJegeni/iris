import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Real runtime dependencies (declared in package.json `dependencies`) stay
// external; everything else (@iris/* internals) is bundled in. esbuild
// is externalized because the daemon only `import()`s it in the dev fallback,
// never in a built install (where the prebuilt overlay.js ships).
const nodeExternals = [
  '@anthropic-ai/claude-agent-sdk',
  '@hono/node-server',
  'hono',
  'ws',
  'zod',
  'esbuild',
];

const nodeCommon = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: nodeExternals,
  logLevel: 'info',
};

// 1. CLI daemon entry — orchestrator + shared bundled in.
await build({
  ...nodeCommon,
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(dist, 'index.js'),
  banner: { js: '#!/usr/bin/env node' },
});

// 2. Agent worker — spawned as its own Node process (cwd = the worktree).
await build({
  ...nodeCommon,
  entryPoints: [resolve(here, '../orchestrator/src/agents/claude-worker.ts')],
  outfile: resolve(dist, 'claude-worker.js'),
});

// 3. Overlay — prebuilt browser bundle (preact inlined), served at /overlay.js.
await build({
  entryPoints: [resolve(here, '../overlay/src/index.tsx')],
  outfile: resolve(dist, 'overlay.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  logLevel: 'info',
});

console.log('✓ built iris → packages/cli/dist/');
