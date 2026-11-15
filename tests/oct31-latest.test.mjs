import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {interfaceText,normalizeInterfaceLanguage} from '../src/lib/interface-language.js';
import {collectInterfaceSourceCopy,transformInterfaceText} from '../scripts/interface-language-transform.mjs';
import {parse} from '@babel/parser';
const source=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('language selection is allowlisted and unknown authored labels fall back without changing content',()=>{assert.equal(normalizeInterfaceLanguage('zh-Hant'),'zh-Hant');assert.equal(normalizeInterfaceLanguage('anything'),'en');assert.equal(interfaceText('Settings','zh-Hant'),'設定');assert.equal(interfaceText('Settings','zh-Hans'),'设置');assert.equal(interfaceText('My own note','zh-Hant'),'My own note');assert.equal(interfaceText('Settings','en'),'Settings');});
test('language build transform translates authored display copy without changing data, code, or implicit option values',()=>{
 const input='export const View=()=> <section><button>Cancel</button><pre title="Settings">Cancel</pre><code>Settings</code><textarea>Settings</textarea><option value="cancel">Cancel</option><option>Save</option><p>{comment.body}</p><div data-interface-language-exclude><input placeholder="Settings"/>Settings</div><input value="Settings" placeholder="Settings" aria-label="Settings"/><input placeholder="Settings" {...draft}/><input title={comment.body}/><Heading title="Workspace activity"/></section>';
 const result=transformInterfaceText(input,'/project/src/View.jsx');
 assert.match(result,/FrondoseInterfaceText text=\{"Cancel"\}/);
 assert.match(result,/<pre title="Settings">Cancel<\/pre><code>Settings<\/code><textarea>Settings<\/textarea>/);
 assert.match(result,/value="cancel" interfaceElementType=\{"option"\} interfaceFields=\{\[\]\} interfaceOptionText=\{"Cancel"\}/);
 assert.match(result,/<option>Save<\/option>/);
 assert.equal(transformInterfaceText('export const View=()=> <option value={maybeUndefined}>Save</option>','/project/src/View.jsx'),null);
 assert.equal(transformInterfaceText('export const View=()=> <option value="save" {...props}>Save</option>','/project/src/View.jsx'),null);
 assert.match(result,/\{comment.body\}/);
 assert.match(result,/value="Settings" placeholder="Settings" aria-label="Settings" interfaceElementType=\{"input"\} interfaceFields=\{\[\["placeholder","Settings"\],\["aria-label","Settings"\]\]\}/);
 assert.match(result,/data-interface-language-exclude><input placeholder="Settings"\/>Settings/);
 assert.match(result,/<input placeholder="Settings" \{\.\.\.draft\}\/><input title=\{comment.body\}\/>/);
 assert.match(result,/interfaceElementType=\{Heading\} interfaceFields=\{\[\["title","Workspace activity"\]\]\}/);
 assert.doesNotThrow(()=>parse(result,{sourceType:'module',plugins:['jsx']}));
 assert.equal(transformInterfaceText(input,'/project/third-party/View.jsx'),null);
});
test('copy audit reports static gaps with source locations, never values, user expressions or excluded content',()=>{
 const input='export const View=()=> <div>\n<h1>Missing heading</h1><input value="Example value" aria-label="Missing input label"/><span>{user.title}</span><pre>Saved code</pre>\n</div>';
 assert.deepEqual(collectInterfaceSourceCopy(input,'/project/src/View.jsx'),[{text:'Missing heading',line:2},{text:'Missing input label',line:2}]);
});
test('EN control navigates to standalone Languages settings and does not reload a live session',async()=>{const toolbar=await source('src/components/GlobalToolbar.jsx'),settings=await source('src/views/settings/LanguageSettings.jsx');assert.match(toolbar,/navigate\('settings','languages'\)/);assert.doesNotMatch(toolbar,/English is the only complete|setLanguageOpen/);assert.match(settings,/saveInterfaceLanguage\(row.id\)/);assert.doesNotMatch(settings,/location.reload|window.reload|apiRequest|fetch\(/);assert.match(settings,/never translated/);assert.match(settings,/Untranslated controls remain in English/);});
test('automation UI keeps canonical values while displaying capitalized labels and an explicit enable action',async()=>{const jsx=await source('src/components/workspace/LocalAutomations.jsx');assert.match(jsx,/none:'Once',hourly:'Hourly',daily:'Daily',weekdays:'Weekdays',weekly:'Weekly'/);assert.match(jsx,/value=\{value\}>\{displayLabel\(value\)\}/);assert.doesNotMatch(jsx,/Allow this exact Route|setApprove|automation-consent|Save & activate/);assert.match(jsx,/confirm_recurring:true/);assert.match(jsx,/Enable schedule/);assert.match(jsx,/snapshot_hash:reviewed.snapshot_hash/);assert.match(jsx,/binding_version:reviewed.binding_version/);});
test('automation recipes use original Frondose planning, Route and documentation routines with equal filter controls',async()=>{const jsx=await source('src/components/workspace/LocalAutomations.jsx'),css=await source('src/components/workspace/local-automations.css');assert.doesNotMatch(jsx,/Weekday repo audit|Release readiness|Daily change review|Hourly queue check/);for(const label of['Morning workspace brief','Route follow-through','Documentation cross-check'])assert.ok(jsx.includes(label));assert.match(css,/grid-template-columns:minmax\(0,1fr\) 120px 120px/);assert.match(css,/height:36px;min-height:36px/);assert.match(css,/@container\(max-width:460px\)/);});
test('right Explorer remains mounted, animates its container and cannot receive focus while closed',async()=>{const jsx=await source('src/components/workspace/WorkspaceSurface.jsx'),css=await source('src/components/workspace/workspace-surface.css');assert.match(jsx,/data-open=\{explorerOpen\}/);assert.match(jsx,/inert=\{!explorerOpen\|\|undefined\}/);assert.doesNotMatch(jsx,/explorerOpen\?<><div className="workspace-files-resizer"/);assert.match(css,/transition:width 200ms/);assert.match(css,/translateX\(100%\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/explorer-resizing=true/);});

import {initialLocalAutomationTime} from '../src/lib/local-automation-time.js';
test('weekday recipes start on the next real weekday without invalid Saturday defaults',()=>{assert.equal(initialLocalAutomationTime({recurrence:'weekdays'},Date.parse('2026-10-31T02:00:00Z'),'Asia/Hong_Kong'),'2026-11-02T11:00');assert.equal(initialLocalAutomationTime({recurrence:'daily'},Date.parse('2026-10-31T02:00:00Z'),'Asia/Hong_Kong'),'2026-10-31T11:00');assert.equal(initialLocalAutomationTime({recurrence:'weekdays'},Date.parse('2026-10-30T23:30:00Z'),'America/New_York'),'2026-10-30T20:30');assert.equal(initialLocalAutomationTime({recurrence:'weekdays'},Date.parse('2026-10-31T12:00:00Z'),'America/New_York'),'2026-11-02T09:00');});
test('automation validation stays visible in its form rather than disappearing as a toast',async()=>{const jsx=await source('src/components/workspace/LocalAutomations.jsx');assert.match(jsx,/automation-inline-error" role="alert"/);assert.doesNotMatch(jsx,/console.info/);});
