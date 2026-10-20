import { Activity, ArrowLeft, Clock, Ellipsis, MessageCircle, PanelLeft, Pin, Search, Terminal, X } from './icons.jsx';
import { Button, IconButton } from '../ui.jsx';
import './conversation-toolbar.css';

/** Compact controls only; the global breadcrumb already names the conversation. */
export function ConversationToolbar({ onBack, bookmarksOnly, inThread, bookmarkCount, onConversation, onBookmarks, onNativeTools, onUpdates, followUpCount, onFollowUps, searchOpen, onSearch, onContext, onOptions }) {
  return <header className="conversation-toolbar" role="group" aria-label="Conversation toolbar">
    <div className="conversation-toolbar-views" role="group" aria-label="Conversation views">
      <IconButton label="Back to conversations" onClick={onBack} disabled={!onBack}><ArrowLeft /></IconButton>
      <IconButton label="Conversation" aria-pressed={!bookmarksOnly && !inThread} onClick={onConversation}><MessageCircle /></IconButton>
      <IconButton label={bookmarkCount ? `Bookmarks (${bookmarkCount})` : 'Bookmarks'} aria-pressed={bookmarksOnly} onClick={onBookmarks}><Pin /></IconButton>
      <IconButton className="icon-button conversation-toolbar-secondary" label="Native tools" aria-haspopup="dialog" onClick={onNativeTools}><Terminal /></IconButton>
      <IconButton className="icon-button conversation-toolbar-secondary" label="Conversation updates" aria-haspopup="dialog" onClick={onUpdates}><Activity /></IconButton>
      {followUpCount ? <IconButton className="icon-button conversation-toolbar-secondary" label={`Saved follow-ups (${followUpCount})`} aria-haspopup="dialog" onClick={onFollowUps}><Clock /></IconButton> : null}
    </div>
    <div className="conversation-toolbar-actions" role="group" aria-label="Conversation tools">
      <IconButton label={searchOpen ? 'Close message search' : 'Search messages'} aria-pressed={searchOpen} onClick={onSearch}><Search morphTo={searchOpen ? X : Search} /></IconButton>
      <Button className="button ghost conversation-context-button" icon={PanelLeft} aria-label="Context" aria-haspopup="dialog" onClick={onContext}><span>Context</span></Button>
      <IconButton label="Conversation options" aria-haspopup="dialog" onClick={onOptions}><Ellipsis /></IconButton>
    </div>
  </header>;
}
