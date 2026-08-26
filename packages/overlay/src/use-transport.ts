import { useEffect, useState } from 'preact/hooks';
import { type TransportState, getTransport } from './transport';

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
    retry: t.retryTask.bind(t),
    archive: t.archiveTask.bind(t),
    sendMessage: t.sendMessage.bind(t),
    ship: t.shipWorktree.bind(t),
    createPr: t.createPullRequest.bind(t),
    discard: t.discardWorktree.bind(t),
    fetchTranscript: t.fetchTranscript.bind(t),
    login: t.loginProvider.bind(t),
    logout: t.logoutProvider.bind(t),
    saveApiKey: t.saveApiKey.bind(t),
    refreshAuth: t.fetchAuthStatus.bind(t),
    setBypassPermissions: t.setBypassPermissions.bind(t),
  };
}
