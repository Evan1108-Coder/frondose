import {parse} from '@babel/parser';
import {readdirSync,readFileSync} from 'node:fs';
import {INTERFACE_TRANSLATIONS} from '../src/lib/interface-language.js';
const protectedTags=new Set(['pre','code','script','style','title']);
const chromeAttrs=new Set(['aria-label','aria-description','aria-valuetext','placeholder','title','alt']);
const uiProps={
 Button:['label'], IconButton:['label'], Dialog:['subtitle'], Empty:['description','action'], EmptyState:['description','label','action'],
 PageHeader:['description','eyebrow'], Field:['label','hint'], SearchField:['label'], Tooltip:['label'], ConfirmDialog:['description','confirmLabel','cancelLabel'],
 Heading:['description'], Group:[], Row:['description'], LinkRow:['description','label'], Toggle:['label','description'],
};
const packDir=new URL('../src/lib/interface-copy/',import.meta.url);
const packKeys=new Set(readdirSync(packDir).filter(file=>file.endsWith('.json')).flatMap(file=>Object.keys(JSON.parse(readFileSync(new URL(file,packDir),'utf8')))));
const translated=text=>typeof text==='string'&&(Object.hasOwn(INTERFACE_TRANSLATIONS,text)||packKeys.has(text));

// Only literals which are already being presented, never arbitrary expressions
// or entity data. A dynamic branch stays untouched even if it matches a key.
function displayLeaves(node){
 if(!node)return [];
 if(node.type==='StringLiteral')return [node];
 if(node.type==='ConditionalExpression')return [...displayLeaves(node.consequent),...displayLeaves(node.alternate)];
 if(node.type==='LogicalExpression')return displayLeaves(node.right);
 return [];
}
function literalAlternatives(node){
 if(!node)return [];
 if(node.type==='StringLiteral')return [node];
 if(node.type==='NullLiteral'||node.type==='BooleanLiteral'||node.type==='Identifier'&&node.name==='undefined')return [];
 if(node.type!=='ConditionalExpression')return null;
 const a=literalAlternatives(node.consequent),b=literalAlternatives(node.alternate);
 return a&&b?[...a,...b]:null;
}

// Match JSX's line/space handling; never change meaningful inline whitespace.
function jsxText(value){
 const lines=value.split(/\r\n|\n|\r/),last=lines.findLastIndex(line=>/[^ \t]/.test(line));
 return lines.map((line,index)=>{
  line=line.replace(/\t/g,' ');
  if(index>0)line=line.replace(/^ +/,'');
  if(index<lines.length-1)line=line.replace(/ +$/,'');
  return line&&(index!==last&&index<last?line+' ':line);
 }).join('');
}

// Only catalogued source literals opt in. Expressions (including spread overrides),
// IDs, input values and the contents of user/code surfaces are not translated.
function scanInterfaceSource(source,id,record){
 if(!id.replaceAll('\\','/').includes('/src/')||!id.endsWith('.jsx')||id.endsWith('/InterfaceLanguage.jsx')||id.endsWith('/LanguageSettings.jsx'))return null;
 const ast=parse(source,{sourceType:'module',plugins:['jsx']}),edits=[];
 function known(copy,node){
  if(typeof copy!=='string'||!copy)return false;
  if(record){if(/\p{L}/u.test(copy))record(copy,node.loc.start.line);return false;}
  return translated(copy);
 }
 function walk(node,blocked=false){if(!node||typeof node!=='object')return;
  if(record&&node.type==='CallExpression'&&['t','interfaceText','formatInterfaceText','notify'].includes(node.callee?.name)){
   for(const literal of displayLeaves(node.arguments[0]))known(literal.value,literal);
  }
  if(!record&&node.type==='CallExpression'&&node.callee?.name==='notify'){
   for(const literal of displayLeaves(node.arguments[0]))if(known(literal.value,literal))edits.push({start:literal.start,end:literal.end,value:`frondoseTranslateNotice(${JSON.stringify(literal.value)})`});
  }
  if(node.type==='JSXElement'){
   const {openingElement:open,closingElement:close,children}=node,name=open.name?.name;
   blocked=blocked||protectedTags.has(name)||open.attributes.some(a=>a.name?.name==='data-interface-language-exclude');
   if(blocked)return;
   const attrs=[];
   if(name)for(const a of open.attributes){
    const field=a.name?.name;
    // A later spread/duplicate can supply user data even if it equals this literal.
    if((chromeAttrs.has(field)||(Object.hasOwn(uiProps,name)&&uiProps[name].includes(field)))&&
     !open.attributes.slice(open.attributes.indexOf(a)+1).some(later=>later.type==='JSXSpreadAttribute'||later.name?.name===field)){
      const values=literalAlternatives(a.value?.expression??a.value)?.filter(leaf=>known(leaf.value,leaf)).map(leaf=>leaf.value)??[];
      if(values.length)attrs.push([field,...values]);
    }
   }
   const optionValue=name==='option'&&open.attributes.findLast(a=>a.name?.name==='value'||a.type==='JSXSpreadAttribute');
   const hasOptionValue=optionValue?.name?.name==='value'&&(optionValue.value?.type==='StringLiteral'||['StringLiteral','NumericLiteral'].includes(optionValue.value?.expression?.type));
   const optionText=hasOptionValue&&children.length===1&&children[0].type==='JSXText'?jsxText(children[0].value):null;
   const localOption=known(optionText,open);
   if(attrs.length||localOption){
    const tag=/^[a-z]/.test(name)?JSON.stringify(name):name;
    const end=open.attributes.at(-1)?.end??open.name.end;
    edits.push({start:open.name.start,end:open.name.end,value:'FrondoseInterfaceElement'});
    edits.push({start:end,end,value:` interfaceElementType={${tag}} interfaceFields={${JSON.stringify(attrs)}}${localOption?` interfaceOptionText={${JSON.stringify(optionText)}}`:''}`});
    if(close) edits.push({start:close.name.start,end:close.name.end,value:'FrondoseInterfaceElement'});
   }
   if(name==='option'||name==='textarea')return;
  }
  if(node.type==='JSXText'&&!blocked){const normalized=jsxText(node.value),copy=normalized.trim();if(known(copy,node)){const left=normalized.match(/^\s*/)[0],right=normalized.match(/\s*$/)[0];edits.push({start:node.start,end:node.end,value:(left?`{${JSON.stringify(left)}}`:'')+`<FrondoseInterfaceText text={${JSON.stringify(copy)}}/>`+(right?`{${JSON.stringify(right)}}`:'')});}return;}
  for(const [key,value]of Object.entries(node)){
   if(['loc','start','end','extra','comments','tokens'].includes(key))continue;
   if(Array.isArray(value))for(const child of value){
    if(key==='children'&&child?.type==='JSXExpressionContainer')for(const literal of displayLeaves(child.expression)){
     const copy=literal.value.trim();
     if(known(copy,literal))edits.push({start:literal.start,end:literal.end,value:`<FrondoseInterfaceText text={${JSON.stringify(copy)}} prefix={${JSON.stringify(literal.value.match(/^\s*/)[0])}} suffix={${JSON.stringify(literal.value.match(/\s*$/)[0])}}/>`});
    }
    walk(child,blocked);
   }else if(value&&typeof value==='object')walk(value,blocked);
  }
 }walk(ast);if(!edits.length)return null;let result=source;for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.value+result.slice(edit.end);return 'import {InterfaceText as FrondoseInterfaceText,InterfaceElement as FrondoseInterfaceElement} from "/src/components/InterfaceLanguage.jsx";\nimport {interfaceText as frondoseTranslateNotice} from "/src/lib/interface-language.js";\n'+result;
}
export const transformInterfaceText=(source,id)=>scanInterfaceSource(source,id);
export function collectInterfaceSourceCopy(source,id){
 const copy=[];scanInterfaceSource(source,id,(text,line)=>copy.push({text,line}));return copy;
}
export function interfaceLanguageSourcePlugin(){return{name:'frondose-interface-language',enforce:'pre',transform(source,id){const code=transformInterfaceText(source,id.split('?')[0]);return code?{code,map:null}:null;}};}
