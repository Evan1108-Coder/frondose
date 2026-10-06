import { useId } from 'react';
import './link-hover-preview.css';

// A destination reveal, not a screenshot. It only presents metadata the caller
// already knows and never loads the linked page in the background.
export function LinkHoverPreview({ href, title, description, className = '', children }) {
  const previewId = useId();
  let destination;
  try {
    destination = new URL(href);
    if (!['http:', 'https:'].includes(destination.protocol)) destination = null;
  } catch { destination = null; }
  if (!destination) return <span className={className}>{children}</span>;
  const location = `${destination.host}${destination.pathname === '/' ? '' : destination.pathname}`;
  return <span className="link-hover-preview">
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-describedby={previewId}>{children}</a>
    <span className="link-hover-preview-card" id={previewId} role="note">
      <span className="link-hover-preview-domain">{location}</span>
      <strong>{title || destination.host}</strong>
      {description ? <small>{description}</small> : null}
    </span>
  </span>;
}
