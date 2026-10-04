import { useState } from 'react';
import { Dialog, useApp } from '../ui.jsx';
import { Focus, Search, Settings } from './icons.jsx';
import { initials } from '../lib/model.js';
import './global-toolbar.css';

export function GlobalToolbar({ onSearch }) {
  const { data, navigate, page } = useApp();
  const [languageOpen, setLanguageOpen] = useState(false);
  return <div className="global-toolbar" aria-label="Workspace tools">
    <button type="button" className="global-search" onClick={onSearch} aria-label="Search all Rumbo content, settings, and documentation"><Search aria-hidden="true" /><span>Search</span><kbd>⌘ K</kbd></button>
    <button type="button" className="global-tool" aria-label="Open Focus" aria-current={page.view === 'focus' ? 'page' : undefined} onClick={() => navigate('focus')}><Focus aria-hidden="true" /></button>
    <button type="button" className="global-tool" aria-label="Open Settings" aria-current={page.view === 'settings' ? 'page' : undefined} onClick={() => navigate('settings', 'preferences')}><Settings aria-hidden="true" /></button>
    <button type="button" className="global-language" aria-label="Interface language" onClick={() => setLanguageOpen(true)}>EN</button>
    <button type="button" className="global-profile" aria-label="Open your profile" onClick={() => navigate('settings', 'profile')}>{data.profile?.avatar_url ? <img src={data.profile.avatar_url} alt="" /> : initials(data.profile?.name)}</button>
    {languageOpen ? <Dialog title="Interface language" onClose={() => setLanguageOpen(false)}><div className="global-language-dialog"><p>English is the only complete interface translation in this build. Other languages need reviewed translations across the whole app before they can be offered here.</p><button type="button" onClick={() => setLanguageOpen(false)}>Continue in English</button></div></Dialog> : null}
  </div>;
}
