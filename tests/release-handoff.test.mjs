import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRODUCT_UPDATES} from '../src/lib/product-updates.js';
import {DOC_ARTICLES,DOC_GROUPS} from '../src/lib/docs-content.js';
import {localDocsCatalog} from '../src/lib/local-docs-catalog.js';
test('the current packaged version has authored current local release notes',()=>{const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version,latest=PRODUCT_UPDATES[0],local=localDocsCatalog(DOC_GROUPS,DOC_ARTICLES,{meta:{product:{edition:'local'}}}).articles;assert.equal(latest.appVersion,version);assert(local.some(article=>article.id===latest.articleId&&article.group==='updates'));});
test('the full changelog cards and article metadata render canonical dates rather than today',()=>{const source=readFileSync(new URL('../src/views/Docs.jsx',import.meta.url),'utf8');assert.match(source,/ARTICLE_DATES = new Map\(PRODUCT_UPDATES/);assert.match(source,/className="docs-release-date" dateTime=\{ARTICLE_DATES.get\(article.id\)\}/);assert.match(source,/<time dateTime=\{ARTICLE_DATES.get\(article.id\)\}/);});
