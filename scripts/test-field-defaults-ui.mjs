// Browser plugin not available in this session; use bundled Playwright.
// Real React controlled fields and the authored DateField/SearchField, no API,
// provider account, database, or live local workspace is touched.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { analyzeFieldSource, instrumentFieldSource, fieldDefaultsSourcePlugin } from './field-defaults-transform.mjs';
const { chromium } = await import(process.env.TALVORI_PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), 'rumbo-field-defaults-'));
const fixture = `
import React, {useState} from 'react';
import '/src/styles.css';
import {createRoot} from 'react-dom/client';
import {FieldDefaultsProvider} from '/src/components/FieldDefaultsProvider.jsx';
import {DateField} from '/src/components/DateField.jsx';
import {SearchField} from '/src/ui.jsx';
import {FieldDefaultsSettings} from '/src/views/settings/FieldDefaultsSettings.jsx';
import {fieldDefinitionsForWorkspace} from '/src/lib/field-inventory.js';
function NewFixture(){
 const [text,setText]=useState(''), [saved,setSaved]=useState('Existing record'), [blankEdit,setBlankEdit]=useState(''), [query,setQuery]=useState(''), [date,setDate]=useState(''), [number,setNumber]=useState(''), [time,setTime]=useState(''), [datetime,setDatetime]=useState(''), [long,setLong]=useState(''), [plain,setPlain]=useState('');
 const [settings,setSettings]=useState(false), [writes,setWrites]=useState(0), [setting,setSetting]=useState(''), [aliased,setAliased]=useState('');
 const [variant,setVariant]=useState(false), [dynamic,setDynamic]=useState('');
 return <FieldDefaultsProvider workspaceId="qa" definitions={fieldDefinitionsForWorkspace({})}>
 <h1>Field defaults test</h1><button onClick={()=>setSettings(!settings)}>Toggle settings</button>
 <label>New text<input aria-label="New text" value={text} onChange={e=>setText(e.target.value)}/></label><output data-testid="text-state">{text}</output>
 <label>Existing<input aria-label="Existing" data-field-default-mode="edit" value={saved} onChange={e=>setSaved(e.target.value)}/></label>
 <label>Blank edit<input aria-label="Blank edit" data-field-default-mode="edit" value={blankEdit} onChange={e=>{setBlankEdit(e.target.value);setWrites(n=>n+1)}}/></label>
 <label>Auto-saving setting<input aria-label="Auto-saving setting" data-field-default-auto="false" data-field-default-mode="edit" value={setting} onChange={e=>{setSetting(e.target.value);setWrites(n=>n+1)}}/></label><output data-testid="writes">{writes}</output>
 <SearchField value={query} onChange={setQuery} placeholder="Search QA"/>
 <label>Authored date<DateField aria-label="Authored date" value={date} onChange={setDate}/></label>
 <input aria-label="Number" type="number" min="1" max="10" step="2" value={number} onChange={e=>setNumber(e.target.value)}/>
 <input aria-label="Time" type="time" value={time} onChange={e=>setTime(e.target.value)}/>
 <input aria-label="Datetime" type="datetime-local" value={datetime} onChange={e=>setDatetime(e.target.value)}/>
 <textarea aria-label="Long text" value={long} onChange={e=>setLong(e.target.value)}/>
 <input aria-label="Pattern" pattern="[A-Z]{3}" maxLength="3" value={plain} onChange={e=>setPlain(e.target.value)}/>
 <input aria-label="Uncontrolled" defaultValue="Original"/>
 <input aria-label="Aliased" {...{'data-field-default-key':'qa.specific'}} value={aliased} onChange={e=>setAliased(e.target.value)}/>
 <input aria-label="Dynamic" data-field-default-key={'qa.dynamic.'+(variant?'second':'first')} data-field-default-mode="create" value={dynamic} onChange={e=>setDynamic(e.target.value)}/><button onClick={()=>{setDynamic('');setVariant(!variant)}}>Change dynamic field</button>
 <input aria-label="Read only" readOnly value="fixed"/>
 <input aria-label="Disabled" disabled/>
 <form aria-label="Security"><input aria-label="Security name"/><input type="password" aria-label="Password"/></form>
 <input name="verification_token" aria-label="Generic sensitive"/>
 {settings ? <FieldDefaultsSettings workspaceId="qa" definitions={fieldDefinitionsForWorkspace({})}/> : null}
 </FieldDefaultsProvider>;
}
createRoot(document.getElementById('root')).render(<NewFixture/>);
`;
const sourcePath = 'src/components/FieldDefaultsFixture.jsx';
const fields = analyzeFieldSource(fixture, sourcePath);
const key = label => fields.find(field => field.label === label)?.key;
const entry = (value, slot=1) => ({enabled:true,primaryId:'a',values:[{id:'a',name:'QA value',value,slot,enabled:true}]});
const preferences = {enabled:true,shortcutsEnabled:true,fields:{
 [key('New text')]:entry('Default text'), [key('Existing')]:entry('Replacement'), [key('Blank edit')]:entry('Explicit edit'), [key('Auto-saving setting')]:entry('Explicit setting'),
 [key('Search QA')]:entry('Search default'), [key('Authored date')]:entry('2028-02-29'), [key('Number')]:entry('3'), [key('Time')]:entry('14:30'), [key('Datetime')]:entry('2028-02-29T14:30'), [key('Long text')]:entry('First line\nSecond line'), [key('Pattern')]:entry('ABC'), [key('Uncontrolled')]:entry('New uncontrolled'),
 [key('Read only')]:entry('Must not insert'), [key('Disabled')]:entry('Must not insert'), [key('Security name')]:entry('Must not insert'), [key('Generic sensitive')]:entry('Must not insert'),
 [key('Aliased')]:entry('Operational source fallback'),
 'qa.dynamic.first':entry('First primary'), 'qa.dynamic.second':entry('Second primary'),
}};
const server = await createServer({root,cacheDir:join(directory,'vite-cache'),configFile:false,server:{host:'127.0.0.1',port:4194,strictPort:true},plugins:[
{name:'field-fixture',enforce:'pre',resolveId(id){if(id==='/__fixture.jsx')return id;},load(id){if(id==='/__fixture.jsx')return instrumentFieldSource(fixture,sourcePath);},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/', '<!doctype html><title>Talvori defaults QA</title><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/__fixture.jsx"></script>'));});}},
 fieldDefaultsSourcePlugin(root),react({include:/\/src\/.*\.jsx$/}),
]});
await server.listen();
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(['error','warn'].includes(message.type()))errors.push(message.text());});
try {
 await page.addInitScript(prefs=>localStorage.setItem('rumbo:field-defaults:v1:qa',JSON.stringify(prefs)),preferences);
 await page.goto('http://127.0.0.1:4194');
 await page.getByRole('heading',{name:'Field defaults test'}).waitFor();
 assert.equal(await page.title(),'Talvori defaults QA');
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 const input=label=>page.getByLabel(label,{exact:true});
 const replace=async(label)=>{await input(label).focus();await page.keyboard.press('Alt+Shift+1');};
 const undo=async()=>page.keyboard.press('Control+z');
 assert.equal(await input('New text').inputValue(),'Default text');
 assert.equal(await page.getByTestId('text-state').innerText(),'Default text');
 assert.equal(await input('Existing').inputValue(),'Existing record');
 assert.equal(await input('Blank edit').inputValue(),'');
 assert.equal(await input('Auto-saving setting').inputValue(),'');
 assert.equal(await page.getByTestId('writes').innerText(),'0');
 await replace('Existing');assert.equal(await input('Existing').inputValue(),'Replacement');await undo();assert.equal(await input('Existing').inputValue(),'Existing record');
 await replace('Blank edit');assert.equal(await input('Blank edit').inputValue(),'Explicit edit');await undo();assert.equal(await input('Blank edit').inputValue(),'');
 await replace('Auto-saving setting');assert.equal(await input('Auto-saving setting').inputValue(),'Explicit setting');await undo();assert.equal(await input('Auto-saving setting').inputValue(),'');
 assert.equal(await input('Search QA').inputValue(),'Search default');
 assert.equal(await input('Authored date').inputValue(),'2028-02-29');
 assert.equal(await input('Number').inputValue(),'3');
 assert.equal(await input('Time').inputValue(),'14:30');
 assert.equal(await input('Datetime').inputValue(),'2028-02-29T14:30');
 assert.equal(await input('Long text').inputValue(),'First line\nSecond line');
 assert.equal(await input('Pattern').inputValue(),'ABC');
 assert.equal(await input('Aliased').inputValue(),'Operational source fallback');
 assert.equal(await input('Dynamic').inputValue(),'First primary');
 await page.getByRole('button',{name:'Change dynamic field',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Dynamic"]').value==='Second primary');
 assert.equal(await input('Uncontrolled').inputValue(),'Original');await replace('Uncontrolled');assert.equal(await input('Uncontrolled').inputValue(),'New uncontrolled');await undo();assert.equal(await input('Uncontrolled').inputValue(),'Original');
 assert.equal(await input('Read only').inputValue(),'fixed');assert.equal(await input('Disabled').inputValue(),'');
 await replace('Security name');assert.equal(await input('Security name').inputValue(),'');
 await replace('Generic sensitive');assert.equal(await input('Generic sensitive').inputValue(),'');
 await page.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('rumbo:field-defaults:v1:qa'));prefs.enabled=false;localStorage.setItem('rumbo:field-defaults:v1:qa',JSON.stringify(prefs));dispatchEvent(new CustomEvent('rumbo:field-defaults-changed',{detail:{workspaceId:'qa'}}));});
 await replace('Existing');assert.equal(await input('Existing').inputValue(),'Existing record');
 await page.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('rumbo:field-defaults:v1:qa'));prefs.enabled=true;localStorage.setItem('rumbo:field-defaults:v1:qa',JSON.stringify(prefs));dispatchEvent(new CustomEvent('rumbo:field-defaults-changed',{detail:{workspaceId:'qa'}}));});
 // Native constraints fail closed and do not modify the currently valid value.
 await page.evaluate(({key,entry})=>{const prefs=JSON.parse(localStorage.getItem('rumbo:field-defaults:v1:qa'));prefs.fields[key]=entry;localStorage.setItem('rumbo:field-defaults:v1:qa',JSON.stringify(prefs));dispatchEvent(new CustomEvent('rumbo:field-defaults-changed',{detail:{workspaceId:'qa'}}));},{key:key('Number'),entry:entry('2')});
 await replace('Number');assert.equal(await input('Number').inputValue(),'3');
 await page.evaluate(({key,entry})=>{const prefs=JSON.parse(localStorage.getItem('rumbo:field-defaults:v1:qa'));prefs.fields[key]=entry;localStorage.setItem('rumbo:field-defaults:v1:qa',JSON.stringify(prefs));dispatchEvent(new CustomEvent('rumbo:field-defaults-changed',{detail:{workspaceId:'qa'}}));},{key:key('Pattern'),entry:entry('toolong')});
 await replace('Pattern');assert.equal(await input('Pattern').inputValue(),'ABC');
 await page.getByRole('button',{name:'Toggle settings'}).click();
 await page.getByRole('heading',{name:'Field defaults',exact:true}).waitFor();
 const find=page.getByPlaceholder('Search fields…');
 await find.fill('Template question label');assert.ok(await page.locator('.field-default-card').count()>0);
 await find.fill('Appearance');assert.ok(await page.locator('.field-default-card').count()>0);
 await find.fill('Workbench commands');assert.ok(await page.locator('.field-default-card').count()>0);
 await find.fill('Scheduled message');assert.ok(await page.locator('.field-default-card').count()>0);
 await find.fill('Search updates');assert.ok(await page.locator('.field-default-card').count()>0);
 const editorValue=page.locator('.field-default-settings input').first();
 assert.equal(await editorValue.getAttribute('data-field-default-source'),null);
 await page.locator('.field-default-settings').screenshot({path:'/tmp/rumbo-field-defaults-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.field-default-settings').screenshot({path:'/tmp/rumbo-field-defaults-mobile.png'});
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Injected storage quota failure');};});
 await page.getByRole('button',{name:'Add value',exact:true}).first().click();
 await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/could not save/);
 assert.deepEqual(errors,[]);
 console.log('PASS: React controlled/native/custom inputs, creation preservation, edit/settings explicit-only+undo, source catalog without visits, native constraints, desktop/mobile render.');
} catch (error) {
 console.error('Browser errors:',errors);
 console.error((await page.locator('body').innerText()).slice(0,3000));
 await page.screenshot({path:'/tmp/rumbo-field-defaults-failure.png'});
 throw error;
} finally {await browser.close();await server.close();await rm(directory,{recursive:true,force:true});}
