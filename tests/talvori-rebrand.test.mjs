import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { talvoriEnvironment, talvoriDataDirectory, talvoriDatabasePath } from '../server/brand-config.mjs';
import { installTalvoriBrand } from '../server/brand-migration.mjs';
import { createLocalApi } from '../server/local-api.mjs';
import { createDeploymentPolicy } from '../server/deployment-policy.mjs';
import { snapshotAgentProfile } from '../server/agent-profiles.mjs';
import { createIdentityService } from '../server/identity-service.mjs';
import { analyzeFieldSource } from '../scripts/field-defaults-transform.mjs';
import { parsePage, pageHash } from '../src/lib/navigation.js';
import { parseSlashCommand } from '../src/lib/commands.js';

const temp = t => { const dir = mkdtempSync(join(tmpdir(), 'talvori-rebrand-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

test('new environment names take precedence, including explicit empty values; legacy rotation remains live', () => {
  const input = { RUMBO_HF_CLIENT_ID: 'old-registration', RUMBO_GITHUB_CLIENT_SECRET: 'legacy-secret' };
  const env = talvoriEnvironment(input);
  assert.equal(env.TALVORI_HF_CLIENT_ID, 'old-registration');
  assert.equal(env.TALVORI_GITHUB_CLIENT_SECRET, 'legacy-secret');
  input.RUMBO_HF_CLIENT_ID = 'rotated'; assert.equal(env.TALVORI_HF_CLIENT_ID, 'rotated');
  input.TALVORI_HF_CLIENT_ID = 'new-registration'; assert.equal(env.TALVORI_HF_CLIENT_ID, 'new-registration');
  input.TALVORI_HF_CLIENT_ID = ''; assert.equal(env.TALVORI_HF_CLIENT_ID, '');
});

test('legacy public-mode configuration still enforces HTTPS and encryption requirements', () => {
  const env = { RUMBO_DEPLOYMENT_MODE: 'public', RUMBO_PUBLIC_BASE_URL: 'https://talvori.example', RUMBO_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
  assert.equal(createDeploymentPolicy(env).hosted, true);
  assert.throws(() => createDeploymentPolicy({ ...env, TALVORI_CONNECTION_ENCRYPTION_KEY: '' }), /stable/);
});

test('new installations use Talvori paths; existing database paths never silently reset', t => {
  const cwd = temp(t), legacy = join(cwd, '.rumbo'), current = join(cwd, '.talvori');
  assert.equal(talvoriDataDirectory(null, cwd), current);
  mkdirSync(legacy); writeFileSync(join(legacy, 'rumbo.sqlite'), 'fixture');
  assert.equal(talvoriDataDirectory(null, cwd), legacy);
  assert.equal(talvoriDatabasePath(legacy), join(legacy, 'rumbo.sqlite'));
  mkdirSync(current); writeFileSync(join(current, 'talvori.sqlite'), 'fixture');
  assert.equal(talvoriDataDirectory(null, cwd), current);
  assert.equal(talvoriDataDirectory(legacy, cwd), legacy);
});

test('an explicitly selected legacy database reopens without losing records', t => {
  const dir = temp(t); let api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  const original = api.snapshot().workspaces.map(row => row.id); api.close();
  renameSync(join(dir, 'talvori.sqlite'), join(dir, 'rumbo.sqlite'));
  api = createLocalApi({ dataDir: dir, integrationOptions: { env: {} } }); t.after(() => api.close());
  assert.equal(api.dbPath, join(dir, 'rumbo.sqlite'));
  assert.deepEqual(api.snapshot().workspaces.map(row => row.id), original);
});

test('default-name migration is backed up, versioned, idempotent, and preserves custom names, guidance and history', t => {
  const dir = temp(t), api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  const path = api.dbPath; api.close(); const db = new DatabaseSync(path); t.after(() => db.close());
  db.prepare('DELETE FROM settings WHERE key=?').run('brand.talvori.v2');
  db.prepare("UPDATE workspaces SET name='Rumbo Studio' WHERE id='ws_personal'").run();
  const stamp = new Date().toISOString();
  for (const [id, name] of [['rumbo_agent_fixture', 'Rumbo Agent'], ['rumbo_agent_custom', 'My Rumbo research helper']]) db.prepare('INSERT INTO agents(id,workspace_id,name,provider,instructions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, 'ws_personal', name, 'codex', 'My instructions mention Rumbo; do not rewrite.', stamp, stamp);
  snapshotAgentProfile(db, 'rumbo_agent_fixture');
  const historical = db.prepare('SELECT snapshot_hash FROM agent_profile_versions WHERE agent_id=? AND version=1').get('rumbo_agent_fixture').snapshot_hash;
  db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run('rumboAgent:ws_personal', JSON.stringify({ display_name: 'Rumbo Agent', guidelines: 'Keep my Rumbo notes intact.' }), stamp);
  installTalvoriBrand(db, dir);
  assert.equal(db.prepare("SELECT name FROM workspaces WHERE id='ws_personal'").get().name, 'Talvori Studio');
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get('rumbo_agent_fixture');
  assert.equal(agent.name, 'Talvori'); assert.equal(agent.version, 2);
  assert.equal(agent.instructions, 'My instructions mention Rumbo; do not rewrite.');
  assert.equal(db.prepare('SELECT name FROM agents WHERE id=?').get('rumbo_agent_custom').name, 'My Rumbo research helper');
  assert.equal(db.prepare('SELECT snapshot_hash FROM agent_profile_versions WHERE agent_id=? AND version=1').get('rumbo_agent_fixture').snapshot_hash, historical);
  const prefs = JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get('rumboAgent:ws_personal').value_json);
  assert.equal(prefs.display_name, 'Talvori'); assert.equal(prefs.guidelines, 'Keep my Rumbo notes intact.');
  const backups = readdirSync(join(dir, 'backups')); assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(dir, 'backups', backups[0]), { readOnly: true });
  assert.equal(backup.prepare("SELECT name FROM workspaces WHERE id='ws_personal'").get().name, 'Rumbo Studio'); backup.close();
  installTalvoriBrand(db, dir); assert.equal(readdirSync(join(dir, 'backups')).length, 1);
  assert.equal(db.prepare('SELECT version FROM agents WHERE id=?').get('rumbo_agent_fixture').version, 2);
});

test('legacy and Talvori assistant links resolve identically; generated links use the new brand', () => {
  assert.deepEqual(parsePage('#/talvori-agent/chat?message=message'), parsePage('#/rumbo-agent/chat?message=message'));
  assert.equal(pageHash('rumbo-agent', 'chat'), '#/talvori-agent/chat');
  assert.equal(pageHash('talvori-agent'), '#/talvori-agent');
  assert.equal(pageHash('settings', 'rumbo-agent'), '#/settings/talvori-agent');
  assert.equal(parsePage('#/settings/talvori-agent').id, 'rumbo-agent');
  assert.equal(parseSlashCommand('/talvori help').command.id, parseSlashCommand('/rumbo help').command.id);
});

test('old and new assistant API routes share the same access boundary and result', async t => {
  const dir = temp(t), api = createLocalApi({ dataDir: dir, seedMode: 'demo', integrationOptions: { env: {} } });
  const server = createServer((req, res) => api.middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); api.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const read = async name => { const res = await fetch(`${base}/${name}?workspace_id=ws_personal`); return { status: res.status, json: await res.json() }; };
  assert.deepEqual(await read('talvori-agent'), await read('rumbo-agent'));
});

test('old session cookies stay usable; new sessions use the Talvori cookie name', async t => {
  const dir = temp(t), api = createLocalApi({ dataDir: dir, integrationOptions: { env: {} } });
  const db = new DatabaseSync(api.dbPath); t.after(() => { db.close(); api.close(); });
  const identity = createIdentityService({ db });
  const session = await identity.setup({ name: 'Owner', email: 'owner@example.com', password: 'a fixture password 123' }, { id: 'local-owner' });
  assert.match(identity.cookie(session.token, true), /^talvori_session=.*Secure$/);
  for (const name of ['talvori_session', 'rumbo_session']) assert.equal(identity.resolve({ headers: { cookie: `${name}=${session.token}` } }).id, 'local-owner');
});

test('rebranded source labels and filenames preserve saved field-default identities', () => {
  const before = 'export function RumboAgentPreferences(){return <label>Agent name<input value={form.display_name} placeholder="Rumbo Agent" /></label>}';
  const after = before.replaceAll('Rumbo', 'Talvori');
  const old = analyzeFieldSource(before, 'src/views/settings/RumboAgentPreferences.jsx')[0];
  const current = analyzeFieldSource(after, 'src/views/settings/TalvoriAgentPreferences.jsx')[0];
  assert.equal(old.key, current.key);
});

test('installed-app metadata and active logos use Talvori, not legacy artwork', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const brand = readFileSync(new URL('../src/components/Brand.jsx', import.meta.url), 'utf8');
  assert.match(html, /<title>Talvori<\/title>/); assert.doesNotMatch(html, /Rumbo|rumbo/);
  assert.equal(manifest.name, 'Talvori'); assert.equal(manifest.short_name, 'Talvori');
  assert.ok(manifest.icons.every(icon => icon.src.includes('talvori')));
  assert.doesNotMatch(brand, /\/brand\/rumbo/);
});
