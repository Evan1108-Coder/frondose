import path from 'node:path';
import {validationError} from './validation.mjs';
/** Command customization follows Orca's executable + argv separation. No shell
 * parser, environment overrides, auto-install or permission presets are copied. */
export function cliCommandPreferences(input,catalog,platform=process.platform){
  if(!input||typeof input!=='object'||Array.isArray(input))throw validationError('Choose CLI command settings.');
  const allowed=new Set(catalog.map(row=>row.id)),entries=Object.entries(input);
  if(entries.length>catalog.length)throw validationError('Too many CLI overrides.');
  const result={};
  for(const [id,value]of entries){
    if(!allowed.has(id)||!value||typeof value!=='object')throw validationError('Choose a catalog CLI.');
    const executable=value.executable,api=platform==='win32'?path.win32:path.posix;
    if(typeof executable!=='string'||!executable||executable!==executable.trim()||executable.length>4096||/[\0\r\n]/.test(executable)||!api.isAbsolute(executable)&&!/^[A-Za-z0-9_.-]+$/.test(executable))throw validationError('Use an absolute executable path or one command name, not a shell command.');
    if(!Array.isArray(value.args)||value.args.length>24||value.args.some(arg=>typeof arg!=='string'||arg.length>1000||/[\0\r\n]/.test(arg)))throw validationError('Use at most 24 separate launch arguments.');
    result[id]={executable,args:[...value.args]};
  }
  return result;
}
