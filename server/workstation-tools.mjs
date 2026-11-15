import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { resolveRunnerExecutable } from './runner-process.mjs';
import { terminalDiscoveryEnvironment } from './terminal-install-discovery.mjs';

const execute = promisify(execFile);
const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode, code: 'workstation_tools_error' });
const comingSoon = () => Object.assign(Error('Emulators and development environments are coming soon.'), { statusCode: 409, code: 'coming_soon' });
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) && !value.startsWith('-');
export const environmentName = workspaceId => 'frondose-' + createHash('sha256').update(workspaceId).digest('hex').slice(0, 20);
export function environmentImage(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[a-z0-9][a-z0-9./_-]*(?::[a-zA-Z0-9_.-]+)?(?:@sha256:[a-f0-9]{64})?$/.test(value)) throw fail('Enter a container image name, not a command or URL.');
  return value;
}
/** Fixed host commands only. No command is run by capability discovery. */
export function createWorkstationTools({ roots, db, platform = process.platform, env = process.env, resolveExecutable = resolveRunnerExecutable, run = execute, spawnProcess = spawn } = {}) {
  const locks = new Set(), ownedDevices = new Map();
  const android = new Map();
  const leases = new Map(db ? db.prepare('SELECT * FROM local_workstation_leases').all().map(row => [row.workspace_id,row]) : []);
  function lease(workspaceId, version, status) { const row={workspace_id:workspaceId,root_version:version,status}; leases.set(workspaceId,row); db?.prepare('INSERT INTO local_workstation_leases VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET root_version=excluded.root_version,status=excluded.status').run(workspaceId,version,status); }
  function forgetLease(workspaceId) { leases.delete(workspaceId); db?.prepare('DELETE FROM local_workstation_leases WHERE workspace_id=?').run(workspaceId); }
  async function executable(name) {
    const discovered = await terminalDiscoveryEnvironment({ platform, env });
    let found = await resolveExecutable(name, { platform, env: discovered });
    if(!found&&['adb','emulator'].includes(name)){
      const home=env.HOME||env.USERPROFILE;
      const candidates=[env.ANDROID_HOME,env.ANDROID_SDK_ROOT,...(home&&isAbsolute(home)?[platform==='darwin'?join(home,'Library/Android/sdk'):join(home,'Android/Sdk')]:[])].filter(root=>typeof root==='string'&&isAbsolute(root));
      for(const root of candidates){found=await resolveExecutable(join(root,name==='adb'?'platform-tools':'emulator',name+(platform==='win32'?'.exe':'')),{platform,env:discovered});if(found)break;}
    }
    if (!found || found.kind !== 'native') throw fail(`${name} is not installed or is not an executable tool on this host.`, 409);
    return found.path;
  }
  async function command(name, args, options = {}) {
    const path = await executable(name);
    try {
      let commandEnv=env;
      if(name==='docker'){
        const probe=await run(path,['context','inspect','--format','{{json .Endpoints.docker.Host}}'],{env,shell:false,windowsHide:true,timeout:5000,maxBuffer:64000,encoding:'utf8'});
        const endpoint=JSON.parse(probe.stdout);
        if(typeof endpoint!=='string'||!(/^(?:unix:\/\/\/[^\0\r\n]+|npipe:\/\/[^\0\r\n]+)$/.test(endpoint)))throw fail('Choose a Docker context using a local Unix socket or named pipe. Remote Docker endpoints are not permitted.');
        commandEnv={...env};delete commandEnv.DOCKER_HOST;delete commandEnv.DOCKER_CONTEXT;
        args=['--host',endpoint,...args];
      }
      return await run(path, args, { env:commandEnv, shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000, encoding: 'utf8', ...options });
    }
    catch (cause) { throw fail(String(cause.stderr || cause.message || 'The tool failed.').slice(0, 2000), 409); }
  }
  async function capability(name, supported = true) {
    if (!supported) return { state: 'unsupported', message: 'Unavailable on this platform.' };
    try { await executable(name); return { state: 'available', message: 'Executable found; runtime readiness is checked when used.' }; }
    catch { return { state: 'setup-required', message: `Install and configure ${name} separately, then refresh.` }; }
  }
  async function inspectContainer(workspaceId, rootVersion) {
    const result = await command('docker', ['container', 'inspect', environmentName(workspaceId)]);
    const item = JSON.parse(result.stdout)?.[0], labels = item?.Config?.Labels;
    if (!item || labels?.['app.frondose.workspace'] !== workspaceId || labels?.['app.frondose.root-version'] !== rootVersion || !/^[a-f0-9]{64}$/.test(item.Id)) throw fail('This container is not owned by this workspace and directory version.', 409);
    return item;
  }
  async function dispatch({ workspaceId, actor, action = '', input = {}, method = 'GET' }, release = false) {
    // roots.get checks the local owner and active workspace, including unbound workspaces.
    await roots.get(workspaceId, actor);
    if (release) {
      if (!action && method === 'GET') {
        const state = {state:'coming-soon',message:'Coming Soon'};
        return {platform,environment:state,ios:state,android:state,androidEmulator:state};
      }
      // A prior build's owned container can be inspected, stopped, or removed.
      // No discovery, launch, command, capture, tap or arbitrary cleanup in release mode.
      if (['environment/status','environment/stop','environment/remove'].includes(action)) {
        if (!leases.has(workspaceId) || leases.get(workspaceId).root_version !== input.expected_binding_version) throw comingSoon();
      } else if (action === 'devices/stop') {
        if (!ownedDevices.get(workspaceId)?.has(input.device_id) && !android.get(workspaceId)?.has(input.device_id)) throw comingSoon();
      } else throw comingSoon();
    }
    if (!action && method === 'GET') return { platform, environment: await capability('docker'), ios: await capability('xcrun', platform === 'darwin'), android: await capability('adb'), androidEmulator: await capability('emulator') };
    if (method !== 'POST') throw fail('Use an explicit action for this tool.', 405);
    if (input.confirmed !== true) throw fail('Confirm this exact tool action.');
    if (locks.has(workspaceId)) throw fail('Another tool operation is in progress. Wait before trying again.', 409);
    locks.add(workspaceId);
    try {
      return await roots.withBoundRoot(workspaceId, actor, 'workbench.execute', async context => {
        if (input.expected_binding_version !== context.row.version) throw fail('The workspace directory changed. Reopen this tool.', 409);
        const rootVersion = context.row.version;
        if (action === 'environment/status') {
          let c;
          try { c = await inspectContainer(workspaceId, rootVersion); }
          catch(cause) {
            // Only an exact local-daemon absence report can release an
            // uncertain creation lease. Connectivity/ownership failures cannot.
            const missing = new RegExp('^(?:Error response from daemon: )?No such (?:container|object): '+environmentName(workspaceId)+'\\s*$', 'i');
            if(!missing.test(cause.message)) throw cause;
            forgetLease(workspaceId); return { exists:false, running:false, name:environmentName(workspaceId) };
          }
          lease(workspaceId,rootVersion,c.State?.Running ? 'running' : 'stopped');
          return { id: c.Id, name: environmentName(workspaceId), running: c.State?.Running === true, image: c.Config.Image };
        }
        if (action === 'environment/create') {
          const image = environmentImage(input.image || 'alpine:3.22');
          if (/[,:\r\n]/.test(context.root)) throw fail('This directory name is unsupported by the container mount format.');
          await command('docker', ['image', 'inspect', image]); // Never implicitly pull an image.
          const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
          lease(workspaceId,rootVersion,'uncertain');
          await command('docker', ['create', '--name', environmentName(workspaceId), '--label', 'app.frondose.workspace=' + workspaceId, '--label', 'app.frondose.root-version=' + rootVersion, '--user', `${uid}:${gid}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--network', 'none', '--pids-limit', '256', '--memory', '2g', '--cpus', '2', '--read-only', '--no-healthcheck', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m', '--mount', `type=bind,src=${context.root},dst=/workspace`, '--workdir', '/workspace', '--entrypoint', '/bin/sh', image, '-c', 'sleep infinity']);
          lease(workspaceId,rootVersion,'stopped'); return { created: true, name: environmentName(workspaceId) };
        }
        if (action.startsWith('environment/')) {
          const c = await inspectContainer(workspaceId, rootVersion);
          if (action === 'environment/start') { lease(workspaceId,rootVersion,'uncertain'); await command('docker', ['start', c.Id]); lease(workspaceId,rootVersion,'running'); return { started: true }; }
          if (action === 'environment/stop') { lease(workspaceId,rootVersion,'uncertain'); await command('docker', ['stop', '--time', '10', c.Id]); lease(workspaceId,rootVersion,'stopped'); return { stopped: true }; }
          if (action === 'environment/remove') { if(c.State?.Running)throw fail('Stop this environment before removing it.'); await command('docker',['rm',c.Id]); forgetLease(workspaceId); return {removed:true}; }
          if (action === 'environment/logs') return { text: (await command('docker', ['logs', '--tail', '200', c.Id])).stdout };
          if (action === 'environment/exec') {
            if(!c.State?.Running||c.ExecIDs?.length)throw fail('Start this container and wait for its current commands to finish, or explicitly stop it.');
            if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 10_000 || input.command.includes('\0')) throw fail('Enter a command of up to 10,000 characters.');
            return { text: (await command('docker', ['exec', c.Id, '/bin/sh', '-lc', input.command])).stdout };
          }
        }
        if (action === 'devices/list') {
          const devices = []; const errors = [];
          if (platform === 'darwin') try {
            const result = JSON.parse((await command('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])).stdout);
            for (const [runtime, rows] of Object.entries(result.devices || {})) for (const device of rows) if (device.isAvailable) devices.push({ id: device.udid, name: device.name, runtime, platform: 'ios', running: device.state === 'Booted', owned: ownedDevices.get(workspaceId)?.has(device.udid) || false });
          } catch (cause) { errors.push(cause.message); }
          try {
            const result = (await command('adb', ['devices', '-l'])).stdout;
            for (const line of result.split(/\r?\n/).slice(1)) {
              const [serial, state, ...details] = line.trim().split(/\s+/);
              if (serial && state === 'device' && id(serial)) devices.push({ id: serial, name: details.join(' ') || serial, platform: 'android', running: true, owned: android.get(workspaceId)?.has(serial)||false });
            }
          } catch (cause) { errors.push(cause.message); }
          try{const avds=(await command('emulator',['-list-avds'])).stdout.split(/\r?\n/).map(name=>name.trim()).filter(name=>/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(name));for(const avd of avds.slice(0,50))devices.push({id:'avd:'+avd,avd,name:avd,platform:'android',running:false,owned:false});}catch(cause){errors.push(cause.message);}
          return { devices: devices.slice(0, 100), errors };
        }
        if(action==='devices/boot-android'){
          if(typeof input.avd!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(input.avd))throw fail('Choose an existing Android virtual device.');
          const available=(await command('emulator',['-list-avds'])).stdout.split(/\r?\n/).map(name=>name.trim());if(!available.includes(input.avd))throw fail('This Android virtual device is no longer configured.');
          if([...android.values()].reduce((n,rows)=>n+rows.size,0)>=4)throw fail('Stop an owned Android emulator before starting another.');
          let port;
          for(let candidate=5554;candidate<=5584;candidate+=2){const free=await new Promise(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(candidate,'127.0.0.1',()=>server.close(()=>resolve(true)));});if(free){port=candidate;break;}}
          if(!port)throw fail('No free Android emulator console port is available.');
          const executablePath=await executable('emulator'),serial='emulator-'+port;
          const child=spawnProcess(executablePath,['-avd',input.avd,'-port',String(port),'-no-snapshot-save'],{env,shell:false,detached:platform!=='win32',windowsHide:true,stdio:'ignore'});
          if(!android.has(workspaceId))android.set(workspaceId,new Map());
          android.get(workspaceId).set(serial,child);
          child.once('close',()=>android.get(workspaceId)?.delete(serial));
          await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',cause=>{android.get(workspaceId)?.delete(serial);no(fail(cause.message));});});
          return {booting:true,serial,message:'The emulator process started. Find devices again after Android has booted.'};
        }
        if (!id(input.device_id) || !['ios', 'android'].includes(input.device_platform)) throw fail('Choose a currently available device.');
        const device = input.device_id, ios = input.device_platform === 'ios';
        if (ios && (platform !== 'darwin' || !/^[a-f0-9-]{36}$/i.test(device))) throw fail('Choose an iOS simulator on macOS.');
        if (action === 'devices/boot' && ios) {
          const inventory = JSON.parse((await command('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])).stdout);
          const row = Object.values(inventory.devices || {}).flat().find(row => row.udid === device && row.isAvailable);
          if (!row) throw fail('This simulator is no longer available.');
          if (row.state === 'Booted') return { booted: true, owned: ownedDevices.get(workspaceId)?.has(device) || false };
          await command('xcrun', ['simctl', 'boot', device]);
          if (!ownedDevices.has(workspaceId)) ownedDevices.set(workspaceId, new Set());
          ownedDevices.get(workspaceId).add(device); return { booted: true, owned: true };
        }
        if (action === 'devices/stop' && ios) {
          if (!ownedDevices.get(workspaceId)?.has(device)) throw fail('Only simulators started here can be stopped here.');
          await command('xcrun', ['simctl', 'shutdown', device]); ownedDevices.get(workspaceId).delete(device); return { stopped: true };
        }
        if(action==='devices/stop'&&!ios){
          const child=android.get(workspaceId)?.get(device);if(!child)throw fail('Only an Android emulator started here can be stopped here.');
          if(platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');
          await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(fail('Emulator exit is unconfirmed. Its ownership is retained.')),5000);timer.unref?.();child.once('close',()=>{clearTimeout(timer);resolve();});});
          return {stopped:true};
        }
        if (action === 'devices/screenshot') {
          const result = ios ? await command('xcrun', ['simctl', 'io', device, 'screenshot', '-'], { encoding: 'buffer', maxBuffer: 12_000_000 }) : await command('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 12_000_000 });
          const bytes = Buffer.from(result.stdout);
          if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw fail('The device returned an invalid screenshot.');
          return { base64: bytes.toString('base64'), mime: 'image/png' };
        }
        if (action === 'devices/tap' && !ios) {
          if (![input.x, input.y].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 16384)) throw fail('Choose valid device coordinates.');
          await command('adb', ['-s', device, 'shell', 'input', 'tap', String(input.x), String(input.y)]); return { tapped: true };
        }
        throw fail('This operation is not supported by the selected backend.');
      });
    } finally { locks.delete(workspaceId); }
  }
  function activeSessionsFor(resource,id) { return [...leases.values()].filter(row => row.status!=='stopped' && (resource==='workspaces' ? row.workspace_id===id : resource==='projects' && roots.binding?.(row.workspace_id)?.project_id===id)).map(row=>({id:environmentName(row.workspace_id),status:row.status})); }
  return { dispatch, releaseDispatch: request => dispatch(request, true), activeSessionsFor };
}
