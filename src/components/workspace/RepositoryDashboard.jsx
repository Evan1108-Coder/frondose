import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ErrorMessage } from '../../ui.jsx';
import { apiRequest } from '../../data/api.js';
import { workbenchRequest } from '../../lib/workbench.js';
import { localGitApiPath, localGithubReadFailure } from '../../lib/local-git.js';
import { repositoryCheckSummary, repositorySourceKey } from '../../lib/tab-apps.js';
import { GitBranch, RotateCw } from '../icons.jsx';
import './tab-apps.css';

export function RepositoryDashboard({ workspaceId, binding, expectedRootVersion, onOpenFile, onDirectory, onOpenWeb }) {
  const [snapshot, setSnapshot] = useState(null), [files, setFiles] = useState(null), [error, setError] = useState(null), [fileError, setFileError] = useState(null);
  const [remote, setRemote] = useState(null), [remoteError, setRemoteError] = useState(null), [live, setLive] = useState(false), [revision, setRevision] = useState(0), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false), owner = useRef(null), request = useRef(null), remoteRequest = useRef(null), inFlight = useRef(false), remoteBusy = useRef(false), lastRemote = useRef(0), current = useRef(null);
  const liveRef = useRef(live); liveRef.current = live;
  const mismatch = Boolean(expectedRootVersion && expectedRootVersion !== binding?.version);
  const readRemote = useCallback(async state => {
    if (!state.connected || remoteBusy.current || !liveRef.current) return;
    remoteBusy.current = true; const controller = new AbortController(); remoteRequest.current = controller;
    const source = repositorySourceKey(state), body = { expected_version: state.version, expected_binding_version: state.bindingVersion, confirmed: true };
    try {
      const [pulls, issues] = await Promise.allSettled([
        apiRequest(localGitApiPath(workspaceId, 'pull-requests'), { method: 'POST', body, signal: controller.signal }),
        apiRequest(localGitApiPath(workspaceId, 'issues'), { method: 'POST', body: { ...body, state: 'open', limit: 30 }, signal: controller.signal }),
      ]);
      if (controller.signal.aborted || !liveRef.current || source !== repositorySourceKey(current.current || {})) return;
      // Recheck connection identity after network reads; never show old repo data
      // after disconnect, relink, or branch movement in another window.
      const { result: fresh } = await apiRequest(localGitApiPath(workspaceId), { signal: controller.signal });
      if (controller.signal.aborted || !fresh.connected || repositorySourceKey(fresh) !== source) { setRemote(null); return; }
      setRemote({ source, pulls: pulls.status === 'fulfilled' ? pulls.value.result : null, issues: issues.status === 'fulfilled' ? issues.value.result : null, at: Date.now() });
      setRemoteError(pulls.status === 'rejected' ? pulls.reason : issues.status === 'rejected' ? issues.reason : null); lastRemote.current = Date.now();
    } catch (cause) { if (!controller.signal.aborted) { setRemote(null); setRemoteError(cause); lastRemote.current = Date.now(); } }
    finally { remoteBusy.current = false; }
  }, [workspaceId]);
  useEffect(() => {
    if (!live) { remoteRequest.current?.abort(); setRemote(null); setRemoteError(null); lastRemote.current = 0; }
    setRevision(value => value + 1);
  }, [live]);
  useEffect(() => {
    if (!binding || mismatch) { current.current = null; setSnapshot(null); setFiles(null); setRemote(null); return; }
    const controller = new AbortController(); request.current = controller; let timer;
    const visible = () => !document.hidden && Boolean(owner.current?.getClientRects().length);
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (visible() && !inFlight.current) {
        inFlight.current = true; setLoading(true);
        try {
          const { result: state } = await apiRequest(localGitApiPath(workspaceId), { signal: controller.signal, timeoutMs: 25000 });
          if (controller.signal.aborted) return;
          if (state.bindingVersion !== binding.version) throw Error('The workspace directory changed. Reopen this dashboard from the current workspace.');
          if (!current.current || repositorySourceKey(current.current) !== repositorySourceKey(state)) { setRemote(null); remoteRequest.current?.abort(); lastRemote.current = 0; }
          current.current = state; setSnapshot({ state, at: Date.now() }); setError(null);
          if (state.isRepository) {
            try {
              const detail = await workbenchRequest({ workspaceId, projectId: binding.projectId }, 'git', { signal: controller.signal });
              const { result: fresh } = await apiRequest(localGitApiPath(workspaceId), { signal: controller.signal });
              if (!controller.signal.aborted && fresh.bindingVersion === binding.version && fresh.version === state.version) { setFiles(detail.repository ? detail.files : null); setFileError(detail.repository ? null : Error('File status could not be read. Summary above remains the last checked state.')); }
              else if (!controller.signal.aborted) { setFiles(null); setFileError(Error('Repository changed during the read. Refreshing on the next check.')); }
            } catch (cause) { if (!controller.signal.aborted) { setFiles(null); setFileError(cause); } }
          } else { setFiles(null); setFileError(null); }
          if (liveRef.current && state.connected && Date.now() - lastRemote.current >= 30000) void readRemote(state);
          if (!state.connected) { setRemote(null); remoteRequest.current?.abort(); }
        } catch (cause) { if (!controller.signal.aborted) { current.current = null; setSnapshot(null); setFiles(null); setRemote(null); setError(cause); } }
        finally { inFlight.current = false; if (!controller.signal.aborted) setLoading(false); }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    const wake = () => { if (visible()) setRevision(value => value + 1); };
    void poll(); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    const changed = event => { if (event.detail?.workspaceId === workspaceId) { setRemote(null); remoteRequest.current?.abort(); lastRemote.current = 0; setRevision(value => value + 1); } };
    window.addEventListener('frondose:repository-connected', changed);
    return () => { controller.abort(); remoteRequest.current?.abort(); clearTimeout(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); window.removeEventListener('frondose:repository-connected', changed); };
  }, [workspaceId, binding?.version, binding?.projectId, mismatch, revision, readRemote]);
  const state = snapshot?.state;
  const validRemote = state && remote?.source === repositorySourceKey(state) ? remote : null;
  const displayed = (files || []).filter(file => file.path.toLowerCase().includes(query.toLowerCase()));
  const connect = () => window.dispatchEvent(new CustomEvent('frondose:show-repository', { detail: { workspaceId } }));
  return <section ref={owner} className="repository-dashboard" aria-label="GitHub Dashboard">
    <header className="repository-dashboard-heading"><div><h1>GitHub Dashboard</h1><p>{state?.github?.slug || 'Your workspace repository'}{state?.branch ? ` · ${state.branch}` : ''}</p></div><div className="tab-app-actions"><Button onClick={connect} disabled={!binding || mismatch}>{state?.connected ? 'Repository settings' : 'Connect to GitHub'}</Button><Button icon={RotateCw} busy={loading} onClick={() => { lastRemote.current = 0; setRevision(value => value + 1); }}>Refresh</Button></div></header>
    <ErrorMessage error={error} />
    {!binding ? <div className="tab-app-setup"><h2>Choose a project directory</h2><p>Link this workspace to your local repository first.</p><Button onClick={onDirectory}>Choose directory</Button></div> : mismatch ? <p role="alert">This dashboard belongs to a previous workspace directory. Open a new dashboard to inspect the current one.</p> : !state ? <p role="status">{error ? 'Repository unavailable. Retry after checking the directory.' : 'Reading repository…'}</p> : !state.isRepository ? <div className="tab-app-setup"><h2>No Git repository detected</h2><p>Frondose will not initialize or publish a repository automatically.</p><Button onClick={connect}>Setup guide</Button></div> : <>
      <p className="tab-app-check-time" role="status">Local checks every 5 seconds while visible · Checked {new Date(snapshot.at).toLocaleTimeString()}{loading ? ' · Refreshing…' : ''}</p>
      <div className="repository-stat-grid">{[['Changed files', state.changes?.changed], ['Staged', state.changes?.staged], ['Untracked', state.changes?.untracked], ['Ahead', state.tracking?.ahead ?? '—'], ['Behind', state.tracking?.behind ?? '—']].map(([label, value]) => <div key={label}><strong>{value ?? '—'}</strong><span>{label}</span></div>)}</div>
      <div className="repository-dashboard-columns"><section><h2>File states</h2><input className="repository-file-filter" type="search" aria-label="Filter changed files" placeholder="Filter changed files…" value={query} onChange={event => setQuery(event.target.value)} /><ErrorMessage error={fileError} />{files === null ? <p>Individual file states are unavailable.</p> : !files.length ? <p>Clean working tree.</p> : !displayed.length ? <p>No matching files.</p> : <ul className="repository-file-list">{displayed.slice(0, 500).map(file => <li key={file.path}><code title="Git index / working-tree status">{file.status}</code><button type="button" onClick={() => onOpenFile(file.path)} title={file.path}>{file.path}</button></li>)}</ul>}{displayed.length > 500 ? <p>Showing the first 500 matching files. Narrow the filter to see others.</p> : null}<small>Index / working-tree status. Deleted files remain listed; opening them preserves an unavailable state.</small></section>
      <section><h2>Branches & commits</h2><ul className="repository-branch-list">{(state.branchDetails || []).slice(0, 12).map(branch => <li key={branch.name}><strong><GitBranch />{branch.name}{branch.name === state.branch ? ' · current' : ''}</strong><code>{branch.shortCommit}</code><p>{branch.subject}</p>{branch.committedAt ? <small>{new Date(branch.committedAt).toLocaleString()}</small> : null}</li>)}</ul>{state.branches?.length > 12 ? <Button onClick={connect}>All branches</Button> : null}<small>Local history only. No fetch, staging, commit, push or branch switch happens automatically.</small></section></div>
      <section className="repository-remote-section"><header><h2>GitHub work</h2><label><input type="checkbox" checked={live} disabled={!state.connected} onChange={event => setLive(event.target.checked)} /> Live GitHub reads</label></header><p>{state.connected ? 'Opt in to read this connected repository’s open issues, pull requests and reported checks every 30 seconds while visible.' : 'Connect this repository to enable GitHub reads. Local file and branch monitoring works without it.'}</p>{remoteError ? <p role="alert">{localGithubReadFailure(remoteError).message}</p> : null}{live && state.connected && !validRemote ? <p role="status">{remoteError ? 'GitHub results are unavailable. Local results remain separate.' : 'Reading GitHub…'}</p> : null}{validRemote ? <><p className="tab-app-check-time">GitHub checked {new Date(validRemote.at).toLocaleTimeString()}</p><div className="repository-dashboard-columns"><section><h3>Open pull requests</h3>{!validRemote.pulls ? <p>Pull requests unavailable.</p> : !validRemote.pulls.requests.length ? <p>No open pull requests.</p> : validRemote.pulls.requests.map(pr => <article className="repository-work-card" key={pr.number}><button onClick={() => onOpenWeb(pr.url)}>#{pr.number} {pr.title}</button><p>{pr.head} → {pr.base}{pr.draft ? ' · Draft' : ''}</p><small>{repositoryCheckSummary(pr.checks)}{pr.review ? ` · ${pr.review.replaceAll('_', ' ').toLowerCase()}` : ''}</small></article>)}{validRemote.pulls?.limited ? <p>Showing at most 20 pull requests.</p> : null}</section><section><h3>Open issues</h3>{!validRemote.issues ? <p>Issues unavailable.</p> : !validRemote.issues.issues.length ? <p>No open issues.</p> : validRemote.issues.issues.map(issue => <article className="repository-work-card" key={issue.number}><button onClick={() => onOpenWeb(issue.url)}>#{issue.number} {issue.title}</button><p>{issue.labels.join(' · ') || 'No labels'}</p></article>)}{validRemote.issues?.limited ? <p>Results are limited; open GitHub for the full list.</p> : null}</section></div></> : null}</section>
    </>}
  </section>;
}
