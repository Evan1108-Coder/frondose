import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Button, Dialog, ErrorMessage, Select, useApp } from '../../ui.jsx';
import {useInterfaceLanguage} from '../InterfaceLanguage.jsx';
import {interfaceText} from '../../lib/interface-language.js';
import { Check, ChevronDown, Copy, ExternalLink, GitBranch, RotateCw } from '../icons.jsx';
import { ServiceLogo } from '../ServiceLogo.jsx';
import { localGitApiPath, localGitSetupPrompt, localGithubReadFailure } from '../../lib/local-git.js';
import './git-repository.css';

const changedEvent = 'frondose:repository-connected';
const announce = workspaceId => { window.dispatchEvent(new CustomEvent(changedEvent, { detail: { workspaceId } })); window.dispatchEvent(new CustomEvent('frondose:github-connection-changed', { detail: { workspaceId } })); };
const expected = state => ({ expected_version: state.version, expected_binding_version: state.bindingVersion });

function useLocalRepository(workspaceId, bindingVersion, enabled = true) {
  const [state, setState] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const scope = useRef(''); scope.current = `${workspaceId}:${bindingVersion || ''}`;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) { setState(null); setError(null); setLoading(false); return; }
    const controller = new AbortController(), currentScope = scope.current;
    setLoading(true); setError(null);
    apiRequest(localGitApiPath(workspaceId), { signal: controller.signal, timeoutMs: 25_000 }).then(({ result }) => { if (!controller.signal.aborted && scope.current === currentScope) setState(result); }).catch(cause => { if (!controller.signal.aborted && scope.current === currentScope) setError(cause); }).finally(() => { if (!controller.signal.aborted && scope.current === currentScope) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, bindingVersion, enabled, revision]);
  useEffect(() => {
    const change = event => { if (event.detail?.workspaceId === workspaceId) reload(); };
    window.addEventListener(changedEvent, change); return () => window.removeEventListener(changedEvent, change);
  }, [workspaceId, reload]);
  return { state, setState, error, setError, loading, reload, scope };
}

function RepositoryLink({ url, children, onError }) {
  return <a href={url} target="_blank" rel="noreferrer" onClick={event => {
    const bridge = globalThis.frondoseDesktop?.browser;
    if (bridge?.openExternal) { event.preventDefault(); void bridge.openExternal({ url }).catch(onError); }
  }}>{children}<ExternalLink /></a>;
}

export function repositorySetupHelpVisible(state) { return Boolean(state && !state.connected); }

export function LocalBranchCards({ state, selected, onSelect, disabled = false }) {
  const details = new Map((state.branchDetails || []).map(item => [item.name, item]));
  const branches = [...state.branches].sort((a, b) => Number(b === state.branch) - Number(a === state.branch));
  return <div className="git-branch-cards" role="radiogroup" aria-label="Local branches" onKeyDown={event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    const cards=[...event.currentTarget.querySelectorAll('[role="radio"]:not(:disabled)')]; if (!cards.length) return; event.preventDefault();
    const index=cards.indexOf(document.activeElement), next=cards[event.key==='Home'?0:event.key==='End'?cards.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+cards.length)%cards.length]; next?.focus(); next?.click();
  }}>{branches.map((branch,index) => { const info=details.get(branch), current=branch===state.branch; return <button key={branch} type="button" role="radio" aria-checked={selected===branch} tabIndex={selected===branch || !selected && index===0 ? 0 : -1} disabled={disabled} className="git-branch-card" onClick={() => onSelect(branch)}>
    <span className="git-branch-card-heading"><GitBranch/><strong>{branch}</strong>{current ? <small>Current</small> : null}{selected===branch ? <Check/> : null}</span>
    {info ? <><span className="git-branch-card-subject">{info.subject || 'No commit subject'}</span><span className="git-branch-card-meta"><code>{info.shortCommit}</code>{info.committedAt ? <time dateTime={info.committedAt}>{new Date(info.committedAt).toLocaleDateString()}</time> : null}{info.tracking ? <span>{info.tracking.ahead} ahead · {info.tracking.behind} behind</span> : null}{current && state.dirty ? <span>{state.changes.changed} changed</span> : null}</span></> : <span className="git-branch-card-meta">Commit details unavailable — Recheck</span>}
  </button>; })}</div>;
}

export function SetupGuide({ state }) {
  const { notify } = useApp(), [copied, setCopied] = useState(false);
  if (!repositorySetupHelpVisible(state)) return null;
  const prompt = localGitSetupPrompt(state);
  const copy = async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { notify('Select the setup prompt below and copy it manually.','info'); } };
  return <details className="git-setup-guide" open={!state?.github}>
    <summary>GitHub setup guide and AI prompt</summary>
    <ol><li>Use the intended project directory and preserve existing work.</li><li>Install Git and <RepositoryLink url="https://cli.github.com/" onError={cause => notify(cause.message, 'error')}>GitHub CLI</RepositoryLink> if needed.</li><li>In a terminal, sign in with <code>gh auth login</code>. Choose your own repository and add its GitHub remote only after reviewing the commands.</li><li>Return here and choose Connect to GitHub.</li></ol>
    <p>This prompt is customized for this directory. Copying it does not execute anything.</p>
    <textarea aria-label="Customized GitHub setup prompt" readOnly value={prompt} rows={8} data-field-defaults-exclude="true" />
    <Button icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy setup prompt'}</Button>
  </details>;
}

/** The header always detects local Git only. GitHub CLI/account reads occur
 * exclusively after Connect or Refresh pull requests is explicitly activated. */
export function GitRepositoryBar({ workspaceId, binding, onChooseDirectory, beforeBranchChange, onBranchChanged }) {
  const language=useInterfaceLanguage(),t=copy=>interfaceText(copy,language);
  const { notify } = useApp();
  const repository = useLocalRepository(workspaceId, binding?.version, Boolean(binding));
  const { state, setState, error, setError, loading, reload, scope } = repository;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [selected, setSelected] = useState(''), [pulls, setPulls] = useState(null), [account, setAccount] = useState(null);
  const [workTab, setWorkTab] = useState('issues'), [issueResults, setIssueResults] = useState(null), [issueQuery, setIssueQuery] = useState(''), [issueState, setIssueState] = useState('open'), [assignedToMe, setAssignedToMe] = useState(false), [sourceError, setSourceError] = useState(null);
  const request = useRef(null);
  const workTabsId = useId();
  useEffect(() => { setOpen(false); setBusy(false); setPulls(null); setIssueResults(null); setSourceError(null); setIssueQuery(''); setIssueState('open'); setAssignedToMe(false); setWorkTab('issues'); setAccount(null); setState(null); return () => request.current?.abort(); }, [workspaceId, binding?.version, setState]);
  useEffect(() => setSelected(state?.branch || ''), [state?.version, state?.branch]);
  const mutate = async (action, fields = {}) => {
    if (busy || !state) return;
    const controller = new AbortController(), currentScope = scope.current; request.current = controller;
    setBusy(true); setError(null); setSourceError(null);
    if (['issues', 'pull-requests'].includes(action)) setAccount(null);
    try {
      const { result } = await apiRequest(localGitApiPath(workspaceId, action), { method: 'POST', body: { workspace_id: workspaceId, confirmed: true, ...expected(state), ...fields }, signal: controller.signal, timeoutMs: 35_000 });
      if (scope.current !== currentScope || controller.signal.aborted) return;
      if (action === 'pull-requests') { setPulls(result); setAccount(result.account); }
      else if (action === 'issues') { setIssueResults(result); setAccount(result.account); }
      else { setState(result); setAccount(result.account || null); setPulls(null); announce(workspaceId); }
      return result;
    } catch (cause) { if (!controller.signal.aborted && scope.current === currentScope) { if (['issues','pull-requests'].includes(action)) setSourceError(cause); else setError(cause); } }
    finally { if (scope.current === currentScope) setBusy(false); }
  };
  const changeBranch = () => {
    const target = selected, snapshot = state;
    setOpen(false);
    const run = async () => {
      if (busy || scope.current !== `${workspaceId}:${binding?.version || ''}`) return;
      const expectedScope = scope.current;
      setBusy(true); setError(null);
      try {
        const { result } = await apiRequest(localGitApiPath(workspaceId, 'branch'), { method: 'POST', body: { workspace_id: workspaceId, ...expected(snapshot), branch: target, drafts_confirmed: true, confirmed: true }, timeoutMs: 30_000 });
        if (scope.current !== expectedScope) return;
        setState(result); setPulls(null);
        await onBranchChanged?.(result, { previousBranch: snapshot.branch });
        announce(workspaceId); notify(`Switched to ${result.branch || target}.`, 'success');
      } catch (cause) {
        if (scope.current !== expectedScope) return;
        // Git may have succeeded while a later metadata write failed. Always
        // re-read the root epoch after an attempted switch; never show stale
        // clean file contents or automatically replay an uncertain operation.
        try { await onBranchChanged?.({ requiresRefresh: true }); } catch { /* The original failure remains visible. */ }
        reload(); setError(cause); notify(cause.message, 'error');
      }
      finally { if (scope.current === expectedScope) setBusy(false); }
    };
    if (beforeBranchChange) beforeBranchChange(run); else void run();
  };
  const show = () => {
    if (!binding) { onChooseDirectory?.(); return; }
    setOpen(true); setPulls(null); setIssueResults(null); setSourceError(null); reload();
  };
  useEffect(() => { const receive = event => { if (event.detail?.workspaceId === workspaceId) show(); }; window.addEventListener('frondose:show-repository', receive); return () => window.removeEventListener('frondose:show-repository', receive); }, [workspaceId, binding?.version]);
  const label = state?.connected ? state.branch || t('Detached HEAD') : t('Connect to GitHub');
  return <>
    <button type="button" className="workspace-git-button" disabled={busy} onClick={show} title={state?.connected ? `${state.github?.slug} · ${state.dirty ? 'Uncommitted changes' : 'Clean working tree'}` : 'Connect this workspace directory to GitHub'} aria-label={state?.connected ? `Repository branch: ${label}` : 'Connect to GitHub'}>
      {state?.connected ? <GitBranch /> : <ServiceLogo name="github" />}<span>{busy ? 'Updating…' : label}</span>{state?.connected && state.dirty ? <i className="workspace-git-dirty" aria-label="Uncommitted changes" /> : null}{state?.connected ? <ChevronDown /> : null}
    </button>
    {open ? <Dialog title={state?.connected ? 'Repository' : 'Connect to GitHub'} onClose={() => setOpen(false)} closeDisabled={busy} className="git-repository-dialog">
      <div className="git-repository-body">
        {loading ? <p role="status">Checking this directory’s Git repository…</p> : null}
        {error ? <ErrorMessage error={error} /> : null}
        {state?.directory ? <p className="git-directory-path">{state.directory}</p> : null}
        {!loading && state && !state.github ? <><h3>{state.isRepository ? 'This directory does not have a GitHub remote yet.' : 'This directory does not seem to have a GitHub connection.'}</h3><p>Frondose will not initialize Git, invent a repository, or upload files automatically.</p><SetupGuide state={state} /></> : null}
        {state?.github ? <>
          <div className="git-repository-identity"><ServiceLogo name="github" /><div><strong>{state.github.slug}</strong><span>{state.connected ? 'Connected to this workspace' : 'Detected from local Git configuration'}</span></div><RepositoryLink url={state.github.url} onError={setError}>Open repository</RepositoryLink></div>
          {!state.connected ? <><p>Connect this directory’s existing repository. Frondose will check your installed GitHub CLI account; it will not start login, push files, or change the remote.</p><Button variant="primary" disabled={busy || loading} onClick={() => mutate('connect')}>Connect {state.github.slug}</Button><SetupGuide state={state} /></> : <>
            <section className="git-branch-section" aria-label="Local repository status">
              <h3>Branches</h3>
              <LocalBranchCards state={state} selected={selected} onSelect={setSelected} disabled={busy || loading}/>
              <Button variant="primary" disabled={busy || loading || !selected || selected === state.branch || state.dirty || state.activeWork} onClick={changeBranch}>Switch branch</Button>
              {state.activeWork ? <p className="git-safety-note">Active work must stop before switching.</p> : state.dirty ? <p className="git-safety-note">Save your Git changes before switching. Nothing is stashed or discarded.</p> : null}
              {state.detached ? <small>Detached HEAD</small> : null}{state.branchesLimited ? <small>Showing up to 300 local branches.</small> : null}
            </section>
            <section className="git-work-source" aria-label="GitHub work">
              <div className="git-work-tabs"><div role="tablist" aria-label="GitHub work type" onKeyDown={event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const tabs=[...event.currentTarget.querySelectorAll('[role="tab"]:not(:disabled)')],index=tabs.indexOf(document.activeElement); const next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length]; next?.focus(); next?.click(); }}><button id={`${workTabsId}-issues-tab`} aria-controls={`${workTabsId}-issues-panel`} type="button" role="tab" tabIndex={workTab === 'issues' ? 0 : -1} aria-selected={workTab === 'issues'} disabled={busy} onClick={() => { setWorkTab('issues'); setSourceError(null); }}>Issues</button><button id={`${workTabsId}-pulls-tab`} aria-controls={`${workTabsId}-pulls-panel`} type="button" role="tab" tabIndex={workTab === 'pulls' ? 0 : -1} aria-selected={workTab === 'pulls'} disabled={busy} onClick={() => { setWorkTab('pulls'); setSourceError(null); }}>PRs</button></div><RepositoryLink url={`${state.github.url}/projects`} onError={setError}>Projects on GitHub</RepositoryLink></div>
              {sourceError ? <div className="git-source-unavailable" role="alert"><strong>{localGithubReadFailure(sourceError).title}</strong><p>{localGithubReadFailure(sourceError).message}</p><Button icon={RotateCw} disabled={busy || loading} onClick={() => { if (workTab === 'issues') void mutate('issues', { query: issueQuery, state: issueState, assigned_to_me: assignedToMe }); else void mutate('pull-requests'); }}>Retry</Button></div> : null}
              {workTab === 'issues' ? <section id={`${workTabsId}-issues-panel`} role="tabpanel" aria-labelledby={`${workTabsId}-issues-tab`} className="git-pull-requests"><form className="git-issue-search" onSubmit={event => { event.preventDefault(); setIssueResults(null); void mutate('issues', { query: issueQuery, state: issueState, assigned_to_me: assignedToMe }); }}><input type="search" data-field-default-page="GitHub · Issues" aria-label="Search GitHub issues" placeholder="Search GitHub issues…" value={issueQuery} onChange={event => setIssueQuery(event.target.value)} disabled={busy || loading} maxLength={300} /><Select aria-label="Issue state" value={issueState} onChange={setIssueState} disabled={busy || loading}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All states</option></Select><label className="git-issue-assigned"><input type="checkbox" checked={assignedToMe} disabled={busy || loading} onChange={event => setAssignedToMe(event.target.checked)} />Assigned to me</label><Button type="submit" icon={RotateCw} disabled={busy || loading}>Search issues</Button></form>
                {!issueResults ? <p>Search reads GitHub only when you request it, using your GitHub CLI account.</p> : issueResults.issues.length ? <ul>{issueResults.issues.map(issue => <li key={issue.number}><RepositoryLink url={issue.url} onError={setError}><strong>#{issue.number} {issue.title}</strong></RepositoryLink><small>{issue.state}{issue.assignees.length ? ` · ${issue.assignees.join(', ')}` : ' · Unassigned'}{issue.labels.length ? ` · ${issue.labels.join(', ')}` : ''}{issue.updatedAt ? ` · Updated ${issue.updatedAt.slice(0,10)}` : ''}</small></li>)}</ul> : <p>No matching issues were returned for this repository.</p>}
                {issueResults?.limited ? <p>Showing up to 20 matching issues. Narrow your search or open GitHub for the full list.</p> : null}
              </section> : <section id={`${workTabsId}-pulls-panel`} role="tabpanel" aria-labelledby={`${workTabsId}-pulls-tab`} className="git-pull-requests"><header><h3>Pull requests</h3><Button icon={RotateCw} disabled={busy || loading} onClick={() => { setPulls(null); void mutate('pull-requests'); }}>Refresh pull requests</Button></header>
              {!pulls ? <p>GitHub is read only when you request it. This uses your GitHub CLI login.</p> : pulls.requests.length ? <ul>{pulls.requests.map(pull => <li key={pull.number}><RepositoryLink url={pull.url} onError={setError}><strong>#{pull.number} {pull.title}</strong></RepositoryLink><small>{pull.head} → {pull.base}{pull.draft ? ' · Draft' : ''}{pull.review ? ` · ${pull.review.toLowerCase().replaceAll('_', ' ')}` : ''}{pull.checks.total ? ` · ${pull.checks.failed ? `${pull.checks.failed} checks failed` : pull.checks.pending ? `${pull.checks.pending} checks pending` : 'Checks complete'}` : ' · No check results'}</small></li>)}</ul> : <p>No open pull requests were returned for this repository.</p>}
              {pulls?.limited ? <p>Showing up to 20 open pull requests. Open the repository for the full list.</p> : null}
            </section>}
            </section>
            {account?.state === 'checked' && account.authenticated !== true ? <p className="git-safety-note">{account.installed ? 'GitHub account access could not be verified. Check your network and gh auth status; use gh auth login if needed.' : 'GitHub CLI was not found. Install it and sign in to read pull requests.'} Local branches still work.</p> : account?.login ? <p className="git-account">Account checked: {account.login}</p> : null}
          </>}
        </> : null}
      </div>
      <footer className="dialog-actions git-repository-actions">{state?.connected ? <Button className="git-repository-disconnect" disabled={busy} onClick={() => mutate('disconnect')}>Disconnect from Frondose</Button> : null}<Button icon={RotateCw} disabled={busy || loading} onClick={reload}>Recheck</Button><Button disabled={busy} onClick={() => setOpen(false)}>Close</Button></footer>
    </Dialog> : null}
  </>;
}

/** Optional onboarding offer. A directory without a GitHub remote is silent. */
export function WorkspaceGitHubPrompt({ workspaceId, rootReady = false }) {
  const { notify } = useApp();
  const { state, setState, error, setError, scope } = useLocalRepository(workspaceId, 'onboarding', rootReady);
  const [dismissed, setDismissed] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { setDismissed(false); setBusy(false); }, [workspaceId, rootReady]);
  if (!rootReady || !state?.github || state.connected || dismissed) return null;
  const connect = async () => {
    if (busy) return; setBusy(true); setError(null); const expectedScope = scope.current;
    try {
      const { result } = await apiRequest(localGitApiPath(workspaceId, 'connect'), { method: 'POST', body: { workspace_id: workspaceId, confirmed: true, ...expected(state) }, timeoutMs: 35_000 });
      if (scope.current !== expectedScope) return;
      setState(result); announce(workspaceId); notify(`Connected ${result.github.slug}.`, 'success');
    } catch (cause) { if (scope.current === expectedScope) setError(cause); }
    finally { if (scope.current === expectedScope) setBusy(false); }
  };
  return <section className="workspace-github-prompt" aria-label="Detected GitHub repository"><ServiceLogo name="github" /><div><strong>Connect {state.github.slug}?</strong><p>This directory already has a GitHub remote. Add branch controls and optional pull-request reads to Frondose.</p><div><Button variant="primary" disabled={busy} onClick={connect}>Yes, connect</Button><Button disabled={busy} onClick={() => setDismissed(true)}>Not now</Button></div>{error ? <ErrorMessage error={error} /> : null}</div></section>;
}
