// Window normalization adapted from Orca (Lovecast Inc., MIT), revision
// 00de405c5c0cffea06c2beb6eb0a0038b5d53fe6. See third-party/orca/NOTICE.md.
// Unlike legacy positional fallback, unknown durations retain their real label.
export function quotaWindowLabel(minutes){if(Math.abs(minutes-300)<=1)return '5h';if(Math.abs(minutes-10080)<=1)return '7d';if(minutes%1440===0)return (minutes/1440)+'d';if(minutes%60===0)return (minutes/60)+'h';return minutes+'m';}
export function normalizeCodexQuota(result,now=Date.now()){
 const multi=result?.rateLimitsByLimitId;
 const raw=multi&&typeof multi==='object'&&!Array.isArray(multi)&&Object.hasOwn(multi,'codex')?multi.codex:(!result?.rateLimits?.limitId||result.rateLimits.limitId==='codex')?result?.rateLimits:null;
 const windows=[];
 for(const key of['primary','secondary']){const value=raw?.[key];if(!value||typeof value.usedPercent!=='number'||!Number.isFinite(value.usedPercent)||typeof value.windowDurationMins!=='number'||!Number.isFinite(value.windowDurationMins)||value.windowDurationMins<=0||value.windowDurationMins>525600)continue;
  const minutes=Math.abs(value.windowDurationMins-300)<=1?300:Math.abs(value.windowDurationMins-10080)<=1?10080:value.windowDurationMins;
  const reset=typeof value.resetsAt==='number'&&Number.isFinite(value.resetsAt)&&value.resetsAt>0&&value.resetsAt<8640000000000?value.resetsAt*1000:null;
  windows.push({id:key,usedPercent:Math.min(100,Math.max(0,value.usedPercent)),minutes,label:quotaWindowLabel(minutes),resetsAt:reset,expired:reset!==null&&reset<=now});
 }
 windows.sort((a,b)=>a.minutes-b.minutes);
 return {provider:'codex',status:windows.length?'ready':'unavailable',windows,updatedAt:now,message:windows.length?null:'Codex did not return subscription quota windows for this account.'};
}

// Keep the protocol's usedPercent canonical; convert only for presentation.
export function quotaDisplayPercent(usedPercent,display='remaining') {
 if(typeof usedPercent!=='number'||!Number.isFinite(usedPercent))return null;
 const used=Math.min(100,Math.max(0,usedPercent));
 return Math.round(display==='used'?used:100-used);
}
