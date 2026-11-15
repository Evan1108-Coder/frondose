import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../', import.meta.url));
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bundle = buildSync({ stdin: { contents: `export {WorkspaceOpenIn} from './src/components/DesktopApplications.jsx'; export {SetupGuide,repositorySetupHelpVisible} from './src/components/workspace/GitRepositoryBar.jsx'; export {AppContext} from './src/app-context.js';`, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react','react-dom'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,require);
const { WorkspaceOpenIn, SetupGuide, repositorySetupHelpVisible, AppContext } = module.exports;
const render = (Component, props) => renderToStaticMarkup(React.createElement(AppContext.Provider,{value:{notify(){},navigate(){}}},React.createElement(Component,props)));

test('Open in stays inert until opened, and its menu escapes clipping through a viewport-clamped portal', () => {
  const previous = globalThis.frondoseDesktop;
  try {
    let calls = 0; globalThis.frondoseDesktop = { applications:{ command(){ calls++; throw Error('SSR must not execute'); } } };
    const html = render(WorkspaceOpenIn,{workspaceId:'fixture',binding:{version:'root'}});
    assert.match(html,/<summary[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    assert(!html.includes('desktop-app-menu')); assert.equal(calls,0);
    const code = source('src/components/DesktopApplications.jsx'), css = source('src/components/desktop-applications.css');
    assert.match(code,/usePopupPosition\(open, trigger,[^\n]+portal: true/);
    assert.match(code,/createPortal\([\s\S]*document\.body\)/);
    assert.match(code,/role="menu" aria-label="Open in applications"/);
    assert.match(code,/usePopupMotion\(open, panel/);
    assert.match(code,/pointerdown/);assert.match(code,/focusin/);assert.match(code,/event\.key === 'Escape'/);
    assert.match(css,/\.desktop-app-menu\{position:fixed/);assert.match(css,/overflow:auto/);
    assert.doesNotMatch(css,/position:absolute|right:0|overflow:visible/);
  } finally { if (previous === undefined) delete globalThis.frondoseDesktop; else globalThis.frondoseDesktop = previous; }
});

test('the shared portal-position helper clamps Open in inside desktop and phone viewports', () => {
  const code = buildSync({ entryPoints:[root + '/src/components/usePopupPosition.js'], bundle:true,write:false,platform:'node',format:'cjs',external:['react'] }).outputFiles[0].text;
  const previousWindow=globalThis.window,previousObserver=globalThis.ResizeObserver,previousCancel=globalThis.cancelAnimationFrame;
  let position, cleanup;
  const fakeReact={useState: initial=>[initial,next=>{position=next;}],useLayoutEffect: effect=>{cleanup=effect();}};
  const loaded={exports:{}};
  new Function('module','exports','require',code)(loaded,loaded.exports,name=>name==='react'?fakeReact:require(name));
  try {
    globalThis.ResizeObserver=class{observe(){}disconnect(){}};
    globalThis.cancelAnimationFrame=()=>{};
    for(const view of [{width:1280,height:800,left:300,bottom:80},{width:390,height:844,left:354,bottom:80},{width:220,height:400,left:10,bottom:80}]){
      globalThis.window={innerWidth:view.width,innerHeight:view.height,addEventListener(){},removeEventListener(){},visualViewport:undefined};
      loaded.exports.usePopupPosition(true,{current:{getBoundingClientRect:()=>({left:view.left,top:50,bottom:view.bottom,width:90})}},{width:230,height:200,portal:true});
      assert(position.left>=12);assert(position.left+position.width<=view.width-12);assert(position.top>=0);assert(position.top+position.maxHeight<=view.height);cleanup?.();
    }
  }finally{
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousObserver===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=previousObserver;
    if(previousCancel===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=previousCancel;
  }
});

test('Find files overrides the inherited 44px input rather than enlarging the entire explorer', () => {
  const css=source('src/components/workspace/directory-files.css');
  assert.match(css,/\.directory-file-search \{[^}]*height: 30px;[^}]*min-height: 30px/);
  assert.match(css,/\.directory-file-search input \{[^}]*height: 28px;[^}]*min-height: 0;/);
  assert.match(css,/\.directory-file-search:focus-within \{ border-color: var\(--focus\)/);
});

test('connected repositories omit setup instructions and AI prompts; disconnected repositories retain help', () => {
  assert.equal(repositorySetupHelpVisible({connected:true}),false);assert.equal(repositorySetupHelpVisible(null),false);assert.equal(repositorySetupHelpVisible({connected:false}),true);
  const base={directory:'/fixture/project',projectName:'Fixture',github:{slug:'example/fixture',url:'https://github.com/example/fixture'}};
  assert.equal(render(SetupGuide,{state:{...base,connected:true}}),'');
  const disconnected=render(SetupGuide,{state:{...base,connected:false}});assert.match(disconnected,/GitHub setup guide and AI prompt/);assert.match(disconnected,/Customized GitHub setup prompt/);assert.match(disconnected,/Copy setup prompt/);
  const css=source('src/components/workspace/git-repository.css');assert.match(css,/\.git-repository-dialog > \.git-repository-actions \{[^}]*display:flex;[^}]*align-items:center;[^}]*flex-wrap:wrap;[^}]*gap:8px;/);
  assert.match(css,/\.git-repository-actions > \.button \{[^}]*min-height:34px;[^}]*margin:0;/);
  const repository=source('src/components/workspace/GitRepositoryBar.jsx');assert.match(repository,/git-source-unavailable/);assert.match(repository,/Retry/);assert.match(repository,/GitHub account access could not be verified/);
});
