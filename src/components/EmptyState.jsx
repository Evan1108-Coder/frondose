import { Archive, BookOpen, MessageCircle, Clock, Folder, GitBranch, Search, Bot, Terminal, Inbox, Users } from './icons.jsx';
import { emptyArtKinds, emptyArtAliases } from './empty-art-catalog.js';
import './empty-state.css';

const iconKinds = new Map([
  [Archive, 'archive'], [BookOpen, 'memory'], [MessageCircle, 'chats'],
  [Clock, 'work'], [Folder, 'projects'], [GitBranch, 'routes'],
  [Search, 'search'], [Bot, 'agents'], [Terminal, 'work'],
  [Inbox, 'inbox'], [Users, 'teams'],
]);
const kindSet = new Set(emptyArtKinds);

export const EMPTY_ART_KINDS = emptyArtKinds;
export function resolveEmptyArtKind(kind) {
  const resolved = emptyArtAliases[kind] ?? kind;
  return kindSet.has(resolved) ? resolved : 'overview';
}

export function EmptyIllustration({ kind = 'overview' }) {
  const resolved = resolveEmptyArtKind(kind);
  const source = `/empty-art/${resolved}.webp`;
  return <span
    className="empty-illustration"
    data-empty-kind={resolved}
    style={{ '--empty-art-source': `url("${source}")` }}
    aria-hidden="true"
  >
    <img src={source} width="600" height="400" alt="" decoding="async" />
    <span className="empty-illustration-tint" />
  </span>;
}

export function EmptyState({
  icon: Icon, kind, title, description, action, onAction,
  secondaryAction, onSecondaryAction, actionVariant, compact = false,
}) {
  const illustrationKind = kind ?? iconKinds.get(Icon) ?? 'overview';
  return <div className={`empty-state rumbo-empty ${compact ? 'compact' : 'page-empty'}`}>
    <div className="empty-art"><EmptyIllustration kind={illustrationKind} /></div>
    <div className="empty-copy">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {(action && onAction) || (secondaryAction && onSecondaryAction) ? <div className="empty-actions">
        {action && onAction ? <button className={`button ${actionVariant ?? (compact ? 'secondary' : 'primary')}`} type="button" onClick={onAction}>{action}</button> : null}
        {secondaryAction && onSecondaryAction ? <button className="button secondary" type="button" onClick={onSecondaryAction}>{secondaryAction}</button> : null}
      </div> : null}
    </div>
  </div>;
}
