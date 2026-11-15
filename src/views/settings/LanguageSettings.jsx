import {useId,useMemo,useRef,useState} from 'react';
import {Check,Globe,Search} from '../../components/icons.jsx';
import {useInterfaceLanguage} from '../../components/InterfaceLanguage.jsx';
import {getInterfaceLanguage,interfaceText,loadBundledInterfaceLanguage,saveInterfaceLanguage,searchInterfaceLanguages} from '../../lib/interface-language.js';
import './language-settings.css';

const coverageLabels={full:'Full interface',preview:'Interface preview','locale-only':'Formatting only'};

export function LanguageSettings(){
  const language=useInterfaceLanguage(),selected=getInterfaceLanguage(language);
  const [query,setQuery]=useState(''),[error,setError]=useState('');
  const selection=useRef(0);
  const headingId=useId(),helpId=useId(),groupId=useId();
  const t=text=>interfaceText(text,language);
  const rows=useMemo(()=>searchInterfaceLanguages(query),[query]);
  const sample=useMemo(()=>({
    date:new Intl.DateTimeFormat(language,{calendar:'gregory',dateStyle:'long',timeZone:'UTC'}).format(Date.UTC(2026,10,14)),
    number:new Intl.NumberFormat(language).format(1234.56),
  }),[language]);
  async function select(row){
    const request=++selection.current;
    try{
      await loadBundledInterfaceLanguage(row.id);
      if(selection.current===request){saveInterfaceLanguage(row.id);setError('');}
    }
    catch{if(selection.current===request)setError('The language could not be loaded or saved. Try again.');}
  }

  return <section className="language-settings" aria-labelledby={headingId}>
    <header><Globe interactive={false}/><div>
      <h1 id={headingId}>{t('Languages')}</h1>
      <p>{t('Changes apply immediately on this device. No restart is needed.')}</p>
    </div></header>
    <div className="language-settings-preference">
      <p><strong>{t('Interface language')}: </strong><bdi lang={selected.id}>{selected.label}</bdi> · {t(coverageLabels[selected.coverage])}</p>
      <p id={helpId}>{selected.coverage==='preview'?t('This language is a preview. Untranslated controls remain in English.'):selected.coverage==='locale-only'?'Calendar labels and format samples use this locale. The interface remains in English.':'English is available throughout the interface.'}</p>
      <p className="language-settings-samples" lang={language}><bdi>{sample.date}</bdi> <span aria-hidden="true">·</span> <bdi>{sample.number}</bdi></p>
    </div>
    <div className="language-picker">
      <label className="language-search"><Search interactive={false}/><input type="search" aria-label={t('Search languages')} placeholder={t('Search languages')+'…'} autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <fieldset aria-describedby={helpId}>
        <legend className="language-visually-hidden">{t('Interface language')}</legend>
        {rows.map(row=><label className="language-choice" key={row.id}>
          <input type="radio" name={groupId} value={row.id} checked={language===row.id} onChange={()=>select(row)}/>
          <span><strong><bdi lang={row.id}>{row.label}</bdi></strong><small lang="en">{row.englishName} · {row.id}</small></span>
          <span className="language-coverage">{t(coverageLabels[row.coverage])}</span>
          {language===row.id?<Check interactive={false}/>:<i aria-hidden="true"/>}
        </label>)}
        {!rows.length?<p role="status" className="language-empty">{t('No matching languages.')}</p>:null}
      </fieldset>
    </div>
    <p className="language-content-policy">{t('Your files, comments, terminal output and embedded apps are never translated.')}</p>
    {error?<p role="alert">{t(error)}</p>:null}
  </section>;
}
