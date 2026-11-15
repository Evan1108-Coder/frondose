import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectoryFileEditor } from '../../src/components/workspace/DirectoryFiles.jsx';
import { consumeContextDrag } from '../../src/lib/workspace-context-drop.js';
const source = ['export async function review(route) {', '  const result = await inspect(route);', '  // Keep the evidence with the work.', '  return { status: "review", result };', '}', ...Array.from({ length: 3000 }, (_, index) => `// fixture line ${index + 6} — 中😀`)].join('\n');
const tab = { id: 'fixture-editor', entityId: 'fixture-file', path: 'src/fixture.ts', rootVersion: 'root-v1' };
const drafts = new Map([[tab.entityId, { workspaceId: 'fixture-ws', path: tab.path, initialPath: tab.path, content: source, baseline: source, version: 'file-v1', isNew: false, loaded: true, pending: false, mode: 'source', discarded: false, revision: 0 }]]);
function Fixture() {
  const editor = useRef(null), [tick, setTick] = useState(0);
  window.fixtureEditor = { rerender: () => setTick(value => value + 1), drafts, editor, tick, setWidth: value => { document.querySelector('#root').style.width = `${value}px`; } };
  return <DirectoryFileEditor workspaceId="fixture-ws" ref={editor} tab={tab} drafts={drafts}/>;
}
document.querySelector('#context-target').addEventListener('dragover', event => event.preventDefault());
document.querySelector('#context-target').addEventListener('drop', event => { event.preventDefault(); window.droppedContext = consumeContextDrag(event.dataTransfer, 'fixture-ws'); });
createRoot(document.querySelector('#root')).render(<Fixture/>);
