const types = { teams: 'area', team: 'area', areas: 'area', routes: 'route', tasks: 'route', task: 'route', projects: 'project', chats: 'chat', agents: 'agent', outputs: 'output', sessions: 'session', runs: 'session', messages: 'message', docs: 'document' };
export function searchCatalog(catalog, query, limit = 30) {
  const filters = {}, terms = [];
  for (const token of query.toLowerCase().match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const match = token.match(/^(type|project|status):(.+)$/);
    if (match) filters[match[1]] = match[2].replaceAll('"', '');
    else terms.push(token.replaceAll('"', ''));
  }
  const type = types[filters.type] ?? filters.type;
  return catalog.flatMap((item, order) => {
    if (!query.trim() && item.searchOnly) return [];
    if (type && item.type.toLowerCase() !== type) return [];
    if (filters.project && !(item.projectName || '').toLowerCase().includes(filters.project)) return [];
    if (filters.status && !(item.status || '').toLowerCase().replaceAll(' ', '_').includes(filters.status.replaceAll(' ', '_'))) return [];
    const title = item.title.toLowerCase(), haystack = `${title} ${item.subtitle || ''} ${item.searchText || ''} ${item.type} ${item.projectName || ''}`.toLowerCase();
    if (!terms.every(term => haystack.includes(term))) return [];
    return [{ item, order, rank: terms.reduce((score, term) => score + (title.startsWith(term) ? 4 : title.includes(term) ? 2 : 0), 0) }];
  }).sort((a, b) => b.rank - a.rank || a.order - b.order).slice(0, limit).map(row => row.item);
}
export function searchExcerpt(text, query = '') {
  const content = String(text || '').replace(/\s+/g, ' ').trim();
  const word = query.split(/\s+/).find(word => word && !word.includes(':'));
  const found = word ? content.toLowerCase().indexOf(word.toLowerCase().replaceAll('"', '')) : 0;
  const start = Math.max(0, found - 48);
  return `${start ? '…' : ''}${content.slice(start, start + 180)}${content.length > start + 180 ? '…' : ''}`;
}
