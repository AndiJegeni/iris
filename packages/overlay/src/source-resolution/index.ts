import type { SourceLocation } from '@iris/shared';
import { collectComponentPath } from './component-path';
import { probeSourceViaDispatcher } from './dispatcher-fallback';
import { findDebugSource, getFiberFromDom } from './fiber';

export type Confidence = 'explicit' | 'high' | 'medium' | 'low' | 'none';

/** Attribute that pins an element's source file, overriding fiber resolution. */
export const SOURCE_OVERRIDE_ATTR = 'data-iris-source';

export type ResolvedSource = SourceLocation;

export type Resolution = {
  source: ResolvedSource | null;
  componentPath: string[];
  confidence: Confidence;
  /** Stable-ish CSS-like selector for the element (best-effort). */
  selector: string;
  /** Truncated text content for context. */
  text: string | null;
};

const MAX_TEXT_LEN = 120;

/**
 * Source resolution for a picked DOM element, best confidence first:
 *
 *   explicit — a `data-iris-source` attribute on the element or an
 *              ancestor pins the file directly. Wins over fiber walking. Used by
 *              the component gallery (Preact-in-React mounts whose fiber points
 *              at the wrapper, not the real source) and handy for wrapping
 *              third-party widgets.
 *   high     — `_debugSource` found on the fiber chain (Vite, dev React with the
 *              Babel JSX-dev transform).
 *   medium   — throwing-dispatcher probe succeeded (works on Next.js + SWC +
 *              React 19 when the React bridge is set up by <Iris />).
 *   low      — no source resolved; only a CSS selector + text content available.
 *   none     — no React fiber at all (raw HTML, third-party widget).
 */
export function resolveSource(element: Element): Resolution {
  const selector = computeSelector(element);
  const text = readNearbyText(element);

  const fiber = getFiberFromDom(element);
  const componentPath = fiber ? collectComponentPath(fiber) : [];

  const override = findSourceOverride(element);
  if (override) {
    return { source: override, componentPath, confidence: 'explicit', selector, text };
  }

  if (!fiber) {
    return { source: null, componentPath: [], confidence: 'none', selector, text };
  }

  const debugSrc = findDebugSource(fiber);
  if (debugSrc) {
    return { source: debugSrc, componentPath, confidence: 'high', selector, text };
  }

  const probed = probeSourceViaDispatcher(fiber);
  if (probed) {
    return { source: probed, componentPath, confidence: 'medium', selector, text };
  }

  return { source: null, componentPath, confidence: 'low', selector, text };
}

/**
 * Look for a `data-iris-source` attribute on the element or nearest
 * ancestor and parse it into a source location. Value format:
 *   "path/to/file.tsx"            → line 1
 *   "path/to/file.tsx:42"         → line 42
 *   "path/to/file.tsx:42:8"       → line 42, column 8
 */
function findSourceOverride(element: Element): ResolvedSource | null {
  const host = element.closest(`[${SOURCE_OVERRIDE_ATTR}]`);
  const raw = host?.getAttribute(SOURCE_OVERRIDE_ATTR)?.trim();
  if (!raw) return null;

  // Peel trailing numeric segments as line/column. File paths may themselves
  // contain colons (rare), so only treat purely-numeric tail segments as coords.
  const parts = raw.split(':');
  let line = 1;
  let column: number | undefined;
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1] as string)) {
    const last = Number.parseInt(parts.pop() as string, 10);
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1] as string)) {
      line = Number.parseInt(parts.pop() as string, 10);
      column = last;
    } else {
      line = last;
    }
  }
  const file = parts.join(':');
  if (!file) return null;
  return { file, line, column };
}

/**
 * Build a short CSS-like selector. Prefers (in order): id, data-testid,
 * aria-label, role+text, tag + class chain. Not guaranteed unique.
 */
function computeSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${testid}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `[aria-label="${aria}"]`;
  const tag = el.tagName.toLowerCase();
  const classes = (el.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  return `${tag}${classes}`;
}

function readNearbyText(el: Element): string | null {
  const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_TEXT_LEN ? `${t.slice(0, MAX_TEXT_LEN)}…` : t;
}

export { collectComponentPath } from './component-path';
export { findDebugSource, getFiberFromDom } from './fiber';
export { stripBundlerPrefix, isFrameworkPath } from './strip-bundler-prefix';
