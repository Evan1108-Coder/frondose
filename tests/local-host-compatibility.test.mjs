import test from 'node:test';
import assert from 'node:assert/strict';
import {localHostUpgradeProblem} from '../src/lib/local-host-compatibility.js';
import {apiRequest} from '../src/data/api.js';

test('old feature namespaces explain required activation without inventing a successful API',()=>{
 for(const name of ['file-comments','local-automations','repository-work']){
  const problem=localHostUpgradeProblem('/api/'+name+'/threads?workspace_id=w',{status:404,message:'Unknown API route: /'+name});
  assert.equal(problem.code,'local_host_upgrade_required');assert.match(problem.message,/updated local server/);assert.match(problem.message,/no terminal was stopped automatically/);
 }
});
test('missing files, authentication failures and genuinely unknown routes are not disguised as upgrades',()=>{
 for(const [path,error] of [['/api/file-comments',{status:404,message:'File not found'}],['/api/file-comments',{status:403,message:'Unknown API route: /file-comments'}],['/api/typo',{status:404,message:'Unknown API route: /typo'}],['/api/tasks',{status:404,message:'Unknown API route: /tasks'}]])assert.equal(localHostUpgradeProblem(path,error),null);
});
test('API wrapper preserves failure status and offers a capability-specific recovery message',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Unknown API route: /file-comments',code:'not_found'}}),{status:404,headers:{'content-type':'application/json'}});
  await assert.rejects(apiRequest('/api/file-comments?workspace_id=w'),error=>error.status===404&&error.code==='local_host_upgrade_required'&&!error.message.includes('Unknown API route'));
  await assert.rejects(apiRequest('/api/unrecognized'),error=>error.status===404&&error.code==='not_found');
 }finally{globalThis.fetch=original;}
});
