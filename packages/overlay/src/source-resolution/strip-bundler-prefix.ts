/**
 * Stack traces and `_debugSource.fileName` come prefixed with bundler-specific
 * URL schemes that aren't real filesystem paths. Strip them down to repo-relative
 * paths the agent can actually open.
 *
 * Examples handled:
 *   webpack-internal:///(app-pages-browser)/./app/page.tsx   → app/page.tsx
 *   webpack-internal:///./src/foo.tsx                         → src/foo.tsx
 *   turbopack:///[project]/app/page.tsx                       → app/page.tsx
 *   turbopack://[project]/(ssr)/./components/button.tsx       → components/button.tsx
 *   webpack:///./app/page.tsx                                 → app/page.tsx
 *   /Users/me/repo/app/page.tsx                               → /Users/me/repo/app/page.tsx (kept absolute)
 *   http://localhost:3000/_next/static/chunks/app/page.js     → app/page.js (best-effort)
 */
export function stripBundlerPrefix(raw: string): string {
  let file = raw;

  // webpack-internal:///(app-pages-browser)/./app/page.tsx
  // webpack-internal:///(rsc)/./components/foo.tsx
  // webpack-internal:///./src/foo.tsx
  file = file.replace(/^webpack-internal:\/\/\/(?:\([^)]+\)\/)?\.?\/?/, '');

  // turbopack:///[project]/app/page.tsx
  // turbopack:///[project]/(ssr)/./components/button.tsx
  file = file.replace(/^turbopack:\/\/\/(?:\[[^\]]+\]\/)?(?:\([^)]+\)\/)?\.?\/?/, '');

  // webpack:///./app/page.tsx
  file = file.replace(/^webpack:\/\/(?:[^/]*\/)?(?:\([^)]+\)\/)?\.?\/?/, '');

  // http(s)://host/_next/static/chunks/app/page.js → app/page.js (best-effort)
  file = file.replace(/^https?:\/\/[^/]+\/_next\/static\/chunks\//, '');

  // Strip leading ./ if present
  file = file.replace(/^\.\//, '');

  return file;
}

const FRAMEWORK_NOISE = [
  /\/node_modules\//,
  /^node_modules\//,
  /react(?:-dom)?(?:\.development|\.production|\.profiling)?\.[mc]?js$/,
  /^next\/dist\//,
  /\/next\/dist\//,
  /^scheduler\//,
  /\/scheduler\//,
  /(?:localagents|useiris)/i,
  /^\[native code\]/,
  /webpack-runtime/,
  // Our own overlay bundle when served from the daemon
  /^https?:\/\/[^/]+\/overlay\.js$/,
  /^overlay\.js$/,
  // React DOM internals files
  /react-dom-client/,
  /react-stack-bottom-frame/,
  // Anonymous (eval/dynamic-source) frames — never a real file
  /^<anonymous>$/,
  /^anonymous$/,
];

/** True if this path is framework/library noise we should skip when ranking stack frames. */
export function isFrameworkPath(file: string): boolean {
  return FRAMEWORK_NOISE.some((re) => re.test(file));
}
