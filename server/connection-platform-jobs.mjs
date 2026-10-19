import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { CONNECTOR_CATALOG } from './connectors/catalog.mjs';
import { providerError as fail } from './connectors/adapters.mjs';
import { connectionReadOptions, effectiveReadOptions } from './connectors/read-options.mjs';

const now = () => new Date().toISOString();
const signedEqual = (actual, expected) => typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));

export function createConnectionJobs({ db, env, check, get, sync, imports, audit, intervalMs = 5000, paused = false }) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_sync_jobs (
    id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL,kind TEXT NOT NULL,cursor TEXT,actor_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS platform_sync_jobs_due ON platform_sync_jobs(state,next_attempt_at);
  CREATE TABLE IF NOT EXISTS platform_sync_policies (
    connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id) ON DELETE CASCADE,
    actor_json TEXT NOT NULL,webhooks_enabled INTEGER NOT NULL DEFAULT 0,reconcile_minutes INTEGER NOT NULL DEFAULT 0,
    next_reconcile_at INTEGER NOT NULL DEFAULT 0,auto_update_imports INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS platform_webhook_deliveries (
    connection_id TEXT NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
    delivery_id TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(connection_id,delivery_id));`);
  if (!db.prepare('PRAGMA table_info(platform_sync_jobs)').all().some(column => column.name === 'read_options')) db.exec("ALTER TABLE platform_sync_jobs ADD COLUMN read_options TEXT NOT NULL DEFAULT '{}'");
  // Paused releases must not resume old work if the worker is later re-enabled.
  // Keep the job records for inspection and require an explicit future retry.
  if (paused) db.prepare("UPDATE platform_sync_jobs SET state='paused',updated_at=? WHERE state IN ('pending','running')").run(now());
  else db.prepare("UPDATE platform_sync_jobs SET state='pending' WHERE state='running'").run();
  let processing = false, closed = false;
  const supported = provider => ['github', 'linear', 'slack'].includes(CONNECTOR_CATALOG[provider]?.auth_family);
  const secretFor = provider => env[`TALVORI_${CONNECTOR_CATALOG[provider].auth_family.toUpperCase()}_WEBHOOK_SECRET`];
  const configuredKinds = connection => CONNECTOR_CATALOG[connection.provider].sync_kinds.filter(kind => {
    try { connectionReadOptions(connection.provider, connection.settings.read_options || {}, kind); return true; }
    catch (error) { if (error.code === 'invalid_read_options') return false; throw error; }
  });
  const insert = (id, resource_id, kind, actor, cursor = null, readOptions) => {
    const connection = get(id), options = JSON.stringify(connectionReadOptions(connection.provider, readOptions ?? connection.settings.read_options ?? {}, kind));
    const existing = db.prepare("SELECT id FROM platform_sync_jobs WHERE connection_id=? AND resource_id=? AND kind=? AND COALESCE(cursor,'')=COALESCE(?,'') AND read_options=? AND state IN ('pending','running')").get(id, resource_id, kind, cursor, options);
    if (existing) return existing.id;
    const jobId = randomUUID(); db.prepare('INSERT INTO platform_sync_jobs(id,connection_id,resource_id,kind,cursor,actor_json,next_attempt_at,created_at,updated_at,read_options) VALUES(?,?,?,?,?,?,?,?,?,?)').run(jobId, id, resource_id, kind, cursor, JSON.stringify(actor), Date.now(), now(), now(), options); return jobId;
  };
  async function enqueue(id, input, actor) {
    const connection = get(id); await check(actor, connection, 'connections.sync');
    if (!connection.settings.selected_resources.includes(input?.resource_id)) throw fail('resource_not_selected', 'Select a resource in connection settings first.', 403);
    const kind = input.kind || CONNECTOR_CATALOG[connection.provider].sync_kinds[0];
    if (!CONNECTOR_CATALOG[connection.provider].sync_kinds.includes(kind)) throw fail('invalid_kind', 'Choose a supported sync type.');
    const options = effectiveReadOptions(connection.provider, connection.settings.read_options, input, kind);
    return { id: insert(id, input.resource_id, kind, actor, null, options), state: 'pending' };
  }
  async function policy(id, actor, input) {
    const connection = get(id); await check(actor, connection, input ? 'connections.manage' : 'connections.view');
    let row = db.prepare('SELECT * FROM platform_sync_policies WHERE connection_id=?').get(id);
    if (input) {
      const minutes = Number(input.reconcile_minutes ?? row?.reconcile_minutes ?? 0), webhooks = input.webhooks_enabled ?? Boolean(row?.webhooks_enabled), auto = input.auto_update_imports ?? Boolean(row?.auto_update_imports);
      if (![0, 5, 15, 30, 60, 360, 1440].includes(minutes) || typeof webhooks !== 'boolean' || typeof auto !== 'boolean') throw fail('invalid_policy', 'Choose a supported synchronization schedule.');
      if (webhooks && (!supported(connection.provider) || !secretFor(connection.provider))) throw fail('webhook_setup_required', 'The Talvori operator must configure a supported provider webhook signing secret first.', 409);
      await check(actor, connection, 'connections.sync');
      if (auto) await check(actor, connection, 'connections.import');
      db.prepare('INSERT INTO platform_sync_policies VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET actor_json=excluded.actor_json,webhooks_enabled=excluded.webhooks_enabled,reconcile_minutes=excluded.reconcile_minutes,next_reconcile_at=excluded.next_reconcile_at,auto_update_imports=excluded.auto_update_imports').run(id, JSON.stringify(actor), Number(webhooks), minutes, minutes ? Date.now() + minutes * 60000 : 0, Number(auto));
      row = db.prepare('SELECT * FROM platform_sync_policies WHERE connection_id=?').get(id); audit(connection, actor, 'sync_policy_updated', { reconcile_minutes: minutes, webhooks_enabled: webhooks, auto_update_imports: auto });
    }
    const base = env.TALVORI_CONNECTION_CALLBACK_URL || 'http://127.0.0.1:4174/api/connection-platform/oauth/callback';
    return { webhooks_supported: supported(connection.provider), webhooks_configured: Boolean(secretFor(connection.provider)), webhooks_enabled: Boolean(row?.webhooks_enabled), reconcile_minutes: row?.reconcile_minutes || 0, auto_update_imports: Boolean(row?.auto_update_imports), webhook_url: new URL(`/api/connection-platform/webhooks/${id}`, base).href, next_reconcile_at: row?.next_reconcile_at ? new Date(row.next_reconcile_at).toISOString() : null };
  }
  async function jobs(id, actor) { const connection = get(id); await check(actor, connection, 'connections.view'); return db.prepare('SELECT id,resource_id,kind,state,attempts,next_attempt_at,last_error,created_at,updated_at FROM platform_sync_jobs WHERE connection_id=? ORDER BY created_at DESC LIMIT 200').all(id); }
  async function retry(id, jobId, actor) {
    const connection = get(id); await check(actor, connection, 'connections.sync');
    const job = db.prepare('SELECT * FROM platform_sync_jobs WHERE id=? AND connection_id=?').get(jobId, id);
    if (!job || !['failed', 'cancelled'].includes(job.state)) throw fail('invalid_job', 'Choose a failed job to retry.', 409);
    if (!connection.settings.selected_resources.includes(job.resource_id)) throw fail('resource_not_selected', 'This resource is no longer enabled.', 403);
    db.prepare("UPDATE platform_sync_jobs SET state='pending',attempts=0,next_attempt_at=?,last_error=NULL,actor_json=?,updated_at=? WHERE id=?").run(Date.now(), JSON.stringify(actor), now(), jobId); return { id: jobId, state: 'pending' };
  }
  async function ingest(id, rawBody, headers = {}) {
    const connection = get(id), cfg = db.prepare('SELECT * FROM platform_sync_policies WHERE connection_id=?').get(id), family = CONNECTOR_CATALOG[connection.provider].auth_family;
    if (!cfg?.webhooks_enabled || !supported(connection.provider) || connection.state !== 'connected') throw fail('webhook_disabled', 'Webhook is unavailable.', 404);
    const secret = secretFor(connection.provider);
    if (!secret || typeof rawBody !== 'string' || Buffer.byteLength(rawBody) > 2_000_000) throw fail('invalid_webhook', 'Invalid webhook request.', 400);
    const h = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    let signature, expected;
    if (family === 'github') { signature = h['x-hub-signature-256']; expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`; }
    if (family === 'linear') { signature = h['linear-signature']; expected = createHmac('sha256', secret).update(rawBody).digest('hex'); }
    if (family === 'slack') { const timestamp = h['x-slack-request-timestamp']; if (!/^\d+$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw fail('stale_webhook', 'Webhook timestamp is invalid.', 401); signature = h['x-slack-signature']; expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`; }
    if (!signedEqual(signature, expected)) throw fail('invalid_signature', 'Webhook signature is invalid.', 401);
    let event; try { event = JSON.parse(rawBody); } catch { throw fail('invalid_webhook', 'Webhook must contain valid JSON.'); }
    if (family === 'linear' && (!Number.isFinite(event.webhookTimestamp) || Math.abs(Date.now() - event.webhookTimestamp) > 60000)) throw fail('stale_webhook', 'Webhook timestamp is invalid.', 401);
    if (family === 'slack' && event.type === 'url_verification') return { challenge: String(event.challenge || '').slice(0, 1000) };
    const delivery = family === 'github' ? h['x-github-delivery'] : family === 'slack' ? event.event_id : h['linear-delivery'] || createHash('sha256').update(rawBody).digest('hex');
    if (typeof delivery !== 'string' || !delivery || delivery.length > 300) throw fail('invalid_delivery', 'Webhook delivery identifier is missing.');
    if (db.prepare('SELECT 1 FROM platform_webhook_deliveries WHERE connection_id=? AND delivery_id=?').get(id, delivery)) return { accepted: true, duplicate: true };
    const actor = JSON.parse(cfg.actor_json); await check(actor, connection, 'connections.sync');
    const requested = family === 'github' ? event.repository?.full_name : family === 'slack' ? event.event?.channel : event.data?.teamId;
    const selected = connection.settings.selected_resources.filter(resource => !requested || resource === requested);
    db.exec('BEGIN'); try { db.prepare('INSERT INTO platform_webhook_deliveries VALUES(?,?,?)').run(id, delivery, now()); for (const resource of selected) for (const kind of configuredKinds(connection)) insert(id, resource, kind, actor); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit(connection, actor, 'webhook_received', { delivery_id: delivery, queued_resources: selected.length }); return { accepted: true, queued_resources: selected.length };
  }
  async function tick() {
    if (processing || closed) return; processing = true;
    try {
      for (const row of db.prepare('SELECT * FROM platform_sync_policies WHERE reconcile_minutes>0 AND next_reconcile_at<=?').all(Date.now())) {
        const connection = get(row.connection_id), actor = JSON.parse(row.actor_json);
        db.prepare('UPDATE platform_sync_policies SET next_reconcile_at=? WHERE connection_id=?').run(Date.now() + row.reconcile_minutes * 60000, connection.id);
        if (connection.state !== 'connected') continue;
        try { await check(actor, connection, 'connections.sync'); for (const resource of connection.settings.selected_resources) for (const kind of configuredKinds(connection)) insert(connection.id, resource, kind, actor); }
        catch { audit(connection, actor, 'scheduled_sync_denied'); }
      }
      const job = db.prepare("SELECT * FROM platform_sync_jobs WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 1").get(Date.now());
      if (!job) return;
      db.prepare("UPDATE platform_sync_jobs SET state='running',attempts=attempts+1,updated_at=? WHERE id=?").run(now(), job.id);
      try {
        const actor = JSON.parse(job.actor_json), readOptions = connectionReadOptions(get(job.connection_id).provider, JSON.parse(job.read_options)), result = await sync(job.connection_id, { resource_id: job.resource_id, kind: job.kind, cursor: job.cursor || undefined, ...readOptions }, actor);
        if (closed) return;
        db.prepare("UPDATE platform_sync_jobs SET state='completed',last_error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
        if (result.cursor && result.cursor !== job.cursor) insert(job.connection_id, job.resource_id, job.kind, actor, result.cursor, readOptions);
        const policy = db.prepare('SELECT auto_update_imports FROM platform_sync_policies WHERE connection_id=?').get(job.connection_id);
        if (policy?.auto_update_imports) for (const link of db.prepare('SELECT links.* FROM platform_object_links links JOIN platform_external_objects objects ON objects.id=links.object_id WHERE links.connection_id=? AND objects.resource_id=?').all(job.connection_id, job.resource_id)) await imports.importObject(job.connection_id, { object_id: link.object_id, target_type: link.target_type }, actor);
      } catch (error) {
        if (closed) return;
        const permanent = [400, 403, 404, 409].includes(error.statusCode), exhausted = job.attempts + 1 >= 5;
        db.prepare('UPDATE platform_sync_jobs SET state=?,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?').run(permanent || exhausted ? 'failed' : 'pending', Date.now() + Math.max(error.retryAfterMs || 0, Math.min(3600000, 30000 * 2 ** job.attempts)), error.code ? error.message : 'Synchronization failed. Review the connection and retry.', now(), job.id);
      }
    } finally { processing = false; }
  }
  const timer = intervalMs > 0 ? setInterval(() => { tick().catch(() => {}); }, intervalMs) : null; timer?.unref();
  return { enqueue, policy, jobs, retry, ingest, tick, close: () => { closed = true; if (timer) clearInterval(timer); } };
}
