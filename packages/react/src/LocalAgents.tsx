'use client';
import * as React from 'react';
import { useEffect } from 'react';

const DEFAULT_DAEMON_URL = 'http://localhost:4747';
const HEALTH_TIMEOUT_MS = 300;
const SCRIPT_MARKER = 'data-localagents';
const BRIDGE_KEY = '__LOCALAGENTS__';

type DispatcherBridge = {
  reactVersion: string;
  read: () => unknown;
  write: (d: unknown) => void;
};

type WindowBridge = {
  dispatcher: DispatcherBridge | null;
  reactVersion: string | null;
};

/**
 * Capture React's internal dispatcher ref. React's hook dispatcher lives at:
 *   React 19+: React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H
 *   React 16-18: React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current
 *
 * Because this module is bundled with the user's app (peer-dep React), we share
 * the *same* React instance. Stashing the read/write handle on window lets the
 * separately-loaded overlay swap in a throwing dispatcher to probe component
 * source locations when `_debugSource` has been stripped (Next.js + SWC).
 */
function setupDispatcherBridge(): DispatcherBridge | null {
  // biome-ignore lint/suspicious/noExplicitAny: probing private React internals
  const R = React as any;

  const r19 = R.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  if (r19 && 'H' in r19) {
    return {
      reactVersion: React.version,
      read: () => r19.H,
      write: (d) => {
        r19.H = d;
      },
    };
  }

  const r18 = R.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  if (r18?.ReactCurrentDispatcher) {
    const ref = r18.ReactCurrentDispatcher;
    return {
      reactVersion: React.version,
      read: () => ref.current,
      write: (d) => {
        ref.current = d;
      },
    };
  }

  return null;
}

export type LocalAgentsProps = {
  /**
   * URL of the local orchestrator daemon. Defaults to http://localhost:4747.
   * Override if you started the daemon on a different port via `--port`.
   */
  daemonUrl?: string;
};

/**
 * Drop-in component that mounts the localagents overlay into the page in dev,
 * and is a no-op in production. Safe to leave in the layout permanently:
 *
 *   import { LocalAgents } from '@localagents/react';
 *   <LocalAgents />
 *
 * Behavior:
 *   - In production builds, renders nothing and does nothing.
 *   - In dev, fetches `${daemonUrl}/health` with a short timeout.
 *     - If the daemon responds, injects a <script type="module"> tag that
 *       loads `${daemonUrl}/overlay.js`. The overlay mounts itself.
 *     - If the daemon is unreachable, logs one info line and renders null.
 *   - Idempotent: detects an existing overlay script and skips re-injection.
 */
export function LocalAgents({ daemonUrl = DEFAULT_DAEMON_URL }: LocalAgentsProps = {}): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV === 'production') return;

    // Always set up the React bridge — cheap, useful even if daemon is down for
    // diagnostic / future hot-reconnect.
    // biome-ignore lint/suspicious/noExplicitAny: window bridge
    const w = window as any;
    const bridge: WindowBridge = w[BRIDGE_KEY] ?? { dispatcher: null, reactVersion: null };
    if (!bridge.dispatcher) {
      bridge.dispatcher = setupDispatcherBridge();
      bridge.reactVersion = React.version;
    }
    w[BRIDGE_KEY] = bridge;

    if (document.querySelector(`script[${SCRIPT_MARKER}]`)) return;

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);

    const probe = async (): Promise<void> => {
      try {
        const res = await fetch(`${daemonUrl}/health`, { signal: ctrl.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return;

        if (document.querySelector(`script[${SCRIPT_MARKER}]`)) return;

        const script = document.createElement('script');
        script.type = 'module';
        script.src = `${daemonUrl}/overlay.js`;
        script.setAttribute(SCRIPT_MARKER, 'true');
        document.head.appendChild(script);
      } catch {
        // eslint-disable-next-line no-console
        console.info(
          '[localagents] daemon not detected on',
          daemonUrl,
          '— run `npx localagents` to enable the overlay',
        );
      }
    };

    void probe();

    return () => {
      clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [daemonUrl]);

  return null;
}
