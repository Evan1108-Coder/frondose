import { Fragment } from 'react';
import { ChevronRight } from './icons.jsx';
import { breadcrumbItems } from '../lib/reader-content.js';
import './breadcrumbs.css';

export function Breadcrumbs({ page, workspace, data, navigate, labels }) {
  const items = breadcrumbItems({ page, workspace, data, labels });
  return <nav className="breadcrumbs app-breadcrumbs" aria-label="Breadcrumb">{items.map((item, index) => <Fragment key={`${index}-${item.label}`}>
    {index ? <ChevronRight aria-hidden="true" /> : null}
    {item.current ? <strong aria-current="page" title={item.label}>{item.label}</strong> : <button type="button" title={item.label} onClick={() => navigate(item.view, item.id, item.options)}>{item.label}</button>}
  </Fragment>)}</nav>;
}
