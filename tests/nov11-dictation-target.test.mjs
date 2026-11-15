import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDictationTarget,insertDictation} from '../src/lib/dictation-target.js';
class Input extends EventTarget {
  constructor(){super();this.tagName='TEXTAREA';this._value='Hello world';this.selectionStart=6;this.selectionEnd=11;this.isConnected=true;this.maxLength=100;this.name='message';this.id='message';this.autocomplete='off';this.blocked=false;}
  get value(){return this._value;}set value(value){this._value=value;}
  getAttribute(){return 'Message';}closest(){return this.blocked?{}:null;}
  focus(){this.focused=true;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
}
test('Dictation inserts into the unchanged original composer selection and never submits',t=>{
  const previous=globalThis.HTMLTextAreaElement;globalThis.HTMLTextAreaElement=Input;t.after(()=>{globalThis.HTMLTextAreaElement=previous;});
  const input=new Input();let changed=0,submitted=0;input.addEventListener('input',()=>changed++);input.addEventListener('submit',()=>submitted++);
  insertDictation(captureDictationTarget(input),'Frondose');assert.equal(input.value,'Hello Frondose');assert.equal(changed,1);assert.equal(submitted,0);assert.equal(input.selectionStart,14);assert(input.focused);
});
test('Dictation rejects changed, private, disabled, disconnected and overlength inputs',t=>{
  const previous=globalThis.HTMLTextAreaElement;globalThis.HTMLTextAreaElement=Input;t.after(()=>{globalThis.HTMLTextAreaElement=previous;});
  const input=new Input(),target=captureDictationTarget(input);input.value='User edited this';assert.throws(()=>insertDictation(target,'text'),/changed/);
  for(const update of [{name:'api_key'},{type:'password',tagName:'INPUT'},{disabled:true},{readOnly:true},{blocked:true}])assert.equal(captureDictationTarget(Object.assign(new Input(),update)),null);
  const gone=new Input(),old=captureDictationTarget(gone);gone.isConnected=false;assert.throws(()=>insertDictation(old,'text'),/unavailable/);
  const short=new Input();short.maxLength=12;assert.throws(()=>insertDictation(captureDictationTarget(short),'too much text'),/length limit/);
});
