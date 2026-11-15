export function articleText(article) {
  return [article.title, article.description, ...article.sections.flatMap(section => [section.title, ...(section.paragraphs ?? []), ...(section.steps ?? []), ...(section.bullets ?? []), section.note ?? '']), ...(article.sources || []).map(source => source.label)].join('\n');
}
export function articleMarkdown(article) {
  return `# ${article.title}\n\n${article.description}\n\n` + article.sections.map(section => `## ${section.title}\n\n${(section.paragraphs ?? []).join('\n\n')}${section.steps?.length ? '\n\n' + section.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''}${section.bullets?.length ? '\n\n' + section.bullets.map(s => `- ${s}`).join('\n') : ''}${section.note ? '\n\n> ' + section.note : ''}`).join('\n\n') + (article.sources?.length ? '\n\n## Provider references\n\n' + article.sources.map(source => `- [${source.label}](${source.url})`).join('\n') : '');
}
export function searchDocs(articles, query) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return articles;
  return articles.map(article => {
    const text = articleText(article).toLowerCase();
    return { article, score: tokens.every(t => text.includes(t)) ? tokens.reduce((sum, t) => sum + (article.title.toLowerCase().includes(t) ? 10 : article.description.toLowerCase().includes(t) ? 4 : 1), 0) : 0 };
  }).filter(r => r.score).sort((a,b) => b.score-a.score).map(r => r.article);
}

// Docs, What’s New and sibling navigation all follow the authored release
// sequence, including multiple builds on the same day. Preserve guide order.
export function docsArticlesInNavigationOrder(articles, releaseNotes) {
  const rank = new Map(releaseNotes.map((update, index) => [update.articleId, index]));
  const updates = articles.filter(article => article.group === 'updates')
    .sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
  let index = 0;
  return articles.map(article => article.group === 'updates' ? updates[index++] : article);
}
