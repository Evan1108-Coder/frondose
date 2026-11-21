import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { createTerminalLaunchPlan, detectTerminalProviders } from './terminal-launch-plan.mjs';
import { createAgentJsonlPeer, terminateAgentProcess } from './agent-jsonl-peer.mjs';
import { COMPUTER_USE_TOOL, computerUseAction } from '../src/lib/computer-use-action.js';
import { isPiChat, runWorkspacePiChat } from './workspace-chat-pi.mjs';

const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode, code: 'workspace_agent_chat_error' });
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const nativeSessionId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const claudeConfigured = env => typeof env.FRONDOSE_CLAUDE_API_KEY === 'string' && Boolean(env.FRONDOSE_CLAUDE_API_KEY.trim()) && env.FRONDOSE_CLAUDE_API_KEY.length <= 20000 && !/[\0\r\n]/.test(env.FRONDOSE_CLAUDE_API_KEY);
const structured = id => id === 'codex' || id === 'claude' || isPiChat(id);
export function installWorkspaceAgentChats(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_agent_conversations'").get()) {
    const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
    if (file) { const backup = file + '.before-agent-chat-' + Date.now() + '.sqlite'; db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'"); chmodSync(backup, 0o600); }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS local_agent_conversations (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL, root_version TEXT NOT NULL, provider TEXT NOT NULL,
    title TEXT NOT NULL, native_session_id TEXT, revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_agent_turns (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES local_agent_conversations(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(conversation_id,request_id));
    CREATE INDEX IF NOT EXISTS local_agent_workspace ON local_agent_conversations(workspace_id,updated_at);
    CREATE TABLE IF NOT EXISTS local_workstation_leases (workspace_id TEXT PRIMARY KEY, root_version TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_automation_chat_sessions (automation_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL UNIQUE REFERENCES local_agent_conversations(id));
    UPDATE local_agent_turns SET status='interrupted',error='Frondose restarted. This turn was not automatically replayed.' WHERE status IN ('starting','running','needs-input');`);
}
export function createWorkspaceAgentChat({ db, roots, recordActivity, env = process.env, platform = process.platform, plan = createTerminalLaunchPlan, discover = detectTerminalProviders, spawnProcess = spawn, loadClaude = () => import('@anthropic-ai/claude-agent-sdk') } = {}) {
  installWorkspaceAgentChats(db);
  const active = new Map(), approvals = new Map(); let closed = false;
  const at = () => new Date().toISOString();
  const session = id => db.prepare('SELECT * FROM local_agent_conversations WHERE id=?').get(id);
  function authorized(row, workspaceId) { if (!row || row.workspace_id !== workspaceId) throw fail('This conversation is not in the selected workspace.', 404); return row; }
  function deleteConversation(row, revision) {
    if (revision !== row.revision) throw fail('This conversation changed in another view. Review it again before deleting.', 409);
    if (active.has(row.id)) throw fail('Stop the active turn and wait for it to finish before deleting this conversation.', 409);
    const hasSchedules = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_cli_automations'").get();
    const dedicated = db.prepare('SELECT automation_id FROM local_automation_chat_sessions WHERE conversation_id=?').get(row.id);
    if (hasSchedules && db.prepare(`SELECT 1 FROM local_cli_automations WHERE workspace_id=? AND deleted_at IS NULL
      AND (target_conversation_id=? OR id=?) LIMIT 1`).get(row.workspace_id, row.id, dedicated?.automation_id ?? null) || !hasSchedules && dedicated) {
      throw fail('This conversation belongs to an automation. Remove its link or delete the automation first.', 409);
    }
    // Remove only Frondose-owned local data. Do not touch the provider's CLI
    // session, unrelated conversations, workspace activity or run receipts.
    db.exec('SAVEPOINT frondose_delete_chat');
    try {
      db.prepare('DELETE FROM local_automation_chat_sessions WHERE conversation_id=?').run(row.id);
      if (!db.prepare('DELETE FROM local_agent_conversations WHERE id=? AND workspace_id=? AND revision=?').run(row.id, row.workspace_id, revision).changes) throw fail('This conversation changed in another view. Review it again before deleting.', 409);
      db.exec('RELEASE SAVEPOINT frondose_delete_chat');
      return { deleted: true, id: row.id };
    } catch (cause) {
      db.exec('ROLLBACK TO SAVEPOINT frondose_delete_chat; RELEASE SAVEPOINT frondose_delete_chat');
      throw cause;
    }
  }
  async function rootFor(workspaceId, actor, input, row) {
    const root = await roots.rootFor(workspaceId, actor, 'workbench.execute');
    if (input.expected_binding_version !== root.row.version || row && (row.root_version !== root.row.version || row.project_id !== root.row.project_id)) throw fail('This conversation belongs to a different directory binding. Start a new conversation.', 409);
    return root;
  }
  function present(row) {
    return { ...row, automation_managed:Boolean(db.prepare('SELECT 1 FROM local_automation_chat_sessions WHERE conversation_id=?').get(row.id)), turns: db.prepare('SELECT * FROM local_agent_turns WHERE conversation_id=? ORDER BY created_at,id LIMIT 200').all(row.id), approvals: [...approvals.values()].filter(a => a.conversationId === row.id).map(({ id, tool, input, createdAt, native }) => ({ id, tool, input, createdAt, native: native === true })) };
  }
  function persist(entry) {
    if (closed) return;
    db.prepare('UPDATE local_agent_turns SET response=?,status=?,error=?,updated_at=? WHERE id=?').run(entry.text.slice(0,100_000), entry.status, entry.error || null, at(), entry.turnId);
  }
  function append(entry, text) { entry.text += text; if (entry.text.length > 100_000) { entry.stop?.(); throw fail('Reply exceeded the 100,000-character limit.'); } }
  function trackChild(entry, child) {
    entry.child = child;
    child.once('close', () => {
      entry.childClosed = true;
      if (entry.settled && entry.status === 'needs-cleanup') {
        entry.status = entry.stopped ? 'stopped' : 'failed';
        entry.error = 'The provider exited after delayed cleanup. This turn was not replayed.';
        active.delete(entry.conversation.id);
        persist(entry);
      }
    });
    return child;
  }
  async function approval(entry, tool, input, native = false) {
    if (entry.stopped || entry.status === 'stopped') return false;
    if ([...approvals.values()].filter(a => a.entry === entry).length >= 8) return false;
    const id = randomUUID(); entry.status = 'needs-input'; persist(entry);
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(false), 120_000); timer.unref?.();
      const finish = allowed => { clearTimeout(timer); approvals.delete(id); if (!entry.stopped && !entry.settled) { entry.status = 'running'; persist(entry); } resolve(allowed); };
      approvals.set(id, { id, conversationId: entry.conversation.id, entry, tool, input: JSON.stringify(input).slice(0,30000), createdAt: at(), native, finish });
    });
  }
  async function runCodex(entry, launch, context) {
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(launch.command)) throw fail('Structured Chat requires a native executable on Windows. Use Terminal for this installation.');
    const automatic=entry.automation===true;
    const profile=automatic?'frondose-automation-'+entry.turnId:null;
    // The per-run name prevents an existing user-defined profile from merging
    // extra grants into this profile. Do not silently use a legacy sandbox:
    // the provider must echo the exact named profile before receiving a task.
    const guardArgs=automatic?['-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.hooks=false','-c','features.multi_agent=false','-c',`default_permissions="${profile}"`,'-c',`permissions.${profile}.filesystem={":root"="deny",":minimal"="read",${JSON.stringify(context.root)}="read"}`,'-c',`permissions.${profile}.network={enabled=false}`]:[];
    const child = spawnProcess(launch.command, ['app-server', '-c', 'mcp_servers={}', '-c', 'features.plugins=false', ...guardArgs], { cwd: context.root, env: launch.env, shell: false, detached: platform !== 'win32', stdio: ['pipe','pipe','pipe'], windowsHide: true });
    trackChild(entry, child);
    let threadId, turnId, earlyCompletion; const items = new Map(); let resolve, reject;
    const done = new Promise((yes,no) => { resolve = yes; reject = no; }); void done.catch(() => {});
    const complete = turn => { if (turn?.id !== turnId) return; if (turn.status === 'completed') resolve(); else reject(fail(turn.error?.message || 'The agent turn was interrupted.')); };
    const peer = createAgentJsonlPeer(child, {
      onFailure: reject,
      onRequest: async message => {
        if (automatic) return ['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(message.method) ? { result: { decision: 'decline' } } : { error: { code: -32601, message: 'Scheduled read-only work cannot request this capability.' } };
        if (message.method === 'item/tool/call' && message.params?.tool === COMPUTER_USE_TOOL.name && entry.computerEnabled) {
          try {
            const input=computerUseAction(typeof message.params.arguments==='string'?JSON.parse(message.params.arguments):message.params.arguments);
            const result=await approval(entry,'Computer Use',input,true);
            if(!result)return {result:{success:false,contentItems:[{type:'inputText',text:'The user denied this action or the request expired.'}]}};
            return {result:{success:true,contentItems:result.base64?[{type:'inputImage',imageUrl:'data:image/png;base64,'+result.base64}]:[{type:'inputText',text:JSON.stringify(result)}]}};
          }catch{return {result:{success:false,contentItems:[{type:'inputText',text:'The action was invalid or not authorized.'}]}};}
        }
        if (!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(message.method)) return { error: { code: -32601, message: 'This client capability is not granted.' } };
        const accepted = await approval(entry, message.method, message.params || {});
        return { result: { decision: accepted ? 'accept' : 'decline' } };
      },
      onNotification: message => {
        const p = message.params || {}; if (automatic ? !threadId || p.threadId !== threadId : p.threadId && threadId && p.threadId !== threadId) return;
        if (message.method === 'item/agentMessage/delta') append(entry, String(p.delta || ''));
        if (message.method === 'item/completed' && p.item?.type === 'agentMessage') { items.set(p.item.id, String(p.item.text || '')); entry.text = [...items.values()].join('\n').slice(0,100_000); }
        if (message.method === 'turn/completed') { if (!turnId) earlyCompletion = p.turn; else complete(p.turn); }
      },
    });
    entry.stop = () => { entry.stopped = true; if (threadId && turnId) void peer.request('turn/interrupt', { threadId, turnId }, 1000).catch(() => {}); peer.dispose(); terminateAgentProcess(child); reject(fail('Stopped by user.')); };
    child.stderr.on('data', () => {});
    try {
      await peer.request('initialize', { clientInfo: { name: 'frondose', title: 'Frondose', version: '0.1.3' }, capabilities:{experimentalApi:true} }); peer.notify('initialized');
      const saved = entry.conversation.native_session_id;
      const approvalPolicy=automatic?'never':'on-request';
      const result = await peer.request(saved ? 'thread/resume' : 'thread/start', { ...(saved ? { threadId: saved } : {}), cwd: context.root, approvalPolicy, ...(automatic?{permissions:profile}:{sandbox:'read-only'}), ...(!saved&&!automatic ? {dynamicTools:[COMPUTER_USE_TOOL]} : {}) });
      threadId = result.thread?.id; if (!safeId(threadId)) throw fail('The provider returned an invalid conversation identity.');
      if((saved && threadId !== saved) || (automatic && !nativeSessionId(threadId)))throw fail('The provider did not load the exact reviewed native session.');
      if(automatic&&(result.activePermissionProfile?.id!==profile||result.cwd!==context.root||result.approvalPolicy!=='never'))throw fail('This Codex installation could not confirm the required scheduled read-only policy. No task was sent.');
      db.prepare('UPDATE local_agent_conversations SET native_session_id=? WHERE id=?').run(threadId, entry.conversation.id);
      if(automatic)await entry.beforeLaunch();
      if (entry.stopped) throw fail('Stopped before sending.');
      const resultTurn = await peer.request('turn/start', { threadId, input: [{ type: 'text', text: entry.prompt }], approvalPolicy, ...(automatic?{cwd:context.root,permissions:profile,environments:[]}:{}) }); turnId = resultTurn.turn?.id;
      if (!safeId(turnId)) throw fail('The provider returned an invalid turn identity.');
      if(automatic)entry.onDispatched();
      if (earlyCompletion) complete(earlyCompletion);
      await done;
    } finally { peer.dispose(); terminateAgentProcess(child); }
  }
  async function runClaude(entry, launch, context) {
    const key=env.FRONDOSE_CLAUDE_API_KEY;
    if(!claudeConfigured(env))throw fail('Structured Claude Chat requires an owner-configured FRONDOSE_CLAUDE_API_KEY. Use the unmodified Claude Code terminal or external app for its own sign-in.');
    const { query, createSdkMcpServer, tool } = await loadClaude(); if (entry.stopped) throw fail('Stopped before starting.');
    let mcpServers={};
    if(entry.computerEnabled){
      const {z}=await import('zod');
      const computer=tool('computer',COMPUTER_USE_TOOL.description,{operation:z.enum(['snapshot','press','set-value','scroll','screenshot']),snapshotId:z.string().optional(),index:z.number().int().optional(),text:z.string().max(20000).optional(),direction:z.enum(['up','down']).optional(),windowId:z.number().int().optional()},async input=>{
        // This second human gate is mandatory even after the SDK's ordinary
        // canUseTool approval. Enabling the feature never approves an action.
        const result=await approval(entry,'Computer Use',computerUseAction(input),true);
        return result?{content:result.base64?[{type:'image',mimeType:'image/png',data:result.base64}]:[{type:'text',text:JSON.stringify(result)}]}:{isError:true,content:[{type:'text',text:'The user denied the action or it expired.'}]};
      });
      mcpServers={frondose:{...createSdkMcpServer({name:'frondose',version:'1.0.0',tools:[computer]})}};
    }
    const controller = new AbortController();
    const run = query({ prompt: entry.prompt, options: {
      cwd: context.root, pathToClaudeCodeExecutable: launch.command, env: {...launch.env,ANTHROPIC_API_KEY:key,CLAUDE_CODE_OAUTH_TOKEN:'',ANTHROPIC_AUTH_TOKEN:''},
      permissionMode: 'default', settingSources: [], mcpServers, plugins: [],
      extraArgs: { 'strict-mcp-config': null }, includePartialMessages: true,
      tools: ['Read','Glob','Grep','Edit','Write','Bash'],
      settings: { disableAllHooks: true, permissions: { ask: ['Read','Glob','Grep','Edit','Write','Bash'] } },
      abortController: controller, ...(entry.conversation.native_session_id ? { resume: entry.conversation.native_session_id } : {}),
      spawnClaudeCodeProcess: options => {
        const child = spawnProcess(options.command, options.args, { cwd: options.cwd, env: options.env, shell: false, detached: platform !== 'win32', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
        return trackChild(entry, child);
      },
      canUseTool: async (tool, input) => await approval(entry, tool, input) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user did not approve this action.' },
    } });
    entry.stop = () => { entry.stopped = true; controller.abort(); run.close?.(); };
    let confirmed = false;
    for await (const message of run) {
      if (entry.stopped) break;
      if (message.session_id && safeId(message.session_id)) db.prepare('UPDATE local_agent_conversations SET native_session_id=? WHERE id=?').run(message.session_id, entry.conversation.id);
      if (message.type === 'stream_event' && message.event?.type === 'content_block_delta' && message.event.delta?.type === 'text_delta') append(entry, message.event.delta.text);
      if (message.type === 'result') {
        if (message.is_error || message.subtype !== 'success') throw fail(message.errors?.join('\n') || 'Claude did not complete this turn.');
        if (typeof message.result === 'string') entry.text = message.result.slice(0,100_000);
        confirmed = true;
      }
    }
    if (!entry.stopped && !confirmed) throw fail('Claude ended before confirming completion. This turn was not replayed.');
  }
  async function run(entry, context) {
    let timer, flush;
    try {
      timer = setTimeout(() => { entry.error = 'Execution reached its 20-minute limit.'; entry.stop?.(); }, 1_200_000); timer.unref?.();
      const launch = await plan({ providerId: entry.conversation.provider }, { platform, env });
      const fresh = await roots.rootFor(entry.conversation.workspace_id, entry.actor, 'workbench.execute');
      if (entry.stopped || fresh.row.version !== context.row.version) throw fail('The directory or session changed before launch.');
      if(entry.automation)await entry.beforeLaunch();
      entry.status = 'running'; persist(entry);
      flush = setInterval(() => { try { persist(entry); } catch { entry.stop?.(); } }, 400); flush.unref?.();
      if (entry.conversation.provider === 'codex') await runCodex(entry, launch, context);
      else if (entry.conversation.provider === 'claude') await runClaude(entry, launch, context);
      else if (isPiChat(entry.conversation.provider)) await runWorkspacePiChat({
        provider:entry.conversation.provider, launch, platform,cwd:context.root,prompt:entry.prompt,sessionFile:entry.conversation.native_session_id,
        start:(...options)=>trackChild(entry,spawnProcess(...options)),
        onStop:stop=>{entry.stop=()=>{entry.stopped=true;stop();};},
        onText:text=>append(entry,text),onSnapshot:text=>{entry.text=text.slice(0,100_000);},
        remember:file=>{if(!closed)db.prepare('UPDATE local_agent_conversations SET native_session_id=? WHERE id=?').run(file,entry.conversation.id);},
      });
      else throw fail('This agent is not supported in Chat.');
      entry.status = entry.stopped ? 'stopped' : 'completed';
    } catch (cause) { entry.status = entry.stopped ? 'stopped' : 'failed'; entry.error = entry.error || String(cause.message).slice(0,4000); }
    finally {
      clearTimeout(timer); clearInterval(flush);
      entry.settled = true;
      for (const a of [...approvals.values()]) if (a.entry === entry) a.finish(false);
      if (entry.child && !entry.childClosed) {
        terminateAgentProcess(entry.child);
        await new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref?.(); entry.child.once('close', () => { clearTimeout(timer); resolve(); }); });
      }
      if (entry.child && !entry.childClosed) { entry.status='needs-cleanup'; entry.error='Provider exit could not be confirmed. Directory changes and new turns remain blocked until cleanup is verified.'; }
      else active.delete(entry.conversation.id);
      persist(entry);
      if (!closed && ['completed', 'stopped', 'failed'].includes(entry.status)) recordActivity?.({ workspaceId: entry.conversation.workspace_id, entityId: entry.turnId, kind: 'chat.finished' });
      if(!closed&&entry.automation)entry.onFinished(entry.status);
    }
  }
  async function dispatch({ workspaceId, actor, action = '', method = 'GET', input = {}, query = new URLSearchParams() }) {
    await roots.get(workspaceId, actor);
    if (!action && method === 'GET') {
      const rows = db.prepare('SELECT * FROM local_agent_conversations WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 100').all(workspaceId);
      return { conversations: rows, conversation: query.get('id') ? present(authorized(session(query.get('id')), workspaceId)) : null, providers: (await discover({ platform, env })).filter(p => structured(p.id)).map(p=>({...p,structuredConfigured:p.installed&&(p.id!=='claude'||claudeConfigured(env)),computerUse:!isPiChat(p.id)})) };
    }
    if (method !== 'POST' || input.confirmed !== true || closed) throw fail('Confirm this exact conversation action.');
    if (action === 'create') {
      if (!structured(input.provider)) throw fail('Choose a supported Chat agent.');
      const context = await rootFor(workspaceId, actor, input), id = randomUUID(), stamp = at();
      db.prepare('INSERT INTO local_agent_conversations(id,workspace_id,project_id,root_version,provider,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, workspaceId, context.row.project_id, context.row.version, input.provider, (String(input.title || 'New conversation').trim() || 'New conversation').slice(0,150), stamp, stamp);
      return present(session(id));
    }
    let row = authorized(session(input.id), workspaceId);
    if (action === 'stop') { const entry = active.get(row.id); if (entry) { entry.stopped = true; entry.stop?.(); for (const a of [...approvals.values()]) if (a.entry === entry) a.finish(false); } return { stopping: Boolean(entry) }; }
    if (action === 'delete') return deleteConversation(row, input.revision);
    const context = await rootFor(workspaceId, actor, input, row);
    // Directory authorization is asynchronous. Refresh the row before checking
    // its optimistic revision or touching any conversation state.
    if (closed) throw fail('Frondose is closing. Nothing was sent.', 409);
    row = authorized(session(input.id), workspaceId);
    if (action === 'decision') {
      const a = approvals.get(input.approval_id); if (!a || a.conversationId !== row.id || !['allow','deny'].includes(input.decision)) throw fail('This approval is no longer pending.', 409);
      if(a.native && input.decision==='allow'){
        if(!input.result||typeof input.result!=='object'||Array.isArray(input.result)||JSON.stringify(input.result).length>17_000_000)throw fail('A bounded native result is required.');
        if(input.result.base64 && (input.result.mime!=='image/png'||!/^[A-Za-z0-9+/=]+$/.test(input.result.base64)||input.result.base64.length>16_000_000))throw fail('Invalid screenshot result.');
      }
      a.finish(input.decision === 'allow' ? a.native ? input.result : true : false); return { decided: true };
    }
    if (action !== 'send') throw fail('Unsupported conversation action.');
    if (db.prepare('SELECT 1 FROM local_automation_chat_sessions WHERE conversation_id=?').get(row.id)) throw fail('This conversation is managed by its automation. Start a separate Chat to send a manual message.',409);
    if (!safeId(input.request_id) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 24000 || input.prompt.includes('\0')) throw fail('Enter a prompt of up to 24,000 characters with a unique request identity.');
    const previous = db.prepare('SELECT * FROM local_agent_turns WHERE conversation_id=? AND request_id=?').get(row.id,input.request_id);
    if (previous) { if (previous.prompt !== input.prompt) throw fail('This request identity belongs to another prompt.',409); return present(row); }
    if (active.has(row.id) || [...active.values()].some(e => e.conversation.workspace_id === workspaceId) || active.size >= 8) throw fail('Wait for or stop the active conversation before sending another turn.',409);
    if (input.revision !== row.revision) throw fail('This conversation changed in another view. Refresh before sending.',409);
    if (db.prepare('SELECT count(*) AS n FROM local_agent_turns WHERE conversation_id=?').get(row.id).n >= 200) throw fail('This conversation reached its local turn limit. Start a new one.');
    const turnId = randomUUID(), stamp = at();
    db.prepare('INSERT INTO local_agent_turns(id,conversation_id,request_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(turnId,row.id,input.request_id,input.prompt,'starting',stamp,stamp);
    db.prepare('UPDATE local_agent_conversations SET revision=revision+1,updated_at=? WHERE id=?').run(stamp,row.id);
    const entry = { conversation: row, prompt: input.prompt, turnId, actor, text: '', status: 'starting', stopped: false, computerEnabled: !isPiChat(row.provider)&&input.computer_enabled===true };
    active.set(row.id,entry);
    recordActivity?.({ workspaceId, entityId: turnId, kind: 'chat.started' });
    void run(entry,context); return present(session(row.id));
  }
  function automationTargets({workspaceId,projectId,bindingVersion,actor}) {
    if (actor?.id!=='local-owner'||closed) throw fail('Local owner access is required.',403);
    return db.prepare(`SELECT c.id,c.title,c.native_session_id FROM local_agent_conversations c
      WHERE c.workspace_id=? AND c.project_id=? AND c.root_version=? AND c.provider='codex'
        AND c.native_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM local_automation_chat_sessions s WHERE s.conversation_id=c.id)
        AND (SELECT t.status FROM local_agent_turns t WHERE t.conversation_id=c.id ORDER BY t.rowid DESC LIMIT 1)='completed'
      ORDER BY c.updated_at DESC LIMIT 100`).all(workspaceId,projectId,bindingVersion).filter(row=>nativeSessionId(row.native_session_id)&&!active.has(row.id));
  }
  async function startAutomationTurn({workspaceId,projectId,bindingVersion,actor,runId,automationId,mode,targetId,expectedSessionId,title,prompt,beforeLaunch,onDispatched,onFinished}) {
    if(actor?.id!=='local-owner'||closed||!nativeSessionId(runId)||!nativeSessionId(automationId)||!['existing','dedicated'].includes(mode)||typeof beforeLaunch!=='function'||typeof onDispatched!=='function'||typeof onFinished!=='function'||typeof prompt!=='string'||!prompt.trim()||prompt.length>24000||prompt.includes('\0'))throw fail('Invalid reviewed automation turn.');
    const context=await rootFor(workspaceId,actor,{expected_binding_version:bindingVersion});
    const reserved=db.prepare(`SELECT a.session_mode,a.target_conversation_id,a.target_session_id FROM local_cli_automation_runs r
      JOIN local_cli_automations a ON a.id=r.automation_id AND a.workspace_id=r.workspace_id
      WHERE r.id=? AND r.automation_id=? AND r.workspace_id=? AND r.status='preparing' AND r.due_key NOT LIKE 'manual:%'
        AND a.project_id=? AND a.binding_version=? AND a.provider_id='codex'`).get(runId,automationId,workspaceId,projectId,bindingVersion);
    if(!reserved||context.row.project_id!==projectId||reserved.session_mode!==mode||reserved.target_conversation_id!==targetId||reserved.target_session_id!==expectedSessionId)throw fail('No current scheduled receipt for this conversation.',409);
    if([...active.values()].some(entry=>entry.conversation.workspace_id===workspaceId)||active.size>=8)throw fail('This workspace has active Chat work. Nothing was sent.',409);
    let row;
    const stamp=at();
    db.exec('SAVEPOINT frondose_automation_chat');
    try {
      if(mode==='existing'){
        const selected=automationTargets({workspaceId,projectId,bindingVersion,actor}).find(item=>item.id===targetId);
        if(!selected||selected.native_session_id!==expectedSessionId)throw fail('The exact reviewed Codex conversation is no longer available.',409);
        row=session(selected.id);
      } else {
        const managed=db.prepare('SELECT conversation_id FROM local_automation_chat_sessions WHERE automation_id=?').get(automationId);
        if(managed){
          row=session(managed.conversation_id);
          const last=row&&db.prepare('SELECT status FROM local_agent_turns WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1').get(row.id);
          if(!row||row.workspace_id!==workspaceId||row.project_id!==projectId||row.root_version!==bindingVersion||row.provider!=='codex'||!nativeSessionId(row.native_session_id)||last?.status!=='completed')throw fail('The dedicated Codex session cannot be verified. Nothing was sent.',409);
        }else{
          const conversationId=randomUUID();
          db.prepare('INSERT INTO local_agent_conversations(id,workspace_id,project_id,root_version,provider,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(conversationId,workspaceId,projectId,bindingVersion,'codex',('Automation: '+title).slice(0,150),stamp,stamp);
          db.prepare('INSERT INTO local_automation_chat_sessions VALUES (?,?)').run(automationId,conversationId);
          row=session(conversationId);
        }
      }
      if(db.prepare('SELECT count(*) AS n FROM local_agent_turns WHERE conversation_id=?').get(row.id).n>=200)throw fail('This Chat reached its local turn limit.',409);
      db.prepare('INSERT INTO local_agent_turns(id,conversation_id,request_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(runId,row.id,'automation_'+runId,prompt,'starting',stamp,stamp);
      db.prepare('UPDATE local_agent_conversations SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(stamp,row.id,row.revision);
      db.exec('RELEASE SAVEPOINT frondose_automation_chat');
    }catch(cause){db.exec('ROLLBACK TO SAVEPOINT frondose_automation_chat; RELEASE SAVEPOINT frondose_automation_chat');throw cause;}
    const entry={conversation:row,prompt,turnId:runId,actor,text:'',status:'starting',stopped:false,automation:true,computerEnabled:false,beforeLaunch,onDispatched,onFinished};
    active.set(row.id,entry);
    void run(entry,context);
    return {conversationId:row.id};
  }
  function activeSessionsFor(resource,id) { return [...active.values()].filter(e => resource === 'workspaces' ? e.conversation.workspace_id === id : resource === 'projects' && e.conversation.project_id === id).map(e => ({ id:e.turnId,status:e.status })); }
  function close() { for (const entry of active.values()) { entry.status='interrupted'; entry.error='Frondose closed. This turn was not replayed.'; persist(entry); } closed = true; for (const entry of active.values()) { entry.stopped = true; entry.stop?.(); } for (const a of [...approvals.values()]) a.finish(false); }
  return { dispatch, activeSessionsFor, automationTargets, startAutomationTurn, close, desktopTurns: () => [...active.values()].map(({ turnId, status }) => ({ id: turnId, status })) };
}
