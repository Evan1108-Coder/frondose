import {getInterfaceLanguage} from './language-catalog.js';
import {SHELL_LANGUAGE_TRANSLATIONS} from './shell-language-translations.js';
import {SETTINGS_LANGUAGE_TRANSLATIONS} from './settings-language-translations.js';
export {getInterfaceLanguage,INTERFACE_LANGUAGES,searchInterfaceLanguages} from './language-catalog.js';

// Only authored interface strings are translated. Never feed user content here.
const CHINESE_TRANSLATIONS={
  "Settings": {
    "zh-Hans": "设置",
    "zh-Hant": "設定"
  },
  "Languages": {
    "zh-Hans": "语言",
    "zh-Hant": "語言"
  },
  "Interface language": {
    "zh-Hans": "界面语言",
    "zh-Hant": "介面語言"
  },
  "Back to workspace": {
    "zh-Hans": "返回工作区",
    "zh-Hant": "返回工作區"
  },
  "Search": {
    "zh-Hans": "搜索",
    "zh-Hant": "搜尋"
  },
  "Search settings": {
    "zh-Hans": "搜索设置",
    "zh-Hant": "搜尋設定"
  },
  "Personal": {
    "zh-Hans": "个人",
    "zh-Hant": "個人"
  },
  "This computer": {
    "zh-Hans": "此电脑",
    "zh-Hant": "此電腦"
  },
  "Local installation": {
    "zh-Hans": "本地安装",
    "zh-Hant": "本機安裝"
  },
  "App updates": {
    "zh-Hans": "应用更新",
    "zh-Hant": "應用程式更新"
  },
  "Open in Apps": {
    "zh-Hans": "在应用中打开",
    "zh-Hant": "在應用程式中開啟"
  },
  "Integrations": {
    "zh-Hans": "集成",
    "zh-Hant": "整合"
  },
  "General": {
    "zh-Hans": "通用",
    "zh-Hant": "一般"
  },
  "Profile": {
    "zh-Hans": "个人资料",
    "zh-Hant": "個人資料"
  },
  "Appearance": {
    "zh-Hans": "外观",
    "zh-Hant": "外觀"
  },
  "Workspace tabs": {
    "zh-Hans": "工作区标签页",
    "zh-Hant": "工作區分頁"
  },
  "Terminal": {
    "zh-Hans": "终端",
    "zh-Hant": "終端機"
  },
  "Session history search": {
    "zh-Hans": "会话历史搜索",
    "zh-Hant": "工作階段記錄搜尋"
  },
  "Notifications": {
    "zh-Hans": "通知",
    "zh-Hant": "通知"
  },
  "Code appearance": {
    "zh-Hans": "代码外观",
    "zh-Hant": "程式碼外觀"
  },
  "Field defaults": {
    "zh-Hans": "输入默认值",
    "zh-Hant": "輸入預設值"
  },
  "Local lock & sessions": {
    "zh-Hans": "本地锁定与会话",
    "zh-Hant": "本機鎖定與工作階段"
  },
  "Privacy": {
    "zh-Hans": "隐私",
    "zh-Hant": "私隱"
  },
  "Routes": {
    "zh-Hans": "路线",
    "zh-Hant": "路線"
  },
  "Labels": {
    "zh-Hans": "标签",
    "zh-Hant": "標籤"
  },
  "Templates": {
    "zh-Hans": "模板",
    "zh-Hant": "範本"
  },
  "Workflow": {
    "zh-Hans": "工作流程",
    "zh-Hant": "工作流程"
  },
  "Projects": {
    "zh-Hans": "项目",
    "zh-Hant": "專案"
  },
  "Statuses": {
    "zh-Hans": "状态",
    "zh-Hant": "狀態"
  },
  "Workspace tools": {
    "zh-Hans": "工作区工具",
    "zh-Hant": "工作區工具"
  },
  "Documents": {
    "zh-Hans": "文档",
    "zh-Hant": "文件"
  },
  "Saved views": {
    "zh-Hans": "已保存视图",
    "zh-Hant": "已儲存檢視"
  },
  "Reviews & deliverables": {
    "zh-Hans": "审阅与交付成果",
    "zh-Hant": "審閱與交付成果"
  },
  "Workspace & data": {
    "zh-Hans": "工作区与数据",
    "zh-Hant": "工作區與資料"
  },
  "Workspace": {
    "zh-Hans": "工作区",
    "zh-Hant": "工作區"
  },
  "Data & retention": {
    "zh-Hans": "数据与保留",
    "zh-Hant": "資料與保留"
  },
  "Import & export": {
    "zh-Hans": "导入与导出",
    "zh-Hant": "匯入與匯出"
  },
  "Audit log": {
    "zh-Hans": "审计日志",
    "zh-Hant": "稽核記錄"
  },
  "Starred": {
    "zh-Hans": "已收藏",
    "zh-Hant": "已收藏"
  },
  "Runs": {
    "zh-Hans": "运行记录",
    "zh-Hant": "執行記錄"
  },
  "Areas": {
    "zh-Hans": "领域",
    "zh-Hant": "領域"
  },
  "Resources": {
    "zh-Hans": "资源",
    "zh-Hant": "資源"
  },
  "Updates": {
    "zh-Hans": "更新",
    "zh-Hant": "更新"
  },
  "Automations": {
    "zh-Hans": "自动化",
    "zh-Hant": "自動化"
  },
  "New automation": {
    "zh-Hans": "新建自动化",
    "zh-Hant": "新增自動化"
  },
  "New local automation": {
    "zh-Hans": "新建本地自动化",
    "zh-Hant": "新增本機自動化"
  },
  "Review local automation": {
    "zh-Hans": "审阅本地自动化",
    "zh-Hant": "檢閱本機自動化"
  },
  "Build a workspace rhythm": {
    "zh-Hans": "建立工作节奏",
    "zh-Hant": "建立工作節奏"
  },
  "Start with a focused routine, then make it your own.": {
    "zh-Hans": "从一个专注的例行任务开始，再按需调整。",
    "zh-Hant": "從一項專注的例行工作開始，再按需要調整。"
  },
  "Morning workspace brief": {
    "zh-Hans": "每日工作区简报",
    "zh-Hant": "每日工作區簡報"
  },
  "Route follow-through": {
    "zh-Hans": "路线跟进",
    "zh-Hant": "路線跟進"
  },
  "Documentation cross-check": {
    "zh-Hans": "文档交叉检查",
    "zh-Hant": "文件交叉檢查"
  },
  "Planning": {
    "zh-Hans": "计划",
    "zh-Hant": "規劃"
  },
  "Progress": {
    "zh-Hans": "进度",
    "zh-Hant": "進度"
  },
  "Knowledge": {
    "zh-Hans": "知识",
    "zh-Hant": "知識"
  },
  "Once": {
    "zh-Hans": "一次",
    "zh-Hant": "一次"
  },
  "Hourly": {
    "zh-Hans": "每小时",
    "zh-Hant": "每小時"
  },
  "Daily": {
    "zh-Hans": "每天",
    "zh-Hant": "每天"
  },
  "Weekdays": {
    "zh-Hans": "工作日",
    "zh-Hant": "工作日"
  },
  "Weekly": {
    "zh-Hans": "每周",
    "zh-Hant": "每週"
  },
  "All": {
    "zh-Hans": "全部",
    "zh-Hant": "全部"
  },
  "Active": {
    "zh-Hans": "运行中",
    "zh-Hant": "啟用中"
  },
  "Paused": {
    "zh-Hans": "已暂停",
    "zh-Hant": "已暫停"
  },
  "Finished": {
    "zh-Hans": "已结束",
    "zh-Hant": "已結束"
  },
  "Refresh": {
    "zh-Hans": "刷新",
    "zh-Hant": "重新整理"
  },
  "Cancel": {
    "zh-Hans": "取消",
    "zh-Hant": "取消"
  },
  "Close": {
    "zh-Hans": "关闭",
    "zh-Hant": "關閉"
  },
  "Save": {
    "zh-Hans": "保存",
    "zh-Hant": "儲存"
  },
  "Save changes": {
    "zh-Hans": "保存更改",
    "zh-Hant": "儲存變更"
  },
  "Discard": {
    "zh-Hans": "放弃更改",
    "zh-Hant": "捨棄變更"
  },
  "Continue": {
    "zh-Hans": "继续",
    "zh-Hant": "繼續"
  },
  "Back": {
    "zh-Hans": "返回",
    "zh-Hant": "返回"
  },
  "Delete": {
    "zh-Hans": "删除",
    "zh-Hant": "刪除"
  },
  "Remove": {
    "zh-Hans": "移除",
    "zh-Hant": "移除"
  },
  "Edit": {
    "zh-Hans": "编辑",
    "zh-Hant": "編輯"
  },
  "Add new": {
    "zh-Hans": "新增",
    "zh-Hant": "新增"
  },
  "Title": {
    "zh-Hans": "标题",
    "zh-Hant": "標題"
  },
  "Task": {
    "zh-Hans": "任务",
    "zh-Hant": "工作"
  },
  "Saved Route": {
    "zh-Hans": "已保存路线",
    "zh-Hant": "已儲存路線"
  },
  "First run": {
    "zh-Hans": "首次运行",
    "zh-Hant": "首次執行"
  },
  "Repeat": {
    "zh-Hans": "重复",
    "zh-Hant": "重複"
  },
  "Enable schedule": {
    "zh-Hans": "启用计划",
    "zh-Hant": "啟用排程"
  },
  "Update and enable schedule": {
    "zh-Hans": "更新并启用计划",
    "zh-Hant": "更新並啟用排程"
  },
  "Save task as a Route": {
    "zh-Hans": "将任务保存为路线",
    "zh-Hant": "將工作儲存為路線"
  },
  "Run now": {
    "zh-Hans": "立即运行",
    "zh-Hant": "立即執行"
  },
  "Pause": {
    "zh-Hans": "暂停",
    "zh-Hant": "暫停"
  },
  "Review / edit": {
    "zh-Hans": "审阅 / 编辑",
    "zh-Hant": "檢閱 / 編輯"
  },
  "Open CLI": {
    "zh-Hans": "打开 CLI",
    "zh-Hant": "開啟 CLI"
  },
  "New tab": {
    "zh-Hans": "新建标签页",
    "zh-Hant": "新增分頁"
  },
  "New Terminal": {
    "zh-Hans": "新建终端",
    "zh-Hant": "新增終端機"
  },
  "New Browser Tab": {
    "zh-Hans": "新建浏览器标签页",
    "zh-Hant": "新增瀏覽器分頁"
  },
  "New Markdown file": {
    "zh-Hans": "新建 Markdown 文件",
    "zh-Hant": "新增 Markdown 檔案"
  },
  "Text editor": {
    "zh-Hans": "文本编辑器",
    "zh-Hant": "文字編輯器"
  },
  "Session history": {
    "zh-Hans": "会话历史",
    "zh-Hant": "工作階段記錄"
  },
  "Open tabs": {
    "zh-Hans": "已打开标签页",
    "zh-Hant": "已開啟分頁"
  },
  "Open": {
    "zh-Hans": "打开",
    "zh-Hant": "開啟"
  },
  "Source control": {
    "zh-Hans": "源代码管理",
    "zh-Hant": "原始碼控制"
  },
  "Worktrees": {
    "zh-Hans": "工作树",
    "zh-Hant": "工作樹"
  },
  "Repository tasks": {
    "zh-Hans": "仓库任务",
    "zh-Hant": "儲存庫工作"
  },
  "Browser": {
    "zh-Hans": "浏览器",
    "zh-Hant": "瀏覽器"
  },
  "Comments": {
    "zh-Hans": "评论",
    "zh-Hant": "註解"
  },
  "Reply": {
    "zh-Hans": "回复",
    "zh-Hant": "回覆"
  },
  "Resolve": {
    "zh-Hans": "解决",
    "zh-Hant": "解決"
  },
  "Reopen": {
    "zh-Hans": "重新打开",
    "zh-Hant": "重新開啟"
  },
  "Copy context": {
    "zh-Hans": "复制上下文",
    "zh-Hant": "複製上下文"
  },
  "Drag thread to CLI": {
    "zh-Hans": "将讨论拖到 CLI",
    "zh-Hant": "將討論拖曳至 CLI"
  },
  "Send to AI": {
    "zh-Hans": "发送给 AI",
    "zh-Hant": "傳送給 AI"
  },
  "Add note": {
    "zh-Hans": "添加笔记",
    "zh-Hant": "新增筆記"
  },
  "Unsaved": {
    "zh-Hans": "未保存",
    "zh-Hant": "未儲存"
  },
  "Outline": {
    "zh-Hans": "大纲",
    "zh-Hant": "大綱"
  },
  "Timeline": {
    "zh-Hans": "时间线",
    "zh-Hant": "時間軸"
  },
  "Code": {
    "zh-Hans": "代码",
    "zh-Hant": "程式碼"
  },
  "Changes": {
    "zh-Hans": "更改",
    "zh-Hant": "變更"
  },
  "Recent": {
    "zh-Hans": "最近",
    "zh-Hant": "最近"
  },
  "Preview": {
    "zh-Hans": "预览",
    "zh-Hant": "預覽"
  },
  "Go to Docs": {
    "zh-Hans": "前往文档",
    "zh-Hant": "前往說明文件"
  },
  "Explore features": {
    "zh-Hans": "探索功能",
    "zh-Hant": "探索功能"
  },
  "What’s New": {
    "zh-Hans": "最新动态",
    "zh-Hant": "最新消息"
  },
  "Check for updates": {
    "zh-Hans": "检查更新",
    "zh-Hant": "檢查更新"
  },
  "Check for Updates": {
    "zh-Hans": "检查更新",
    "zh-Hant": "檢查更新"
  },
  "Help": {
    "zh-Hans": "帮助",
    "zh-Hant": "說明"
  },
  "Contact us": {
    "zh-Hans": "联系我们",
    "zh-Hant": "聯絡我們"
  },
  "Hide files": {
    "zh-Hans": "隐藏文件",
    "zh-Hant": "隱藏檔案"
  },
  "Show files": {
    "zh-Hans": "显示文件",
    "zh-Hant": "顯示檔案"
  },
  "System": {
    "zh-Hans": "跟随系统",
    "zh-Hant": "跟隨系統"
  },
  "Dark": {
    "zh-Hans": "深色",
    "zh-Hant": "深色"
  },
  "Light": {
    "zh-Hans": "浅色",
    "zh-Hant": "淺色"
  },
  "Theme": {
    "zh-Hans": "主题",
    "zh-Hant": "主題"
  },
  "No matching settings": {
    "zh-Hans": "没有匹配的设置",
    "zh-Hant": "沒有符合的設定"
  },
  "No matching actions or open tabs.": {
    "zh-Hans": "没有匹配的操作或标签页。",
    "zh-Hant": "沒有符合的操作或分頁。"
  },
  "This language is a preview. Untranslated controls remain in English.": {
    "zh-Hans": "此语言为预览版，未翻译的控件仍显示英文。",
    "zh-Hant": "此語言為預覽版，未翻譯的控制項仍顯示英文。"
  },
  "Your files, comments, terminal output and embedded apps are never translated.": {
    "zh-Hans": "文件、评论、终端输出和嵌入应用的内容不会被翻译。",
    "zh-Hant": "檔案、註解、終端機輸出及內嵌應用程式的內容不會被翻譯。"
  },
  "Search languages": {"zh-Hans": "搜索语言", "zh-Hant": "搜尋語言"},
  "No matching languages.": {"zh-Hans": "没有匹配的语言。", "zh-Hant": "沒有符合的語言。"},
  "Full interface": {"zh-Hans": "完整界面", "zh-Hant": "完整介面"},
  "Interface preview": {"zh-Hans": "界面预览", "zh-Hant": "介面預覽"},
  "Formatting only": {"zh-Hans": "仅调整格式", "zh-Hant": "僅調整格式"},
  "To Do List": {"zh-Hans": "待办事项", "zh-Hant": "待辦事項"},
  "Changes apply immediately on this device. No restart is needed.": {
    "zh-Hans": "更改立即在此设备生效，无需重启。",
    "zh-Hant": "變更立即在此裝置生效，無需重新啟動。"
  }
};
export const INTERFACE_TRANSLATIONS=Object.freeze(Object.fromEntries(
  [...new Set([...Object.keys(CHINESE_TRANSLATIONS), ...Object.keys(SHELL_LANGUAGE_TRANSLATIONS), ...Object.keys(SETTINGS_LANGUAGE_TRANSLATIONS)])].map(text=>[
    text, Object.freeze({...CHINESE_TRANSLATIONS[text],...SHELL_LANGUAGE_TRANSLATIONS[text],...SETTINGS_LANGUAGE_TRANSLATIONS[text]}),
  ]),
));
export const LANGUAGE_KEY='frondose.interface-language.v1',LANGUAGE_EVENT='frondose:interface-language';
// Offline, source-only packs. Load just the selected language, and prefer
// reviewed UI terms to generated copy when both cover the same message.
const bundledLanguage={
  'zh-Hans':()=>import('./interface-copy/zh-Hans.json'),
  'zh-Hant':()=>import('./interface-copy/zh-Hant.json'),
  fr:()=>import('./interface-copy/fr.json'),
  de:()=>import('./interface-copy/de.json'),
  it:()=>import('./interface-copy/it.json'),
  ja:()=>import('./interface-copy/ja.json'),
  ko:()=>import('./interface-copy/ko.json'),
  'pt-BR':()=>import('./interface-copy/pt-BR.json'),
  es:()=>import('./interface-copy/es.json'),
};
const activePacks=new Map(),pendingPacks=new Map();
const productTerms=new Set(['Frondose','Codex','Claude Code','GitHub','Git','Chromium','Markdown','JavaScript','TypeScript']);
export function loadBundledInterfaceLanguage(locale){
  if(!Object.hasOwn(bundledLanguage,locale)||activePacks.has(locale))return;
  if(!pendingPacks.has(locale))pendingPacks.set(locale,bundledLanguage[locale]().then(module=>{
    activePacks.set(locale,module.default);
  }).finally(()=>pendingPacks.delete(locale)));
  return pendingPacks.get(locale);
}
export const normalizeInterfaceLanguage=value=>getInterfaceLanguage(value).id;
export const interfaceDocumentLanguage=value=>{const row=getInterfaceLanguage(value);return row.coverage==='locale-only'?'en':row.id;};
export function readInterfaceLanguage(){try{return normalizeInterfaceLanguage(globalThis.localStorage?.getItem(LANGUAGE_KEY));}catch{return 'en';}}
export function interfaceText(text,locale=readInterfaceLanguage()){
  if(typeof text!=='string'||locale==='en'||productTerms.has(text))return text;
  const language=normalizeInterfaceLanguage(locale),pack=activePacks.get(language);
  return (Object.hasOwn(INTERFACE_TRANSLATIONS,text)&&INTERFACE_TRANSLATIONS[text][language])||(pack&&Object.hasOwn(pack,text)&&pack[text])||text;
}
export function formatInterfaceText(source, values, locale=readInterfaceLanguage()){
  return interfaceText(source,locale).replace(/\{\{(\w+)\}\}/g,(placeholder,key)=>Object.hasOwn(values,key)?String(values[key]):placeholder);
}
export function interfaceSearchKey(text){return text.toLowerCase().normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').replace(/[’']/g,"'").trim();}
export function saveInterfaceLanguage(locale){const value=normalizeInterfaceLanguage(locale);globalThis.localStorage.setItem(LANGUAGE_KEY,value);globalThis.dispatchEvent(new Event(LANGUAGE_EVENT));return value;}
export function subscribeInterfaceLanguage(listener){
  const storage=event=>{
    if(event.key!==LANGUAGE_KEY&&event.key!==null)return;
    const ready=loadBundledInterfaceLanguage(readInterfaceLanguage());
    if(ready)ready.then(listener,listener);else listener();
  };
  globalThis.addEventListener(LANGUAGE_EVENT,listener);globalThis.addEventListener('storage',storage);
  return()=>{globalThis.removeEventListener(LANGUAGE_EVENT,listener);globalThis.removeEventListener('storage',storage);};
}
