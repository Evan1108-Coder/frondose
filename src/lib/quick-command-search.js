// Adapted from Orca terminal-quick-command-search.ts (MIT), pinned in NOTICE.
const normalizedBodies=new WeakMap();
const normalize=value=>String(value||'').replace(/\s+/gu,' ').trim().toLowerCase();
function score(query,candidate,base){if(!candidate)return Infinity;if(candidate===query)return base;if(candidate.startsWith(query))return base+50;const word=candidate.indexOf(' '+query);if(word!==-1)return base+100+word;const part=candidate.indexOf(query);return part===-1?Infinity:base+200+part;}
export function searchQuickCommands(commands,rawQuery){
 if(new TextEncoder().encode(rawQuery).length>2048)return [];
 const query=normalize(rawQuery);if(!query)return [...commands];
 return commands.map((command,index)=>{let body=normalizedBodies.get(command);if(body===undefined){body=normalize(command.command);normalizedBodies.set(command,body);}return{command,index,score:Math.min(score(query,normalize(command.name),0),score(query,body,400))};}).filter(item=>Number.isFinite(item.score)).sort((a,b)=>a.score-b.score||a.index-b.index).map(item=>item.command);
}
