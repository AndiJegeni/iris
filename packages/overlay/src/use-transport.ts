import { useEffect, useState } from 'preact/hooks';
import { getTransport, type TransportState } from './transport';

/**
 * Subscribe to the singleton Transport state. Returns the current snapshot
 * and an annotation sender.
 */
export function useTransport() {
  const t = getTransport();
  const [state, setState] = useState<TransportState>(t.getState());

  useEffect(() => {
    setState(t.getState());
    return t.subscribe(setState);
  }, [t]);

  return {
    state,
    send: t.sendAnnotation.bind(t),
    cancel: t.cancelTask.bind(t),
  };
}
