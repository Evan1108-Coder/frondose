import { useState } from 'react';
import { useApp, PageHeader } from '../../ui.jsx';
import { DocumentContent } from '../DocumentContent.jsx';
import { val } from '../../lib/model.js';

/** Compatibility reader only. Retiring chat chrome never erases authored history. */
export function HistoricalConversations() {
  const { data, page, navigate } = useApp();
  const [query,setQuery]=useState('');
  const chat=data.chats.find(item=>item.id===page.id);
  if(chat)return <main className="page workspace-history"><button className="text-button" onClick={()=>navigate('chats')}>All historical conversations</button><PageHeader title={chat.title}/><p className="muted">Preserved history · read only. New work uses agent or AI CLI session tabs.</p>{data.messages.filter(message=>val(message,'chat_id')===chat.id).map(message=><article key={message.id}><strong>{message.role==='user'?'You':message.role||'Agent'}</strong><DocumentContent content={message.content||message.text||''} showLinkIcons={false}/></article>)}</main>;
  return <main className="page workspace-history"><PageHeader title="Historical conversations" description="Your existing conversations remain readable. New work lives in session tabs."/><input aria-label="Search historical conversations" placeholder="Find a conversation…" value={query} onChange={event=>setQuery(event.target.value)}/>{data.chats.filter(chat=>!chat.archived_at&&chat.title.toLowerCase().includes(query.toLowerCase())).map(chat=><button className="workspace-history-row" key={chat.id} onClick={()=>navigate('chats',chat.id)}>{chat.title}</button>)}</main>;
}
