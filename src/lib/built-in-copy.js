import {interfaceText} from './interface-language.js';
import {productUpdateForTab} from './product-updates.js';

// Call only with Frondose's bundled handbook data, not workspace documents.
export function localizeBuiltInDoc(record,language){
  if(!record||language==='en')return record;
  const t=text=>interfaceText(text,language);
  return {...record,title:t(record.title),description:t(record.description),
    ...(record.appLink?{appLink:{...record.appLink,label:t(record.appLink.label)}}:{}),
    ...(record.sources?{sources:record.sources.map(source=>({...source,label:t(source.label)}))}:{}),
    ...(record.sections?{sections:record.sections.map(section=>({...section,
      title:t(section.title),note:t(section.note),paragraphs:section.paragraphs?.map(t),
      steps:section.steps?.map(t),bullets:section.bullets?.map(t),
    }))}:{}),
  };
}

const fixedTitles={
  'new-tab':'New tab', 'editor-home':'Text editor', 'repository':'Repository',
  'source-control':'Source control', worktrees:'Worktrees', 'repository-tasks':'Repository tasks',
  automations:'Automations', terminal:'Terminal', browser:'Browser',
};
const appPageTitles={workspace:'Workspace',overview:'Today',teams:'Areas',todos:'To Do List',tasks:'Routes',projects:'Projects',documents:'Documents',updates:'Updates',starred:'Starred',views:'Saved views',work:'Runs',library:'Outputs',memory:'Memory'};
export function workspaceTabDisplayLabel(tab,language){
  if(!tab)return '';
  if(tab.customLabel)return tab.customLabel;
  if(tab.contentType==='release-notes'){
    const release=productUpdateForTab(tab.releaseId);
    return release?interfaceText(release.title,language):tab.label;
  }
  if(tab.contentType==='app'&&Object.hasOwn(appPageTitles,tab.page?.view)){
    const title=appPageTitles[tab.page.view];
    if(tab.label===title||tab.label===tab.page.view)return interfaceText(title,language);
  }
  if(Object.hasOwn(fixedTitles,tab.contentType)&&tab.label===fixedTitles[tab.contentType])return interfaceText(fixedTitles[tab.contentType],language);
  if(tab.contentType==='group'&&tab.views?.length&&tab.label===`${tab.views[0].label} + ${tab.views.length-1}`){
    return `${workspaceTabDisplayLabel(tab.views[0],language)} + ${new Intl.NumberFormat(language).format(tab.views.length-1)}`;
  }
  return tab.label;
}
