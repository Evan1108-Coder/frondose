import { DEFERRED_WORKSTATION_TOOLS } from '../../lib/workstation-tool-availability.js';

const settings = {
  'computer-use': { title: 'Computer Use', tools: ['computer'] },
  dictation: { title: 'Dictation', tools: ['dictation'] },
  emulators: { title: 'Emulators & environments', tools: ['devices', 'environment'] },
};

export function WorkstationToolsSettings({ section }) {
  const page = settings[section];
  if (!page) return null;
  return <><header className="settings-heading"><div><h1>{page.title}</h1><p>Coming Soon</p></div></header><section className="settings-group"><div className="settings-panel">{page.tools.map(id => {
    const tool = DEFERRED_WORKSTATION_TOOLS[id];
    return <div className="setting-row" key={id}><span><strong>{tool.title}</strong><small>{tool.description}</small></span></div>;
  })}</div></section></>;
}
