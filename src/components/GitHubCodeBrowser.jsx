import { useEffect, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { Button, ErrorMessage, Field, Select, useApp } from '../ui.jsx';
import { CodeViewer } from './CodeViewer.jsx';
import { ReviewPanel } from './ReviewPanel.jsx';
import { ChangeReview, FileTypeIcon } from './ChangeReview.jsx';
import { ArrowLeft, FileText, Folder, Settings } from './icons.jsx';

export function GitHubCodeBrowser({ connection }) {
  const { navigate } = useApp();
  const repositories = connection.settings.selected_resources ?? [];
  const [repository, setRepository] = useState(repositories[0] || ''), [ref, setRef] = useState(''), [branches, setBranches] = useState([]);
  const [path, setPath] = useState(''), [mode, setMode] = useState('tree'), [result, setResult] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [base, setBase] = useState(''), [head, setHead] = useState(''), [compare, setCompare] = useState(null);
  const request = async (kind, values = {}, signal) => (await apiRequest(`/api/connection-platform/connections/${connection.id}/code?${new URLSearchParams({ resource_id: repository, kind, ...(ref ? { ref } : {}), ...values })}`, { signal })).result;
  useEffect(() => {
    if (!repository) return;
    const controller = new AbortController();
    request('branches', {}, controller.signal).then(value => setBranches(Array.isArray(value) ? value : value.branches ?? [])).catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [repository, connection.id]);
  useEffect(() => {
    if (!repository) return;
    const controller = new AbortController(); setBusy(true); setResult(null); setError(null);
    request(mode, { path }, controller.signal).then(setResult).catch(failure => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [repository, ref, path, mode, connection.id]);
  return <section><ReviewPanel connection={connection} /><div className="cp-section-head"><div><h2>Repository code</h2><p>Browse GitHub source without changing your working folder.</p></div><Button icon={Settings} onClick={() => navigate('settings', 'code-reviews')}>Code appearance</Button></div>
    {!repositories.length ? <p>Select repositories in Resources before browsing code.</p> : <>
      <div className="cp-form-grid"><Select label="Repository" value={repository} onChange={value => { setRepository(value); setPath(''); setRef(''); setMode('tree'); setCompare(null); }}>{repositories.map(repo => <option key={repo}>{repo}</option>)}</Select><Select label="Branch" value={ref} onChange={value => { setRef(value); setCompare(null); }}><option value="">Default branch</option>{branches.map(branch => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</Select></div>
      <ErrorMessage error={error} /><div className="cp-actions"><Button icon={ArrowLeft} disabled={!path} onClick={() => { setPath(path.split('/').slice(0, -1).join('/')); setMode('tree'); }}>Parent folder</Button><code>{path || '/'}</code></div>
      {busy ? <p role="status">Loading repository…</p> : result?.kind === 'file' ? <CodeViewer content={result.content} label={result.path} /> : result?.entries ? <div className="cp-resource-list">{result.entries.map(entry => <button className="cp-code-file" key={entry.path} onClick={() => { setPath(entry.path); setMode(entry.type === 'dir' || entry.type === 'directory' || entry.type === 'tree' ? 'tree' : 'file'); }}>{entry.type === 'dir' || entry.type === 'directory' || entry.type === 'tree' ? <Folder /> : <FileTypeIcon path={entry.path} />}<span>{entry.name}</span></button>)}</div> : null}
      <details className="cp-note"><summary>Compare branches or commits</summary><div className="cp-form-grid"><Field label="Base branch or SHA"><input value={base} onChange={e => setBase(e.target.value)} /></Field><Field label="Head branch or SHA"><input value={head} onChange={e => setHead(e.target.value)} /></Field></div><Button disabled={!base || !head || busy} onClick={async () => { setError(null); setBusy(true); try { setCompare(await request('compare', { base, head })); } catch (failure) { setError(failure); } finally { setBusy(false); } }}>Compare</Button>
        {compare ? <ChangeReview comparison={{ title: 'GitHub branch comparison', base: compare.base_commit?.sha || base, head: compare.commits?.at(-1)?.sha || head, notice: 'GitHub supplies bounded context and at most 300 changed files. Missing lines cannot be expanded.', files: (compare.files || []).map(file => ({ ...file, path: file.filename, oldPath: file.previous_filename, unavailable: file.patch ? null : 'GitHub did not provide a text patch.' })) }} /> : null}
      </details>
    </>}
  </section>;
}
