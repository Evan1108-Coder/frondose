'use strict';
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
function parseListeners(source, platform = process.platform) {
  const rows = [], seen = new Set(); let pid = null, name = '';
  const add = (port, owner, command) => { port = Number(port); owner = Number(owner); if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(owner) || owner < 1 || rows.length >= 200) return; const key = `${owner}:${port}`; if (!seen.has(key)) { seen.add(key); rows.push({ port, pid: owner, name: String(command || 'Process').replace(/[\x00-\x1f]/g, '').slice(0, 80) }); } };
  if (platform === 'win32') { let data; try { data = JSON.parse(source); } catch { throw Error('Windows returned an unreadable listener list.'); } for (const item of Array.isArray(data) ? data : data ? [data] : []) add(item.LocalPort, item.OwningProcess, 'Process'); }
  else if (platform === 'linux') { for (const line of source.split('\n')) { const match = /\b(\S+):(\d+)\s+\S+\s+users:\(\("([^"]+)",pid=(\d+)/.exec(line); if (match) add(match[2], match[4], match[3]); } }
  else for (const line of source.split('\n')) { if (line[0] === 'p') pid = line.slice(1); if (line[0] === 'c') name = line.slice(1); if (line[0] === 'n') { const match = /:(\d+)$/.exec(line); if (match) add(match[1], pid, name); } }
  return rows.sort((a, b) => a.port - b.port || a.pid - b.pid);
}
async function runtimeStatus({ app, ports = false, platform = process.platform, run = exec }) {
  if (!ports) return { scope: 'Frondose desktop processes', totalMemory: os.totalmem(), freeMemory: os.freemem(), processes: app.getAppMetrics().slice(0, 100).map(item => ({ pid: item.pid, type: item.type, cpuPercent: Math.max(0, Number(item.cpu?.percentCPUUsage) || 0), memoryMiB: Math.max(0, Number(item.memory?.workingSetSize) || 0) / 1024 })) };
  const plan = platform === 'darwin' ? ['/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']] : platform === 'win32' ? [process.env.SystemRoot ? require('node:path').win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-NetTCPConnection -State Listen | Select-Object -First 200 LocalPort,OwningProcess | ConvertTo-Json -Compress']] : ['/usr/bin/ss', ['-ltnpH']];
  try { const result = await run(plan[0], plan[1], { timeout: 4000, maxBuffer: 262144, windowsHide: true, shell: false }); return { scope: 'System TCP listeners — not workspace-scoped', listeners: parseListeners(result.stdout, platform) }; } catch { throw Error('TCP listener discovery is unavailable on this computer. No process was changed.'); }
}
module.exports = { runtimeStatus, parseListeners };
