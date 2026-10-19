import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recentProductUpdates, PRODUCT_UPDATES } from '../src/lib/product-updates.js';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
import { parsePage, pageHash } from '../src/lib/navigation.js';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Updates keeps at most three newest entries and every shipped update opens real Docs', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  assert.deepEqual(recentProductUpdates(entries).map(item => item.id), ['4', '3', '2']);
  for (const update of PRODUCT_UPDATES) assert.ok(DOC_ARTICLES.some(article => article.id === update.articleId && article.group === 'updates'));
  assert.equal(PRODUCT_UPDATES[0].title, 'Initial Launch');
});

test('help has separate Resources and Updates groups and legacy conversation-index shortcut is removed', () => {
  const help = source('src/components/HelpMenu.jsx'), shell = source('src/components/Shell.jsx');
  assert.match(help, /Talvori Resources/); assert.match(help, />Updates</);
  assert.match(help, /recentProductUpdates\(\)/);
  assert.doesNotMatch(shell, /className="sidebar-all-chats"/);
});

test('Area agent membership has a working deep link without reviving Contacts as accounts', () => {
  const hash = pageHash('teams', 'area-one', { section: 'agents' });
  assert.equal(parsePage(hash).section, 'agents');
  assert.match(source('src/views/Teams.jsx'), /<AgentLinks targetType="area"/);
  assert.match(source('src/views/ProjectHub.jsx'), /<AgentLinks targetType="project"/);
  assert.match(source('src/views/Projects.jsx'), /<AgentLinks targetType="route"/);
});

test('More stays in layout flow, profile inspector sits below roster, and custom selects have only one focus edge', () => {
  const sidebar = source('src/components/sidebar-v2.css'), roster = source('src/views/agents-page.css');
  assert.match(sidebar, /\.sidebar-free-layout\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*min-content/s);
  assert.match(roster, /\.agent-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(source('src/views/AgentRoster.jsx'), /!page.id \? <section className="agent-provider-strip"/);
  assert.match(source('src/components/select-field.css'), /focus-visible[^}]*outline:\s*none;[^}]*box-shadow:\s*none/s);
});

test('self-link review describes membership, not the archive fallback', () => {
  const review = source('src/components/AgentActionReview.jsx');
  assert.match(review, /'agent\.self_link': `Link agent to/);
  assert.match(review, /proposal\.type === 'agent\.self_link'[\s\S]*?does not change its default project or grant new permissions/);
});
