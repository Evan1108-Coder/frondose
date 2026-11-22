import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Activity, Copy, Download, RotateCw } from '../../components/icons.jsx';
import { useInterfaceLanguage } from '../../components/InterfaceLanguage.jsx';
import { Button } from '../../ui.jsx';
import { copyUserText } from '../../lib/clipboard.js';
import { interfaceText } from '../../lib/interface-language.js';
import { groupSupportRows, formatSupportDay, SUPPORT_STATUSES } from '../../lib/support-logs.js';
import './workspace-activity.css';

const pageSize = 100;

export function SupportLogs() {
  const language = useInterfaceLanguage();
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState({ day: '', count: pageSize });
  const [notice, setNotice] = useState('');
  const days = useMemo(() => groupSupportRows(log?.rows ?? []), [log]);
  const current = days.find(([day]) => day === selection.day) ?? days[0];
  const time = useMemo(() => new Intl.DateTimeFormat(language, { timeStyle: 'medium' }), [language]);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/support-logs', { signal: controller.signal })
      .then(({ result }) => { if (!controller.signal.aborted) setLog(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [refresh]);

  function reload() {
    setBusy(true);
    setError(false);
    setNotice('');
    setRefresh(value => value + 1);
  }

  function reportText() {
    return formatSupportDay(current[0], current[1], time.resolvedOptions().timeZone);
  }

  async function copyDay() {
    try {
      if (await copyUserText(reportText())) {
        setNotice('Copied to clipboard');
        return;
      }
    } catch { /* The download does not require clipboard access. */ }
    setNotice('Could not copy the log. Use Download day instead.');
  }

  function downloadDay() {
    const url = URL.createObjectURL(new Blob([reportText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `frondose-support-${current[0]}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="workspace-recording support-log">
    <header className="settings-heading">
      <div><h1><Activity aria-hidden="true" /> Support logs</h1><p>Recent actions and outcomes from the last 30 days.</p></div>
      <Button icon={RotateCw} disabled={busy} onClick={reload}>Refresh</Button>
    </header>
    <p>Logs stay on this computer. Choose the date the problem happened, then copy or download that day to share it. Frondose never sends the log for you.</p>
    <p>The log includes recorded workspace actions and selected app, update, and request outcomes. It excludes names, paths, credentials, file contents, messages, and terminal output.</p>
    {busy ? <p role="status">Loading support logs…</p> : null}
    {error ? <p role="alert">Support logs could not be loaded. Try refreshing.</p> : null}
    {!busy && !error && !current ? <p className="workspace-recording-empty">No support log entries yet.</p> : null}
    {log?.truncated ? <p role="status">Showing the most recent 3,000 entries.</p> : null}
    {current ? <>
      <div className="support-log-controls">
        <label><span>Log date</span><select value={current[0]} onChange={event => { setSelection({ day: event.target.value, count: pageSize }); setNotice(''); }}>
          {days.map(([day]) => <option key={day} value={day}>{day}</option>)}
        </select></label>
        <Button icon={Copy} disabled={busy || error} onClick={copyDay}>Copy day</Button>
        <Button icon={Download} disabled={busy || error} onClick={downloadDay}>Download day</Button>
      </div>
      <p role="status" className="support-copy-status">{notice}</p>
      <ol aria-label="Support log entries">{current[1].slice(0, selection.count).map((row, index) => <li key={`${row.recordedAt}:${index}`}>
        <div><strong>{interfaceText(row.label, language)}</strong><span>{interfaceText(SUPPORT_STATUSES[row.status] ?? 'Recorded', language)}{row.code ? ` · HTTP ${row.code}` : ''}</span></div>
        <time dateTime={row.recordedAt}>{time.format(new Date(row.recordedAt))}</time>
      </li>)}</ol>
      {current[1].length > selection.count ? <Button onClick={() => setSelection(value => ({ ...value, count: value.count + pageSize }))}>Show more</Button> : null}
    </> : null}
  </section>;
}
