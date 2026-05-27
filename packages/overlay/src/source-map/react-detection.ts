const BRIDGE_KEY = '__LOCALAGENTS__';

export type DispatcherBridge = {
  reactVersion: string;
  read: () => unknown;
  write: (d: unknown) => void;
};

type WindowBridge = {
  dispatcher: DispatcherBridge | null;
  reactVersion: string | null;
};

/** Read the dispatcher bridge installed by `<LocalAgents/>` from `@localagents/react`. */
export function getDispatcherBridge(): DispatcherBridge | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: window bridge
  const w = window as any;
  const bridge: WindowBridge | undefined = w[BRIDGE_KEY];
  return bridge?.dispatcher ?? null;
}

export function getReactVersion(): string | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: window bridge
  const w = window as any;
  const bridge: WindowBridge | undefined = w[BRIDGE_KEY];
  return bridge?.reactVersion ?? null;
}
