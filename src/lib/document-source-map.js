/** HAST text nodes retain parser source offsets. Only exact leaf mappings are
 * selectable; generated math, image placeholders and decoded entities never
 * silently invent offsets. The range between two exact leaves may span blocks. */
export function rehypeSourceText(){return tree=>{let count=0;const visit=node=>{if(!Array.isArray(node.children)||['pre','code','script','style'].includes(node.tagName))return;node.children=node.children.map(child=>{const start=child.position?.start?.offset,end=child.position?.end?.offset;if(child.type==='text'&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&++count<=20000)return {type:'element',tagName:'span',properties:{'data-source-text-start':start,'data-source-text-end':end},children:[child]};visit(child);return child;});};visit(tree);};}
export function exactTextOffset(content,start,end,visible,offset){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!Number.isSafeInteger(offset)||start<0||end>content.length||offset<0||offset>visible.length||content.slice(start,end)!==visible)return null;return start+offset;}
export function selectedDocumentRange(article,range,content){
 const boundary=(container,offset,isEnd)=>{
  let node=container,at=offset;
  if(node.nodeType!==3){node=node.childNodes[isEnd?offset-1:offset];if(!node)return null;while(node.nodeType!==3){node=isEnd?node.lastChild:node.firstChild;if(!node)return null;}at=isEnd?node.textContent.length:0;}
  if(!article.contains(node))return null;const span=node.parentElement?.closest('[data-source-text-start]');if(!span||!article.contains(span))return null;
  const prefix=document.createRange();prefix.selectNodeContents(span);prefix.setEnd(node,at);
  return exactTextOffset(content,Number(span.dataset.sourceTextStart),Number(span.dataset.sourceTextEnd),span.textContent,prefix.toString().length);
 };
 const start=boundary(range.startContainer,range.startOffset,false),end=boundary(range.endContainer,range.endOffset,true);
 return start!==null&&end!==null&&end>start&&end-start<=4000?{start,end}:null;
}

export function documentRangeForSource(article,content,start,end){
 if(!article||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>content.length)return null;
 const spans=[...article.querySelectorAll('[data-source-text-start]')];
 const boundary=(offset,isEnd)=>{for(const span of spans){const from=Number(span.dataset.sourceTextStart),to=Number(span.dataset.sourceTextEnd);if(offset<from||offset>to||!isEnd&&offset===to||isEnd&&offset===from||exactTextOffset(content,from,to,span.textContent,offset-from)===null)continue;const walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);let node,remaining=offset-from;while(node=walker.nextNode()){if(remaining<=node.textContent.length)return{node,offset:remaining};remaining-=node.textContent.length;}}return null;};
 const a=boundary(start,false),b=boundary(end,true);if(!a||!b)return null;const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return range;
}
