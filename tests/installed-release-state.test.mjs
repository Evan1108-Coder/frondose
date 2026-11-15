import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installedReleaseFor, installedReleaseScope, readInstalledReleaseVersion, recordInstalledReleaseVersion } from '../src/lib/installed-release-state.js';
import { PRODUCT_UPDATES, productUpdateForTab, productUpdateForVersion } from '../src/lib/product-updates.js';
import { DOC_ARTICLES } from '../src/lib/docs-content.js';
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key,value) => values.set(key,value) }; };
const articles = [{ id:'authored',group:'updates' }], updates = [{ id:'release',appVersion:'1.2.0',articleId:'authored',title:'Known changes' }];
test('each local build from 0.1.4 through 0.1.7 opens its own dated article, including old saved tabs', () => {
  const versions = ['0.1.4','0.1.5','0.1.6','0.1.7'];
  const expectedDates = ['2026-11-12','2026-11-12','2026-11-13','2026-11-14'];
  const ids = versions.map((version,index) => {
    assert.equal(PRODUCT_UPDATES.filter(update=>update.appVersion===version).length,1);
    const update = productUpdateForVersion(version);
    const authored = DOC_ARTICLES.find(article=>article.id===update.articleId && article.group==='updates');
    assert.equal(authored.date,expectedDates[index]);
    assert.equal(authored.title,update.title);
    assert.equal(productUpdateForTab('installed-'+version),update);
    assert.equal(installedReleaseFor({packaged:true,version},'0.1.3',PRODUCT_UPDATES,DOC_ARTICLES).articleId,authored.id);
    return authored.id;
  });
  assert.equal(new Set(ids).size,versions.length);
  assert.equal(productUpdateForTab('installed-9.8.7'),undefined);
});
test('installed release receipts are bounded versioned presentation state scoped per workspace', () => {
  const browser=storage(), key=installedReleaseScope('actor/workspace');
  assert.notEqual(key,installedReleaseScope('actor/other'));
  assert.equal(readInstalledReleaseVersion(browser,key),null);
  assert.equal(recordInstalledReleaseVersion(browser,key,'1.1.0'),true);
  assert.equal(readInstalledReleaseVersion(browser,key),'1.1.0');
  assert.equal(recordInstalledReleaseVersion(browser,key,'bad\nversion'),false);
});
test('first install, browser/development and same-version reopens never automatically show notes', () => {
  assert.equal(installedReleaseFor({packaged:true,version:'1.2.0'},null,updates,articles),null);
  assert.equal(installedReleaseFor({packaged:false,version:'1.2.0'},'1.1.0',updates,articles),null);
  assert.equal(installedReleaseFor({packaged:true,version:'0.0.0'},'1.1.0',updates,articles),null);
  assert.equal(installedReleaseFor({packaged:true,version:'0.0.0-dev'},'1.1.0',updates,articles),null);
  assert.equal(installedReleaseFor({packaged:true,version:'1.2.0'},'1.2.0',updates,articles),null);
});
test('a changed actual installed version uses only exact authored notes or honest generic fallback', () => {
  assert.equal(installedReleaseFor({packaged:true,version:'1.2.0'},'1.1.0',updates,articles).articleId,'authored');
  const unknown=installedReleaseFor({packaged:true,version:'1.3.0'},'1.2.0',updates,articles);
  assert.equal(unknown.articleId,null);assert.equal(unknown.installedVersion,'1.3.0');
  const browser=storage(),key=installedReleaseScope('scope');
  recordInstalledReleaseVersion(browser,key,'1.3.0');
  assert.equal(installedReleaseFor({packaged:true,version:'1.3.0'},readInstalledReleaseVersion(browser,key),updates,articles),null);
});
test('corrupt or unavailable receipt storage does not break reading or dismissal', () => {
  const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readInstalledReleaseVersion(broken,'k'),null);assert.equal(recordInstalledReleaseVersion(broken,'k','1.2.3'),false);
  assert.equal(readInstalledReleaseVersion({getItem:()=>JSON.stringify({version:2,appVersion:'1.2.3'})},'k'),null);
});
test('desktop exposes only a trusted read-only actual app-version control and public release label', () => {
  const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8'),preload=readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  assert.match(main,/app-info', event => \{ trusted\(event\); return \{ version: app\.getVersion\(\), packaged: app\.isPackaged/);
  assert.match(preload,/appInfo: \(\) => invoke\('app-info'\)/);
  const help=readFileSync(new URL('../src/components/HelpMenu.jsx',import.meta.url),'utf8');
  assert.match(help,/rumbo-help-menu-label">What’s New/);assert.match(help,/installedReleaseFor/);
});
