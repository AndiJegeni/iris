import type { Fiber } from './fiber';

const NOISE_PATTERNS = [
  // Generic React patterns
  /Boundary$/,
  /Provider$/,
  /Consumer$/,
  /Context$/, // catches LayoutRouterContext, RenderFromTemplateContext, TemplateContext
  /^Suspense/,
  /^StrictMode$/,
  /^Fragment$/,
  /^Anonymous$/,
  // Next.js app-router internals
  /Router$/,
  /^Layout$/,
  /^InnerLayout/,
  /^OuterLayout/,
  /Handler$/, // ScrollAndFocusHandler, InnerScrollAndFocusHandler
  /^Client(?:Page|Segment|Root)/,
  /^Server(?:Page|Segment|Root)/,
  /^SegmentView/,
  /^RouteAnnounce/,
  /^RedirectError/,
  /^NotFound/,
  /^ReactDevOverlay/,
  /^DevToolsErrorOverlay/,
  /^Hot(?:Reloader|Update)/,
  /^MetadataBoundary/,
  /^ViewTransitions/,
  /^AppRouter/,
  /^GlobalError/,
  /^DevToolsIndicatorOnPageStatic/,
  /^TemplateContext/,
  /^HotReload/,
  /^Root$/,
  /^__next_root_layout_boundary__$/,
  /^OutletBoundary/,
  /^ActionQueue/,
  /^ErrorBoundary/,
  /Reload$/,
];

function nameOf(fiber: Fiber): string | null {
  const t = fiber.type;
  if (typeof t === 'string') return null;
  if (typeof t === 'function') {
    return t.displayName ?? t.name ?? null;
  }
  if (t && typeof t === 'object') {
    return t.displayName ?? t.name ?? null;
  }
  return null;
}

/**
 * Walk up the fiber chain collecting React component display names. Skips
 * framework noise (Boundaries, Providers, Next.js internals). Returns names
 * outermost-first, capped to `limit`.
 *
 * Example: ['Home', 'Layout'] for an h1 inside <Home/> inside <Layout/>.
 */
export function collectComponentPath(start: Fiber, limit = 5): string[] {
  const names: string[] = [];
  let cur: Fiber | null = start;
  while (cur && names.length < limit) {
    const name = nameOf(cur);
    if (name && !NOISE_PATTERNS.some((re) => re.test(name))) {
      // Dedupe consecutive (sometimes same name appears twice in fiber chain)
      if (names[names.length - 1] !== name) names.push(name);
    }
    cur = cur.return;
  }
  return names;
}
