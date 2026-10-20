import { useMemo } from 'react';
import { Search, Terminal } from './icons.jsx';
import { commandAvailability, searchCommands } from '../lib/commands.js';
import './slash-command-menu.css';

const CATEGORY_LABELS = {
  core: 'Compose', work: 'Work', agent: 'Agents', navigation: 'Navigate',
  scheduling: 'Schedule', workbench: 'Workbench', connection: 'Connections',
};

export function SlashCommandMenu({
  text,
  context = 'chat',
  activeIndex = 0,
  onActiveIndexChange,
  onSelect,
  executableCommandIds = [],
  connections = [],
  limit = 10,
}) {
  const query = text.trimStart().replace(/^\//, '');
  const results = useMemo(
    () => searchCommands(query, { context }).slice(0, limit),
    [query, context, limit],
  );
  if (!text.trimStart().startsWith('/') || text.trimStart().startsWith('//') || text.includes('\n')) return null;
  return <div className="slash-command-menu" role="listbox" aria-label="Slash commands">
    <header><Search /><span>{query ? `Commands matching “${query}”` : 'Frondose commands'}</span><kbd>Esc</kbd></header>
    <div className="slash-command-results">
      {results.map((command, index) => {
        const availability = commandAvailability(command, { context, connections, executableCommandIds });
        return <button
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'active' : ''}
          key={command.id}
          onPointerMove={() => onActiveIndexChange?.(index)}
          onClick={() => onSelect(command)}
        >
          <span className="slash-command-icon">{command.category === 'workbench' ? <Terminal /> : '/'}</span>
          <span><strong>{command.command}</strong><small>{command.description}</small></span>
          <span className={`slash-command-badge ${availability.available ? 'ready' : ''}`}>{availability.available ? 'Available' : CATEGORY_LABELS[command.category]}</span>
        </button>;
      })}
      {!results.length ? <div className="slash-command-empty"><strong>No matching command</strong><span>Press Escape to keep this as a message.</span></div> : null}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> select</span><span>Commands never bypass confirmation.</span></footer>
  </div>;
}

export function CommandLibrary({ context, executableCommandIds = [], connections = [], query, onQueryChange, onChoose }) {
  const results = searchCommands(query, { context });
  return <div className="command-library">
    <label className="command-library-search"><Search /><input autoFocus value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Search all commands…" /></label>
    <div className="command-library-list">
      {results.map(command => {
        const availability = commandAvailability(command, { context, connections, executableCommandIds });
        return <button type="button" key={command.id} onClick={() => onChoose(command)}>
          <span><strong>{command.command}</strong><small>{command.description}</small></span>
          <span><small>{CATEGORY_LABELS[command.category]}</small><em className={availability.available ? 'ready' : ''}>{availability.available ? 'Available here' : command.connection ? 'Connection preview' : 'Catalog only'}</em></span>
        </button>;
      })}
    </div>
  </div>;
}
