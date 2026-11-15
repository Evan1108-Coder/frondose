export function captureDictationTarget(element) {
  if (!element || !['INPUT', 'TEXTAREA'].includes(element.tagName) || element.disabled || element.readOnly || element.closest('[data-dictation-exclude="true"], .cm-editor') || element.tagName === 'INPUT' && !['text', 'search', ''].includes(element.type) || /password|token|secret|credential|api.?key|account|url|address/i.test([element.name, element.id, element.autocomplete, element.getAttribute('aria-label')].join(' '))) return null;
  return { element, value: element.value, start: element.selectionStart ?? element.value.length, end: element.selectionEnd ?? element.value.length };
}
export function insertDictation(target, text) {
  const element = target?.element;
  if (!element?.isConnected || element.value !== target.value || !captureDictationTarget(element)) throw Error('The original input changed or is unavailable. Copy the transcript instead.');
  if(typeof text!=='string'||text.length>50000||text.includes('\0'))throw Error('The transcript is invalid or too long.');
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const next = target.value.slice(0, target.start) + text + target.value.slice(target.end);
  if(Number.isInteger(element.maxLength)&&element.maxLength>=0&&next.length>element.maxLength)throw Error('The transcript exceeds this input’s length limit. Shorten it or copy it instead.');
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, next);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.focus(); element.setSelectionRange(target.start + text.length, target.start + text.length);
}
