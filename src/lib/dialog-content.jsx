import { Children, Fragment, cloneElement, isValidElement } from 'react';

const COPY_TAGS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'pre', 'blockquote', 'table']);

/** Give legacy bare confirmation copy/fields the same body and action spacing.
 * Authored wrappers, forms, readers and their handlers remain untouched. */
export function layoutDialogContent(children, { Field, Button, ErrorMessage } = {}) {
  const flattened = [];
  function flatten(nodes, prefix = '') {
    Children.toArray(nodes).forEach(node => {
      if (isValidElement(node) && node.type === Fragment) flatten(node.props.children, prefix + node.key + '/');
      else flattened.push(prefix && isValidElement(node) ? cloneElement(node, { key: prefix + node.key }) : node);
    });
  }
  flatten(children);
  const result = []; let group = [], kind = null;
  function flush() {
    if (!group.length) return;
    const className = kind === 'actions' ? 'dialog-footer' : 'dialog-body';
    result.push(<div className={className} key={'dialog-group-' + result.length}>{group}</div>);
    group = []; kind = null;
  }
  for (const node of flattened) {
    const element = isValidElement(node);
    if (element && ErrorMessage && node.type === ErrorMessage) {
      if (group.length && kind === 'body') group.push(node); else result.push(node);
      continue;
    }
    const next = element && Button && node.type === Button ? 'actions'
      : typeof node === 'string' || typeof node === 'number' || element && (COPY_TAGS.has(node.type) || Field && node.type === Field) ? 'body' : null;
    if (!next) { flush(); result.push(node); continue; }
    if (kind !== next) flush();
    kind = next; group.push(node);
  }
  flush();
  return result;
}
