import type { SourceLocation } from '@iris/shared';
import { stripBundlerPrefix } from './strip-bundler-prefix';

// React Fiber is internal — we type just the fields we touch.
export type Fiber = {
  tag: number;
  // biome-ignore lint/suspicious/noExplicitAny: fiber.type is anything React renders
  type: any;
  // biome-ignore lint/suspicious/noExplicitAny: props are user-defined
  memoizedProps: any;
  // biome-ignore lint/suspicious/noExplicitAny: state is user-defined
  memoizedState: any;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode: unknown;
  _debugSource?: {
    fileName: string;
    lineNumber: number;
    columnNumber?: number;
  };
  _debugOwner?: Fiber;
};

/**
 * React hangs `__reactFiber$<random>` (and `__reactProps$<random>`) on every
 * host DOM node it renders. Find ours and return the fiber it points at.
 */
export function getFiberFromDom(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith('__reactFiber$')) {
      // biome-ignore lint/suspicious/noExplicitAny: index access on element
      return (el as any)[key] as Fiber;
    }
  }
  return null;
}

export type DebugSource = SourceLocation;

/**
 * Walk `fiber.return` looking for `_debugSource`. In Vite + dev React this is
 * populated by `@babel/plugin-transform-react-jsx-development`. Next.js + SWC
 * strips it; in that case this returns null and we fall through to the
 * dispatcher-fallback probe.
 */
export function findDebugSource(start: Fiber): DebugSource | null {
  let cur: Fiber | null = start;
  while (cur) {
    if (cur._debugSource?.fileName) {
      return {
        file: stripBundlerPrefix(cur._debugSource.fileName),
        line: cur._debugSource.lineNumber,
        column: cur._debugSource.columnNumber,
      };
    }
    if (cur._debugOwner?._debugSource?.fileName) {
      return {
        file: stripBundlerPrefix(cur._debugOwner._debugSource.fileName),
        line: cur._debugOwner._debugSource.lineNumber,
        column: cur._debugOwner._debugSource.columnNumber,
      };
    }
    cur = cur.return;
  }
  return null;
}

/** Find the nearest fiber whose type is a function (user-authored component). */
export function findOwningComponentFiber(start: Fiber): Fiber | null {
  let cur: Fiber | null = start;
  while (cur) {
    if (typeof cur.type === 'function') return cur;
    cur = cur.return;
  }
  return null;
}
