import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOC_GROUPS, DOC_ARTICLES } from '../src/lib/docs-content.js';
import { localDocsCatalog } from '../src/lib/local-docs-catalog.js';
import { articleText } from '../src/lib/docs-utils.js';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'), require=createRequire(import.meta.url);
const bundle=buildSync({stdin:{contents:`export {GitHubSettings} from './src/views/settings/GitHubSettings.jsx';export {LocalBranchCards} from './src/components/workspace/GitRepositoryBar.jsx';export {AppContext} from './src/app-context.js';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom'],loader:{'.css':'empty'}});
const loaded={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(loaded,loaded.exports,require);
test('GitHub Settings compiles, renders inert loading state and never probes a provider while rendering',()=>{
  const before=globalThis.fetch; let calls=0;globalThis.fetch=()=>{++calls;throw Error('No rendering requests');};
  try {const html=renderToStaticMarkup(React.createElement(loaded.exports.AppContext.Provider,{value:{workspace:{id:'fixture'},data:{projects:[],teams:[]}}},React.createElement(loaded.exports.GitHubSettings)));assert.match(html,/<h1>GitHub<\/h1>/);assert.match(html,/Reading local repository connection/);assert.equal(calls,0);}finally{globalThis.fetch=before;}
});
test('settings gate save/sync by current connection, dirty state and binding/repository/config revisions',()=>{
  const code=source('src/views/settings/GitHubSettings.jsx');
  assert.match(code,/key=\{workspace.id\}/);assert.match(code,/useUnsavedUpdate\(dirty, busy\)/);assert.match(code,/requests.current\) controller.abort\(\)/);assert.match(code,/epoch.current === generation/);
  assert.match(code,/busy \|\| !value\?\.connected/);assert.match(code,/expected_revision: value.config\?\.revision/);assert.match(code,/expected_binding_version: value.bindingVersion/);assert.match(code,/expected_repository: value.repository\?\.slug/);
  assert.match(code,/value.status.state === 'suspended'/);assert.match(code,/running Frondose backend does not include/);assert.match(code,/Keep active terminal sessions running/);assert.match(code,/Use Recheck to retry/);
});
test('compact branch cards show actual commits and no invented stats, with radio keyboard access and footer disconnect',()=>{
  const state={branch:'main',branches:['feature','main'],dirty:false,changes:{changed:0},branchDetails:[{name:'main',shortCommit:'abc12345',subject:'Real fixture subject',committedAt:'2026-10-28T10:00:00Z',tracking:null},{name:'feature',shortCommit:'def12345',subject:'Feature work',committedAt:null,tracking:{ahead:2,behind:1}}]};
  const html=renderToStaticMarkup(React.createElement(loaded.exports.LocalBranchCards,{state,selected:'main',onSelect(){}}));
  assert.match(html,/role="radiogroup"/);assert.match(html,/role="radio" aria-checked="true"/);assert.match(html,/Real fixture subject/);assert.match(html,/abc12345/);assert.match(html,/2 ahead/);assert.match(html,/Current/);
  assert(html.indexOf('>main<')<html.indexOf('>feature<'));assert.doesNotMatch(html,/total commits|pull requests|recent activity/i);
  const code=source('src/components/workspace/GitRepositoryBar.jsx');assert.doesNotMatch(code,/<Field label="Branch"/);assert.match(code,/ArrowDown/);assert.match(code,/onBranchChanged\?\.\(result, \{ previousBranch: snapshot.branch \}\)/);assert.match(code,/<footer[^>]*>[\s\S]*git-repository-disconnect/);
  const css=source('src/components/workspace/git-repository.css');assert.match(css,/minmax\(min\(240px,100%\),1fr\)/);assert.match(css,/max-height:360px; overflow:auto/);
});
test('in-app guide and local What’s New distinguish opt-in imports, preserved edits, source caps and safe activation',()=>{
  const catalog=localDocsCatalog(DOC_GROUPS,DOC_ARTICLES,{meta:{product:{edition:'local'}}}), guide=catalog.articles.find(article=>article.id==='github-routes');assert(guide);assert.equal(guide.appLink.id,'github');const text=articleText(guide);
  for(const phrase of ['off by default','create-only','never overwrite','Deleting','5–60','100','12,000','current','restart','No GitHub issue edits']) assert(text.toLowerCase().includes(phrase.toLowerCase()),phrase);
  assert(catalog.articles.find(article=>article.id==='local-cli-workspace').sections.some(section=>section.id==='github-route-import'));
});
