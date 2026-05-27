import { collectComponentPath } from './component-path';
import { probeSourceViaDispatcher } from './dispatcher-fallback';
import { findDebugSource, getFiberFromDom } from './fiber';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export type ResolvedSource = {
  file: string;
  line: number;
  column?: number | undefined;
};

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
 * Three-tier source resolution for a picked DOM element:
 *
 *   high   — `_debugSource` found on the fiber chain (Vite, dev React with the
 *            Babel JSX-dev transform).
 *   medium — throwing-dispatcher probe succeeded (works on Next.js + SWC +
 *            React 19 when the React bridge is set up by <LocalAgents/>).
 *   low    — no source resolved; only a CSS selector + text content available.
 *   none   — no React fiber at all (raw HTML, third-party widget).
 */
export function resolveSource(element: Element): Resolution {
  const selector = computeSelector(element);
  const text = readNearbyText(element);

  const fiber = getFiberFromDom(element);
  if (!fiber) {
    return { source: null, componentPath: [], confidence: 'none', selector, text };
  }

  const componentPath = collectComponentPath(fiber);

  const debugSrc = findDebugSource(fiber);
  if (debugSrc) {
    return {
      source: debugSrc,
      componentPath,
      confidence: 'high',
      selector,
      text,
    };
  }

  const probed = probeSourceViaDispatcher(fiber);
  if (probed) {
    return {
      source: probed,
      componentPath,
      confidence: 'medium',
      selector,
      text,
    };
  }

  return {
    source: null,
    componentPath,
    confidence: 'low',
    selector,
    text,
  };
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
