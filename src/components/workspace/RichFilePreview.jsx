import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../data/api.js';
import { Button, ErrorMessage } from '../../ui.jsx';
import { previewTable, safePreviewHtml } from '../../lib/rich-previews.js';
import './rich-file-preview.css';

export function RichFilePreview({ workspaceId, tab, onSource }) {
  const [file, setFile] = useState(null), [error, setError] = useState(null), [url, setUrl] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); let blobUrl;
    setFile(null); setError(null); setUrl(null);
    const q = new URLSearchParams({ workspace_id: workspaceId, path: tab.path, expected_binding_version: tab.rootVersion });
    apiRequest('/api/directory-workspace/preview?' + q, { signal: controller.signal }).then(({ result }) => {
      if (controller.signal.aborted) return;
      const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      setFile({ ...result, bytes, text: ['html', 'table', 'notebook', 'mermaid'].includes(result.kind) ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : '' }); setUrl(blobUrl);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause); });
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [workspaceId, tab.path, tab.rootVersion]);
  return <section className="rich-file-preview" aria-label="File preview"><header><strong>{tab.path}</strong><span>Read-only preview</span><Button onClick={onSource}>Open Source</Button></header><ErrorMessage error={error}/>{!file && !error ? <p role="status">Opening preview…</p> : null}{file ? <div className="rich-preview-content">
    {file.kind === 'image' ? <img className="rich-preview-image" src={url} alt={tab.path} onError={() => setError(Error('This image could not be decoded.'))}/> : null}
    {file.kind === 'pdf' ? <PdfPreview bytes={file.bytes}/> : null}
    {['audio', 'video'].includes(file.kind) ? file.kind === 'video' ? <video controls preload="metadata" src={url} onError={() => setError(Error('This video codec is unsupported.'))}/> : <audio controls preload="metadata" src={url} onError={() => setError(Error('This audio codec is unsupported.'))}/> : null}
    {file.kind === 'html' ? <><p>Scripts, network requests, forms and additional files are blocked.</p><iframe title={'HTML preview: ' + tab.path} sandbox="" referrerPolicy="no-referrer" srcDoc={safePreviewHtml(file.text)}/></> : null}
    {file.kind === 'table' ? <TablePreview text={file.text} delimiter={file.path.toLowerCase().endsWith('.tsv') ? '\t' : ','}/> : null}
    {file.kind === 'mermaid' ? <MermaidPreview text={file.text}/> : null}
    {file.kind === 'notebook' ? <NotebookPreview text={file.text}/> : null}
  </div> : null}</section>;
}
function TablePreview({ text, delimiter }) {
  const { rows, truncated, malformed } = previewTable(text, delimiter);
  return <>{truncated ? <p>Showing a bounded preview: up to 500 rows and 100 columns.</p> : null}{malformed ? <p role="alert">This table contains an unterminated quoted cell.</p> : null}<div className="rich-preview-table"><table><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></>;
}
function PdfPreview({ bytes }) {
  const canvas = useRef(null), document = useRef(null), [pages, setPages] = useState(0), [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false, task;
    Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdf, worker]) => {
      if (cancelled) return;
      pdf.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdf.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useSystemFonts: true, cMapUrl:location.origin+'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:location.origin+'/pdfjs/standard_fonts/',wasmUrl:location.origin+'/pdfjs/wasm/',iccUrl:location.origin+'/pdfjs/iccs/' });
      return task.promise.then(value => { if (!cancelled) { document.current = value; setPages(value.numPages); } });
    }).catch(cause => { if (!cancelled) setError(cause); });
    return () => { cancelled = true; document.current = null; void task?.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!document.current || !canvas.current) return;
    let cancelled = false, rendering;
    document.current.getPage(page).then(value => {
      if (cancelled) return;
      const viewport = value.getViewport({ scale: zoom }), target = canvas.current;
      if (viewport.width * viewport.height > 24_000_000) throw Error('PDF page exceeds the safe rendering size.');
      target.width = viewport.width; target.height = viewport.height;
      rendering = value.render({ canvasContext: target.getContext('2d'), viewport });
      return rendering.promise;
    }).catch(cause => { if (!cancelled && cause.name !== 'RenderingCancelledException') setError(cause); });
    return () => { cancelled = true; rendering?.cancel(); };
  }, [pages, page, zoom]);
  return <><div className="rich-preview-actions"><Button disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</Button><span>Page {page} of {pages || '…'}</span><Button disabled={page >= pages} onClick={() => setPage(n => n + 1)}>Next</Button><Button disabled={zoom <= .5} onClick={() => setZoom(n => n - .25)}>Zoom out</Button><Button disabled={zoom >= 2} onClick={() => setZoom(n => n + .25)}>Zoom in</Button></div><ErrorMessage error={error}/><canvas ref={canvas} aria-label={'PDF page ' + page}/></>;
}
function MermaidPreview({ text }) {
  const [svg, setSvg] = useState(''), [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (text.length > 100_000 || /^\s*---|%%\s*\{|<[A-Za-z!\/]|\b(?:https?|javascript|data|file):|\bclick\s+|url\s*\(/i.test(text)) throw Error('Diagram is too large or contains unsupported configuration, HTML, links or interactive actions. Open Source to inspect it.');
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart:{htmlLabels:false}, maxEdges:500, maxTextSize: 100_000, suppressErrorRendering: true });
      const result = await mermaid.render('diagram_' + crypto.randomUUID().replaceAll('-', ''), text);
      if (!cancelled) setSvg(result.svg);
    })().catch(cause => { if (!cancelled) setError(cause); });
    return () => { cancelled = true; };
  }, [text]);
  return <><ErrorMessage error={error}/>{svg ? <iframe sandbox="" title="Mermaid diagram" srcDoc={safePreviewHtml(svg)}/> : null}</>;
}
function NotebookPreview({ text }) {
  let notebook;
  try { notebook = JSON.parse(text); if (!Array.isArray(notebook.cells) || notebook.cells.length > 1000) throw Error(); }
  catch { return <p role="alert">This notebook is invalid or exceeds 1,000 cells.</p>; }
  return <div className="rich-preview-notebook"><p>Saved cells and plain-text outputs only. No kernel is started.</p>{notebook.cells.map((cell, i) => <article key={i}><small>{cell.cell_type === 'code' ? 'Code' : 'Markdown'}</small><pre>{(Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '')).slice(0, 100_000)}</pre>{(Array.isArray(cell.outputs) ? cell.outputs : []).slice(0, 100).map((output, j) => <pre key={j}>{String([output.text, output.data?.['text/plain']].flat().filter(Boolean).join('')).slice(0, 100_000)}</pre>)}</article>)}</div>;
}
