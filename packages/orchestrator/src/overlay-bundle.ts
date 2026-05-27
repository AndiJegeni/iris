import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Find the overlay entry point relative to this module. Walks up looking for
 * `packages/overlay/src/index.ts` — works both when the orchestrator is run
 * from source in the monorepo and from a published install where the overlay
 * is a sibling under node_modules.
 */
export function resolveOverlayEntry(): string {
  // Source location: <repo>/packages/orchestrator/src/overlay-bundle.ts
  // Overlay source:  <repo>/packages/overlay/src/index.tsx
  const fromSource = resolve(import.meta.dir, '../../overlay/src/index.tsx');
  if (existsSync(fromSource)) return fromSource;

  // Published install fallback: walk up looking for node_modules/@localagents/overlay/src/index.tsx
  let dir = import.meta.dir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'node_modules/@localagents/overlay/src/index.tsx');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error('Could not locate @localagents/overlay entry point');
}

type BundleCache = { code: string; mtimeKey: string } | null;
let cache: BundleCache = null;
let inflight: Promise<string> | null = null;

/**
 * Bundle the overlay package into a single browser-targeted ESM string.
 * Results are cached for the lifetime of the daemon; re-bundle on first hit
 * after process restart. Future enhancement: file-watch + invalidate.
 */
export async function bundleOverlay(): Promise<string> {
  if (cache) return cache.code;
  if (inflight) return inflight;

  inflight = (async () => {
    const entry = resolveOverlayEntry();
    const result = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: false,
      sourcemap: 'inline',
    });

    if (!result.success) {
      const errs = result.logs.map((l) => l.message).join('\n');
      throw new Error(`Overlay bundle failed:\n${errs}`);
    }

    const out = result.outputs[0];
    if (!out) throw new Error('Overlay bundle produced no output');

    const code = await out.text();
    cache = { code, mtimeKey: String(Date.now()) };
    return code;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Reset the cache. Called on hot-reload signals (future). */
export function invalidateOverlay(): void {
  cache = null;
}
