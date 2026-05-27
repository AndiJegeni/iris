import type { Fiber } from './fiber';
import { findOwningComponentFiber } from './fiber';
import { getDispatcherBridge } from './react-detection';
import { isFrameworkPath, stripBundlerPrefix } from './strip-bundler-prefix';

const PROBE_SENTINEL = '__LOCALAGENTS_PROBE__';

export type ProbeResult = {
  file: string;
  line: number;
  column?: number | undefined;
};

/**
 * Throwing-dispatcher probe.
 *
 * When _debugSource is unavailable (Next.js + SWC strips it), we coerce React
 * into telling us where a component is defined via its stack trace:
 *
 *   1. Walk up to a fiber with a function `type` (user component).
 *   2. Swap React's current hooks dispatcher with a Proxy whose every method
 *      throws our sentinel error.
 *   3. Synchronously call `Component(props)`. If the component uses any hook
 *      (useState, useContext, etc.) it'll call into our dispatcher and throw.
 *   4. Parse the resulting stack to find the first frame in user code (i.e.
 *      not React internals, not node_modules, not our own injected code).
 *   5. Restore the original dispatcher in `finally` — losing it leaves React
 *      broken until next render.
 *
 * Caveats:
 *   - Components without hooks won't throw. We fall back further then.
 *   - Components that throw for unrelated reasons (e.g. missing props) before
 *     reaching a hook give us a useless stack; we detect and reject those.
 *   - Effects might fire during the probe call. We don't try to suppress them;
 *     it's a one-shot debug-only operation invoked on user pick.
 */
export function probeSourceViaDispatcher(start: Fiber): ProbeResult | null {
  const bridge = getDispatcherBridge();
  if (!bridge) return null;

  const componentFiber = findOwningComponentFiber(start);
  if (!componentFiber) return null;

  const Component = componentFiber.type as (props: unknown) => unknown;
  const props = componentFiber.memoizedProps ?? {};

  const throwingDispatcher = makeThrowingDispatcher();
  const original = bridge.read();
  bridge.write(throwingDispatcher);

  try {
    let caught: unknown;
    try {
      Component(props);
    } catch (err) {
      caught = err;
    }

    if (!(caught instanceof Error) || !caught.stack) return null;
    // We only trust stacks produced by our own sentinel — unrelated errors
    // (e.g. a TypeError from accessing props.foo) won't have the sentinel.
    if (!caught.message.includes(PROBE_SENTINEL)) return null;

    return parseStackForUserFrame(caught.stack);
  } finally {
    bridge.write(original);
  }
}

function makeThrowingDispatcher(): unknown {
  // Any hook call (useState, useReducer, useContext, useEffect, useMemo, ...)
  // does `dispatcher.useFoo(...)`. The Proxy intercepts every property access
  // and returns a function that throws our sentinel error.
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error(PROBE_SENTINEL);
        };
      },
    },
  );
}

/**
 * Parse a stack trace and return the first frame that looks like user code.
 * Stack lines look like one of:
 *   "    at useState (webpack-internal:///(app-pages-browser)/./app/page.tsx:14:5)"
 *   "    at Home (http://localhost:3000/_next/static/chunks/app/page.js:123:45)"
 *   "    at /Users/me/repo/app/page.tsx:14:5"
 */
function parseStackForUserFrame(stack: string): ProbeResult | null {
  const lines = stack.split('\n');
  for (const raw of lines) {
    const frame = parseStackLine(raw);
    if (!frame) continue;
    if (isFrameworkPath(frame.file)) continue;
    return frame;
  }
  return null;
}

/**
 * Parse a single stack line.
 *
 * Handles all of:
 *   "    at fn (webpack-internal:///(app-pages-browser)/./app/page.tsx:13:78)"
 *   "    at /Users/me/repo/app/page.tsx:14:5"
 *   "    at <anonymous>:25:13"
 *   "<anonymous>:35:3"
 *
 * The file path itself can contain parentheses (e.g. `(app-pages-browser)`),
 * so we can't anchor the inner capture group on `[^()]`. Instead, peel the
 * trailing ":line:col" off and then locate the "outer" open-paren via ` (`.
 */
function parseStackLine(line: string): ProbeResult | null {
  const match = line.match(/^(.*):(\d+):(\d+)\)?\s*$/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  let file = match[1];

  // If the prefix has " (" somewhere, the file starts right after the LAST
  // such occurrence — that's the boundary between `at fnName ` and the path.
  const wrapIdx = file.lastIndexOf(' (');
  if (wrapIdx >= 0) {
    file = file.slice(wrapIdx + 2);
  } else {
    file = file.replace(/^\s*at\s+/, '');
  }

  // Defensive: drop wrapping single-quotes some runtimes add.
  file = file.replace(/^['"]|['"]$/g, '');

  return {
    file: stripBundlerPrefix(file),
    line: Number(match[2]),
    column: Number(match[3]),
  };
}
