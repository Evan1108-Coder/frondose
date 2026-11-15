/** Clipboard writes are explicit UI actions. The native bridge writes only;
 * browser guests never receive it. A denied browser write is not a success. */
export async function copyUserText(text,{desktop=globalThis.frondoseDesktop,clipboard=globalThis.navigator?.clipboard}={}){
  if(typeof text!=='string'||text.length>100000||text.includes('\0'))throw Error('This text cannot be copied.');
  if(desktop?.clipboard?.writeText){await desktop.clipboard.writeText(text);return true;}
  try{if(!clipboard?.writeText)return false;await clipboard.writeText(text);return true;}catch{return false;}
}
