import { useState } from 'react';
import { Globe } from './icons.jsx';
import { safeWebsiteUrl, serviceBrand } from '../lib/service-brands.js';
import { websiteFavicon } from '../lib/document-markdown.js';
import './service-logo.css';

/** Brand identity, separate from Frondose's animated interface glyphs. */
export function ServiceLogo({ name, url, className = '' }) {
  const [failedSource, setFailedSource] = useState(null);
  const brand = serviceBrand(name, url);
  const website = safeWebsiteUrl(url);
  // Never disclose a resource path/query to a favicon aggregator or fetch on the server.
  const src = brand?.src ?? (website ? websiteFavicon(website.href) : null);
  return <span className={`service-logo ${className}`} data-service={brand?.id ?? 'website'} aria-hidden="true">
    {src && brand?.rendering === 'mask' ? <span className="service-logo-mark" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }} /> : src && failedSource !== src ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailedSource(src)} /> : <Globe interactive={false} />}
  </span>;
}
