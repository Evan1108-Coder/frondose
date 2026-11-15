export function scrollToDocsSection(element) {
 if(!element)return;
 const reduced=document.documentElement.dataset.motion==='reduced'||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 element.scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'});
}
