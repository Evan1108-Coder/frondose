import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { frondoseEnvironment, frondoseDataDirectory, frondoseDatabasePath } from '../server/brand-config.mjs';
import { installFrondoseBrand } from '../server/brand-migration.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { createDeploymentPolicy } from '../server/deployment-policy.mjs';
import { snapshotAgentProfile } from '../server/agent-profiles.mjs';
import { createIdentityService } from '../server/identity-service.mjs';
import { analyzeFieldSource } from '../scripts/field-defaults-transform.mjs';
import { parsePage, pageHash } from '../src/lib/navigation.js';
import { parseSlashCommand } from '../src/lib/commands.js';
import { documentLink } from '../src/lib/document-markdown.js';
import { captureAgentActions } from '../server/agent-awareness.mjs';

const temp = (t, cleanup = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'frondose-rebrand-'));
  t.after(async () => {
    try { for (const close of cleanup.reverse()) await close(); }
    finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
  });
  return dir;
};

test('new environment names take precedence, including explicit empty values; legacy rotation remains live', () => {
  const input = { RUMBO_HF_CLIENT_ID: 'old-registration', RUMBO_GITHUB_CLIENT_SECRET: 'legacy-secret' };
  const env = frondoseEnvironment(input);
  assert.equal(env.FRONDOSE_HF_CLIENT_ID, 'old-registration');
  assert.equal(env.FRONDOSE_GITHUB_CLIENT_SECRET, 'legacy-secret');
  input.RUMBO_HF_CLIENT_ID = 'rotated'; assert.equal(env.FRONDOSE_HF_CLIENT_ID, 'rotated');
  input.FRONDOSE_HF_CLIENT_ID = 'new-registration'; assert.equal(env.FRONDOSE_HF_CLIENT_ID, 'new-registration');
  input.FRONDOSE_HF_CLIENT_ID = ''; assert.equal(env.FRONDOSE_HF_CLIENT_ID, '');
});

test('legacy public-mode configuration still enforces HTTPS and encryption requirements', () => {
  const env = { RUMBO_DEPLOYMENT_MODE: 'public', RUMBO_PUBLIC_BASE_URL: 'https://frondose.example', RUMBO_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
  assert.equal(createDeploymentPolicy(env).hosted, true);
  assert.throws(() => createDeploymentPolicy({ ...env, FRONDOSE_CONNECTION_ENCRYPTION_KEY: '' }), /stable/);
});

test('Talvori operator settings still work, rotate live, and never override explicit Frondose empties', () => {
  const input = { RUMBO_HF_CLIENT_ID: 'rumbo', TALVORI_HF_CLIENT_ID: 'talvori' };
  const env = frondoseEnvironment(input);
  assert.equal(env.FRONDOSE_HF_CLIENT_ID, 'talvori');
  input.TALVORI_HF_CLIENT_ID = 'rotated'; assert.equal(env.FRONDOSE_HF_CLIENT_ID, 'rotated');
  input.FRONDOSE_HF_CLIENT_ID = ''; assert.equal(env.FRONDOSE_HF_CLIENT_ID, '');
  delete input.FRONDOSE_HF_CLIENT_ID;
  input.TALVORI_HF_CLIENT_ID = ''; assert.equal(env.FRONDOSE_HF_CLIENT_ID, '');
  delete input.TALVORI_HF_CLIENT_ID; assert.equal(env.FRONDOSE_HF_CLIENT_ID, 'rumbo');
  const publicEnv = { TALVORI_DEPLOYMENT_MODE: 'public', TALVORI_PUBLIC_BASE_URL: 'https://frondose.example', TALVORI_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
  assert.equal(createDeploymentPolicy(publicEnv).hosted, true);
  assert.throws(() => createDeploymentPolicy({ ...publicEnv, FRONDOSE_CONNECTION_ENCRYPTION_KEY: '' }), /stable/);
});

test('a Talvori private database is reused in place rather than replaced with an empty Frondose installation', t => {
  const cwd = temp(t), old = join(cwd, '.talvori');
  mkdirSync(old); writeFileSync(join(old, 'talvori.sqlite'), 'fixture');
  assert.equal(frondoseDataDirectory(null, cwd), old);
  assert.equal(frondoseDatabasePath(old), join(old, 'talvori.sqlite'));
  assert.equal(frondoseDataDirectory(old, cwd), old);
});

test('new installations use Frondose paths; existing database paths never silently reset', t => {
  const cwd = temp(t), legacy = join(cwd, '.rumbo'), current = join(cwd, '.frondose');
  assert.equal(frondoseDataDirectory(null, cwd), current);
  mkdirSync(legacy); writeFileSync(join(legacy, 'rumbo.sqlite'), 'fixture');
  assert.equal(frondoseDataDirectory(null, cwd), legacy);
  assert.equal(frondoseDatabasePath(legacy), join(legacy, 'rumbo.sqlite'));
  mkdirSync(current); writeFileSync(join(current, 'frondose.sqlite'), 'fixture');
  assert.equal(frondoseDataDirectory(null, cwd), current);
  assert.equal(frondoseDataDirectory(legacy, cwd), legacy);
});

test('an explicitly selected legacy database reopens without losing records', t => {
  const cleanup = [], dir = temp(t, cleanup); let api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  const original = api.snapshot().workspaces.map(row => row.id); api.close();
  renameSync(join(dir, 'frondose.sqlite'), join(dir, 'rumbo.sqlite'));
  api = createLocalApi({ dataDir: dir, integrationOptions: { env: {} } }); cleanup.push(() => api.close());
  assert.equal(api.dbPath, join(dir, 'rumbo.sqlite'));
  assert.deepEqual(api.snapshot().workspaces.map(row => row.id), original);
});

test('default-name migration is backed up, versioned, idempotent, and preserves custom names, guidance and history', t => {
  const cleanup = [], dir = temp(t, cleanup), api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  const path = api.dbPath; api.close(); const db = new DatabaseSync(path); cleanup.push(() => db.close());
  db.prepare('DELETE FROM settings WHERE key=?').run('brand.frondose.v1');
  db.prepare("UPDATE workspaces SET name='Rumbo Studio' WHERE id='ws_personal'").run();
  const stamp = new Date().toISOString();
  for (const [id, name] of [['rumbo_agent_fixture', 'Rumbo Agent'], ['rumbo_agent_custom', 'My Rumbo research helper']]) db.prepare('INSERT INTO agents(id,workspace_id,name,provider,instructions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, 'ws_personal', name, 'codex', 'My instructions mention Rumbo; do not rewrite.', stamp, stamp);
  snapshotAgentProfile(db, 'rumbo_agent_fixture');
  const historical = db.prepare('SELECT snapshot_hash FROM agent_profile_versions WHERE agent_id=? AND version=1').get('rumbo_agent_fixture').snapshot_hash;
  db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run('rumboAgent:ws_personal', JSON.stringify({ display_name: 'Rumbo Agent', guidelines: 'Keep my Rumbo notes intact.' }), stamp);
  installFrondoseBrand(db, dir);
  assert.equal(db.prepare("SELECT name FROM workspaces WHERE id='ws_personal'").get().name, 'Frondose Studio');
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get('rumbo_agent_fixture');
  assert.equal(agent.name, 'Frondose'); assert.equal(agent.version, 2);
  assert.equal(agent.instructions, 'My instructions mention Rumbo; do not rewrite.');
  assert.equal(db.prepare('SELECT name FROM agents WHERE id=?').get('rumbo_agent_custom').name, 'My Rumbo research helper');
  assert.equal(db.prepare('SELECT snapshot_hash FROM agent_profile_versions WHERE agent_id=? AND version=1').get('rumbo_agent_fixture').snapshot_hash, historical);
  const prefs = JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get('rumboAgent:ws_personal').value_json);
  assert.equal(prefs.display_name, 'Frondose'); assert.equal(prefs.guidelines, 'Keep my Rumbo notes intact.');
  const backups = readdirSync(join(dir, 'backups')); assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(dir, 'backups', backups[0]), { readOnly: true });
  assert.equal(backup.prepare("SELECT name FROM workspaces WHERE id='ws_personal'").get().name, 'Rumbo Studio'); backup.close();
  installFrondoseBrand(db, dir); assert.equal(readdirSync(join(dir, 'backups')).length, 1);
  assert.equal(db.prepare('SELECT version FROM agents WHERE id=?').get('rumbo_agent_fixture').version, 2);
});

test('legacy and Frondose assistant links resolve identically; generated links use the new brand', () => {
  assert.deepEqual(parsePage('#/frondose-agent/chat?message=message'), parsePage('#/rumbo-agent/chat?message=message'));
  assert.equal(pageHash('rumbo-agent', 'chat'), '#/frondose-agent/chat');
  assert.equal(pageHash('frondose-agent'), '#/frondose-agent');
  assert.equal(pageHash('settings', 'rumbo-agent'), '#/settings/frondose-agent');
  assert.equal(parsePage('#/settings/frondose-agent').id, 'rumbo-agent');
  assert.equal(parseSlashCommand('/frondose help').command.id, parseSlashCommand('/rumbo help').command.id);
  assert.deepEqual(parsePage('#/talvori-agent/chat?section=activity'), parsePage('#/frondose-agent/chat?section=activity'));
  assert.equal(pageHash('talvori-agent'), '#/frondose-agent');
  assert.equal(parsePage('#/settings/talvori-agent').id, 'rumbo-agent');
  assert.equal(parseSlashCommand('/talvori help').command.id, 'rumbo');
  assert.equal(documentLink('#/talvori-agent').page.view, 'rumbo-agent');
  assert.equal(documentLink('#/rumbo-agent').page.view, 'rumbo-agent');
  assert.equal(documentLink('#/settings/talvori-agent').page.id, 'rumbo-agent');
  assert.equal(parsePage('#/reader/docs%3Ainitial-launch?from=' + encodeURIComponent('#/talvori-agent')).returnTo, '#/talvori-agent');
});

test('existing Talvori defaults migrate once with a recovery backup and without touching authored records', t => {
  const cleanup = [], dir = temp(t, cleanup), api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  const path = api.dbPath; api.close();
  const db = new DatabaseSync(path); cleanup.push(() => db.close());
  db.prepare('DELETE FROM settings WHERE key=?').run('brand.frondose.v1');
  const stamp = new Date().toISOString();
  db.prepare("UPDATE workspaces SET name='Talvori Studio' WHERE id='ws_personal'").run();
  for (const [id, name] of [['rumbo_agent_old', 'Talvori'], ['rumbo_agent_custom', 'My Talvori research helper']]) {
    db.prepare('INSERT INTO agents(id,workspace_id,name,provider,instructions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, 'ws_personal', name, 'codex', 'My Talvori instructions remain verbatim.', stamp, stamp);
    snapshotAgentProfile(db, id);
  }
  db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run('rumboAgent:ws_personal', JSON.stringify({ display_name: 'Talvori', provider:'codex', provider_selected:true, guidelines:'Keep Talvori in my notes.' }), stamp);
  installFrondoseBrand(db, dir);
  assert.equal(db.prepare("SELECT name FROM workspaces WHERE id='ws_personal'").get().name, 'Frondose Studio');
  assert.equal(db.prepare("SELECT name FROM agents WHERE id='rumbo_agent_old'").get().name, 'Frondose');
  assert.equal(db.prepare("SELECT name FROM agents WHERE id='rumbo_agent_custom'").get().name, 'My Talvori research helper');
  assert.equal(db.prepare("SELECT instructions FROM agents WHERE id='rumbo_agent_old'").get().instructions, 'My Talvori instructions remain verbatim.');
  const prefs = JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get('rumboAgent:ws_personal').value_json);
  assert.deepEqual(prefs, { display_name:'Frondose', provider:'codex', provider_selected:true, guidelines:'Keep Talvori in my notes.' });
  const backups = readdirSync(join(dir, 'backups'));
  const recovery = new DatabaseSync(join(dir, 'backups', backups[0]), { readOnly: true });
  assert.equal(recovery.prepare("SELECT name FROM workspaces WHERE id='ws_personal'").get().name, 'Talvori Studio'); recovery.close();
  installFrondoseBrand(db, dir);
  assert.equal(readdirSync(join(dir, 'backups')).length, backups.length);
  assert.equal(db.prepare("SELECT version FROM agents WHERE id='rumbo_agent_old'").get().version, 2);
});

test('old and new assistant API routes share the same access boundary and result', async t => {
  const cleanup = [], dir = temp(t, cleanup), api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  cleanup.push(() => api.close());
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const read = async name => { const res = await fetch(`${base}/${name}?workspace_id=ws_personal`); return { status: res.status, json: await res.json() }; };
  assert.deepEqual(await read('frondose-agent'), await read('rumbo-agent'));
  assert.deepEqual(await read('frondose-agent'), await read('talvori-agent'));
  const exported = await fetch(`${base}/export?workspace_id=ws_personal`).then(res => res.json());
  assert.equal(exported.format, 'frondose.workspace');
  for (const format of ['frondose.workspace', 'talvori.workspace', 'rumbo.workspace']) {
    const response = await fetch(`${base}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...exported, format }) });
    assert.equal(response.status, 201, `${format}: ${JSON.stringify(await response.json())}`);
  }
});

test('old session cookies stay usable; new sessions use the Frondose cookie name', async t => {
  const cleanup = [], dir = temp(t, cleanup), api = createLocalApi({ dataDir: dir, integrationOptions: { env: {} } });
  cleanup.push(() => api.close());
  const db = new DatabaseSync(api.dbPath); cleanup.push(() => db.close());
  const identity = createIdentityService({ db });
  const session = await identity.setup({ name: 'Owner', email: 'owner@example.com', password: 'a fixture password 123' }, { id: 'local-owner' });
  assert.match(identity.cookie(session.token, true), /^frondose_session=.*Secure$/);
  for (const name of ['frondose_session', 'talvori_session', 'rumbo_session']) assert.equal(identity.resolve({ headers: { cookie: `${name}=${session.token}` } }).id, 'local-owner');
});

test('rebranded source labels and filenames preserve saved field-default identities', () => {
  const before = 'export function RumboAgentPreferences(){return <label>Agent name<input value={form.display_name} placeholder="Rumbo Agent" /></label>}';
  const after = before.replaceAll('Rumbo', 'Frondose');
  const old = analyzeFieldSource(before, 'src/views/settings/RumboAgentPreferences.jsx')[0];
  const current = analyzeFieldSource(after, 'src/views/settings/FrondoseAgentPreferences.jsx')[0];
  assert.equal(old.key, current.key);
  const talvori = analyzeFieldSource(before.replaceAll('Rumbo', 'Talvori'), 'src/views/settings/TalvoriAgentPreferences.jsx')[0];
  assert.equal(talvori.key, current.key);
});

test('all three branded action fences retain the same nonce validation boundary', () => {
  for (const brand of ['frondose', 'talvori', 'rumbo']) {
    const text = 'Reply.\n```' + brand + '-actions\n' + JSON.stringify({nonce:'wrong',actions:[{type:'route.create'}]}) + '\n```';
    assert.throws(() => captureAgentActions(null, 'run', text, 'expected'), /Invalid agent action capability/);
  }
});

test('installed-app metadata and active logos use Frondose, not legacy artwork', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const brand = readFileSync(new URL('../src/components/Brand.jsx', import.meta.url), 'utf8');
  assert.match(html, /<title>Frondose<\/title>/); assert.doesNotMatch(html, /Rumbo|rumbo/);
  assert.equal(manifest.name, 'Frondose'); assert.equal(manifest.short_name, 'Frondose');
  assert.ok(manifest.icons.every(icon => icon.src.includes('frondose')));
  assert.doesNotMatch(brand, /\/brand\/rumbo/);
});
