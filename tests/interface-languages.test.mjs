import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getInterfaceLanguage, INTERFACE_LANGUAGES, interfaceDocumentLanguage, interfaceText,
  INTERFACE_TRANSLATIONS, interfaceSearchKey,
  LANGUAGE_EVENT, LANGUAGE_KEY, normalizeInterfaceLanguage, readInterfaceLanguage,
  saveInterfaceLanguage, searchInterfaceLanguages, subscribeInterfaceLanguage,
} from '../src/lib/interface-language.js';
import { DOC_LOCAL } from '../src/lib/docs-local.js';
import { localWorkspaceSettingsGroups } from '../src/lib/local-settings-catalog.js';
import { CHECKLIST_STEPS } from '../src/lib/onboarding-checklist.js';

test('language catalog is searchable by native name, English name, tag, region and accent-insensitive text',()=>{
  assert.ok(INTERFACE_LANGUAGES.length>=70);
  assert.deepEqual(searchInterfaceLanguages(''),INTERFACE_LANGUAGES);
  for (const [query,id] of [['francais','fr'],['日本語','ja'],['Japanese','ja'],['pt_br','pt-BR'],['Traditional Chinese','zh-Hant'],['zh-tw','zh-Hant'],['Latinoamerica','es-419'],['فارسی','fa'],['हिन्दी','hi']]) {
    assert.equal(searchInterfaceLanguages(query)[0]?.id,id,query);
  }
  assert.deepEqual(searchInterfaceLanguages('does-not-match-a-language'),[]);
  assert.equal(new Set(INTERFACE_LANGUAGES.map(row=>row.id)).size,INTERFACE_LANGUAGES.length);
  assert.equal(Intl.DateTimeFormat.supportedLocalesOf(INTERFACE_LANGUAGES.map(row=>row.id)).length,INTERFACE_LANGUAGES.length);
});

test('interface previews fall back to English; formatting-only preferences leave document and authored UI in English',()=>{
  assert.equal(getInterfaceLanguage('en').coverage,'full');
  for (const row of INTERFACE_LANGUAGES.filter(row=>row.coverage==='preview')) {
    assert.notEqual(interfaceText('Settings',row.id),'Settings',row.id);
    assert.equal(interfaceDocumentLanguage(row.id),row.id);
    assert.equal(interfaceText('User-content test text',row.id),'User-content test text');
  }
  assert.equal(getInterfaceLanguage('ar').coverage,'locale-only');
  assert.equal(interfaceText('Settings','ar'),'Settings');
  assert.equal(interfaceDocumentLanguage('ar'),'en');
  assert.equal(normalizeInterfaceLanguage('anything'),'en');
  assert.equal(interfaceText('constructor','fr'),'constructor');
  assert.notEqual(new Intl.DateTimeFormat('ar',{calendar:'gregory',dateStyle:'long'}).format(0),new Intl.DateTimeFormat('en',{dateStyle:'long'}).format(0));
});

test('device preference persists and notifies subscribers without a reload',()=>{
  const original={};
  const target=new EventTarget(), saved=new Map();
  const globals={
    localStorage:{ getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value) },
    addEventListener:target.addEventListener.bind(target),
    removeEventListener:target.removeEventListener.bind(target),
    dispatchEvent:target.dispatchEvent.bind(target),
  };
  for (const [key,value] of Object.entries(globals)) {
    original[key]=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  try {
    const seen=[], stop=subscribeInterfaceLanguage(()=>seen.push(readInterfaceLanguage()));
    assert.equal(readInterfaceLanguage(),'en');
    assert.equal(saveInterfaceLanguage('zh-Hant'),'zh-Hant');
    assert.equal(saved.get(LANGUAGE_KEY),'zh-Hant');
    saveInterfaceLanguage('ar');
    assert.deepEqual(seen,['zh-Hant','ar']);
    stop();
    target.dispatchEvent(new Event(LANGUAGE_EVENT));
    assert.deepEqual(seen,['zh-Hant','ar']);
  } finally {
    for (const [key,descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
    }
  }
});

test('all preview catalogs cover the desktop Settings rail and checklist definitions',()=>{
  const labels=localWorkspaceSettingsGroups([], {meta:{product:{edition:'local'}}}).flatMap(([group,rows])=>[group,...rows.map(([,label])=>label)]);
  labels.push(...CHECKLIST_STEPS.flatMap(({title,detail})=>[title,detail]));
  for(const {id} of INTERFACE_LANGUAGES.filter(row=>row.coverage==='preview')){
    for(const label of new Set(labels)){
      if(label==='GitHub')continue;
      assert.ok(INTERFACE_TRANSLATIONS[label]?.[id],`Missing ${id} copy for ${label}`);
    }
    for(const label of ['This workspace','Onboarding Checklist','CLI Agents','Workspace activity'])assert.notEqual(interfaceText(label,id),label,id);
  }
  assert.equal(interfaceSearchKey('ACTIVITÉ de l’espace'),"activite de l'espace");
  assert.notEqual(interfaceSearchKey('工作區活動'),interfaceSearchKey('工作區'));
});

test('in-app language guide links to Languages settings and explains preview and formatting coverage',()=>{
  const guide=DOC_LOCAL.find(article=>article.id==='interface-languages');
  assert.deepEqual(guide.appLink,{view:'settings',id:'languages',label:'Open Languages'});
  const text=guide.sections.flatMap(section=>section.paragraphs).join(' ');
  assert.match(text,/remain in preview/);
  assert.match(text,/Formatting-only/);
  assert.match(text,/original language/);
});
