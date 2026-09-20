import { useMemo } from 'react';
import { ChangeReview } from './ChangeReview.jsx';
import { textPatch } from '../lib/change-review.js';

export function RevisionComparison({ before, after, base, head, title, path = 'revision.md' }) {
  const comparison = useMemo(() => ({ source: 'document', title, base, head, notice: 'Saved text revisions. Existing comments and approval decisions remain attached to their original versions.', files: [{ path, status: 'modified', patch: textPatch(before || '', after || '') }] }), [before, after, base, head, title, path]);
  return <ChangeReview comparison={comparison} />;
}
