import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { localGitApiPath } from './local-git.js';

/** Local repository/consent inspection only: never probes a GitHub account. */
export function useGitHubConnection(workspaceId, enabled = true) {
  const [connection, setConnection] = useState({ workspaceId: null, connected: false });
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let controller;
    const inspect = event => {
      if (event?.detail?.workspaceId && event.detail.workspaceId !== workspaceId) return;
      controller?.abort(); controller = new AbortController();
      const request = controller;
      setConnection({ workspaceId, connected: false });
      apiRequest(localGitApiPath(workspaceId), { signal: request.signal, timeoutMs: 25_000 })
        .then(({ result }) => { if (!request.signal.aborted) setConnection({ workspaceId, connected: Boolean(result?.connected) }); })
        .catch(() => { if (!request.signal.aborted) setConnection({ workspaceId, connected: false }); });
    };
    inspect();
    const events = ['frondose:repository-connected', 'frondose:github-connection-changed', 'frondose:directory-changed'];
    events.forEach(name => window.addEventListener(name, inspect));
    return () => { controller?.abort(); events.forEach(name => window.removeEventListener(name, inspect)); };
  }, [workspaceId, enabled]);
  return enabled && connection.workspaceId === workspaceId && connection.connected;
}
