import {scrollToDocsSection} from '../../lib/docs-scroll.js';
import {useEffect,useRef} from 'react';
import {productUpdateScope,recordProductUpdateRead} from '../../lib/product-update-state.js';
import {Button,useApp} from '../../ui.jsx';
import {DOC_ARTICLES} from '../../lib/docs-content.js';
import {productUpdateForTab} from '../../lib/product-updates.js';
import {DocsArticleSections} from '../DocsArticleSections.jsx';
import {useInterfaceLanguage} from '../InterfaceLanguage.jsx';
import {localizeBuiltInDoc} from '../../lib/built-in-copy.js';
import '../../views/docs.css';
import '../release-reader.css';
export function ReleaseTab({releaseId}){
 const language=useInterfaceLanguage();
 const {navigate,data,workspace}=useApp(),update=productUpdateForTab(releaseId),article=update&&localizeBuiltInDoc(DOC_ARTICLES.find(item=>item.id===update.articleId&&item.group==='updates'),language);
 const articleRef=useRef(null);
 useEffect(()=>{if(!update)return;try{const key=productUpdateScope(data.profile?.id??'local-owner',workspace?.id);recordProductUpdateRead(localStorage,key,update.id);window.dispatchEvent(new StorageEvent('storage',{key}));}catch{}},[update?.id,workspace?.id,data.profile?.id]);
 const seeChanges=()=>scrollToDocsSection(articleRef.current?.querySelector('[data-section]'));
 return <section className="release-tab" aria-label="What’s New article"><div className="docs-article-layout release-tab-layout"><article ref={articleRef} className="docs-article release-tab-article">
  <header><div><small>WHAT’S NEW{update?.appVersion ? ` · FRONDOSE ${update.appVersion}` : ''}</small><h1>{article?.title||'Frondose update'}</h1>{update?<time dateTime={update.date}>{update.date}</time>:null}</div>
  <div className="release-tab-actions">{article?.sections.length ? <Button onClick={seeChanges}>See what changed</Button> : null}<Button variant="primary" onClick={()=>navigate('docs',article?.id||'group-updates')}>Go to Docs</Button></div></header>
  {article?<><p className="release-reader-lead">{article.description}</p>{update.cover?<img className="release-tab-cover" src={update.cover} alt={update.coverAlt||''}/>:null}<DocsArticleSections article={article} idPrefix={`release-tab-${update.id}-`}/></>:<p>Release notes for this installed build aren’t bundled. Go to Docs to browse the changelog.</p>}
 </article>{article?<aside className="docs-toc release-tab-toc" aria-label="On this page"><strong>On this page</strong>{article.sections.map(section=><button key={section.id} onClick={event=>scrollToDocsSection(event.currentTarget.closest('.docs-article-layout')?.querySelector(`[data-section="${section.id}"]`))}>{section.title}</button>)}</aside>:null}</div></section>;
}
