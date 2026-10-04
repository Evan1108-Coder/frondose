import { PinOff } from '../components/icons.jsx';
import { Button, Empty, PageHeader, useApp } from '../ui.jsx';
import { NAV_ITEMS, resolveFavorite } from '../lib/organization.js';

/** Personal shortcuts; the underlying workspace resources remain shared. */
export function StarredView() {
  const { data, organization, navigate, toggleFavorite } = useApp();
  const items = organization.favorites.map(reference => resolveFavorite(data, reference)).filter(Boolean);
  return <main className="page starred-page">
    <PageHeader title="Starred" description="Everything you keep close in this workspace." />
    {items.length ? <div className="starred-list">{items.map(item => <div className="starred-row" key={`${item.view}:${item.id}`}>
      <button onClick={() => navigate(item.view, item.id)}><strong>{item.title}</strong><small>{NAV_ITEMS.find(entry => entry.id === item.view)?.label || item.view}</small></button>
      <Button icon={PinOff} onClick={() => toggleFavorite(item)}>Unstar</Button>
    </div>)}</div> : <Empty compact kind="work" title="Nothing starred yet" description="Star a run or another item to keep it here." action="Explore runs" onAction={() => navigate('work')} />}
  </main>;
}
