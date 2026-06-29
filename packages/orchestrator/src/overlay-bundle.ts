import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the prebuilt overlay bundle that ships next to the built daemon
 * (`dist/overlay.js`). Present in published/built installs; absent when running
 * from source in the monorepo (dev), where we fall back to bundling on the fly.
 */
function prebuiltPath(): string {
  return resolve(here, 'overlay.js');
}

/**
 * Find the overlay entry point for the dev fallback. From source the daemon
 * runs at `<repo>/packages/orchestrator/src/overlay-bundle.ts`, with the overlay
 * at `<repo>/packages/overlay/src/index.tsx`.
 */
function resolveOverlayEntry(): string {
  const fromSource = resolve(here, '../../overlay/src/index.tsx');
  if (existsSync(fromSource)) return fromSource;
  throw new Error('Could not locate @localagents/overlay entry point');
}

let cache: string | null = null;
let inflight: Promise<string> | null = null;

/**
 * Bundle the overlay into a single browser-targeted ESM string. In a built
 * install this just reads the prebuilt `dist/overlay.js`. In dev it bundles the
 * overlay source with esbuild (imported dynamically so esbuild stays a
 * build-time-only dependency and is never required at runtime). Cached for the
 * lifetime of the daemon.
 */
export async function getOverlayJs(): Promise<string> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const prebuilt = prebuiltPath();
    if (existsSync(prebuilt)) {
      cache = readFileSync(prebuilt, 'utf8');
      return cache;
    }
    cache = await bundleFromSource();
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function bundleFromSource(): Promise<string> {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [resolveOverlayEntry()],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    sourcemap: 'inline',
    write: false,
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('Overlay bundle produced no output');
  return out.text;
}
