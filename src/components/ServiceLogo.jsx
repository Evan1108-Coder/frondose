import { useState } from 'react';
import { Link } from './icons.jsx';
import { safeWebsiteUrl, serviceBrand } from '../lib/service-brands.js';

/** Brand identity, separate from Rumbo's animated interface glyphs. */
export function ServiceLogo({ name, url, className = '' }) {
  const [failedSource, setFailedSource] = useState(null);
  const brand = serviceBrand(name, url);
  const website = safeWebsiteUrl(url);
  // Never disclose a resource path/query to a favicon aggregator or fetch on the server.
  const src = brand?.src ?? (website ? `${website.origin}/favicon.ico` : null);
  return <span className={`service-logo ${className}`} data-service={brand?.id ?? 'website'} aria-hidden="true">
    {src && failedSource !== src ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailedSource(src)} /> : <Link />}
  </span>;
}
