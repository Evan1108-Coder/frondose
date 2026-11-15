import {useEffect,useSyncExternalStore} from 'react';
import {interfaceDocumentLanguage,interfaceText,readInterfaceLanguage,subscribeInterfaceLanguage} from '../lib/interface-language.js';
export function useInterfaceLanguage(){return useSyncExternalStore(subscribeInterfaceLanguage,readInterfaceLanguage,()=> 'en');}
export function InterfaceText({text,prefix='',suffix=''}){const language=useInterfaceLanguage();return prefix+interfaceText(text,language)+suffix;}
export function InterfaceElement({interfaceElementType:Element, interfaceFields, interfaceOptionText, ...props}){
  const language=useInterfaceLanguage();
  for(const [field,...sources] of interfaceFields) {
    if(sources.includes(props[field]))props[field]=interfaceText(props[field],language);
  }
  if(interfaceOptionText!==undefined) props.children=interfaceText(interfaceOptionText,language);
  return <Element {...props}/>;
}
export function InterfaceLanguageDocument(){const language=interfaceDocumentLanguage(useInterfaceLanguage());useEffect(()=>{document.documentElement.lang=language;},[language]);return null;}
