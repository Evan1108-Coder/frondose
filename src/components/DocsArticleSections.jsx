import { BookOpen } from './icons.jsx';

/** Shared authored handbook content, without route changes or workspace reads. */
export function DocsArticleSections({ article, idPrefix = 'doc-section-' }) {
  return article.sections.map(section => <section key={section.id} id={`${idPrefix}${section.id}`} data-section={section.id}>
    <h2>{section.title}</h2>
    {section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {section.steps?.length ? <ol>{section.steps.map((step, index) => <li key={index}>{step}</li>)}</ol> : null}
    {section.bullets?.length ? <ul>{section.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul> : null}
    {section.note ? <aside className="docs-note"><BookOpen /><p>{section.note}</p></aside> : null}
  </section>);
}
