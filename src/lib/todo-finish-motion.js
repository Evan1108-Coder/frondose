// Only inert task-card pictures animate, never a live tool or editor.
export function fadeTodoCard(node){
 if(!node?.isConnected||document.documentElement.dataset.motion==='reduced'||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
 const rect=node.getBoundingClientRect();if(!rect.width||!rect.height)return;
 const picture=node.cloneNode(true);picture.inert=true;picture.setAttribute('aria-hidden','true');picture.removeAttribute('data-todo-id');picture.className='todo-finish-picture';
 Object.assign(picture.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',zIndex:1500,pointerEvents:'none',margin:0});
 if(!picture.animate)return;
 document.body.append(picture);
 const animation=picture.animate([{opacity:1},{opacity:0}],{duration:200,easing:'ease-out',fill:'forwards'});
 void animation.finished.then(()=>picture.remove(),()=>picture.remove());
}
