import { ArrowRight } from './icons.jsx';
import { Button, Dialog } from '../ui.jsx';
import { DocsArticleSections } from './DocsArticleSections.jsx';
import './release-reader.css';

export function ReleaseReader({ update, article, onClose, onOpenDocs }) {
  return <Dialog title={article?.title ?? 'Update unavailable'} subtitle="What’s new in Frondose" onClose={onClose} className="release-reader">{closeDialog => <>
    <div className="release-reader-scroll">
      {article ? <>
        {update.cover ? <figure className="release-reader-cover"><img src={update.cover} alt={update.coverAlt ?? ''} width="1536" height="1024" /><figcaption>{update.coverCaption}</figcaption></figure> : <div className="release-reader-brand"><img src="/brand/frondose-frond-icon.png" width="72" height="72" alt="Frondose" /></div>}
        <article className="release-reader-article"><time dateTime={update.date}>{new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${update.date}T00:00:00Z`))}</time><p className="release-reader-lead">{article.description}</p><DocsArticleSections article={article} idPrefix={`release-${update.id}-`} /></article>
      </> : <p className="release-reader-unavailable">This update’s article is unavailable in this build. Browse Docs to find the current guides.</p>}
    </div>
    <footer className="release-reader-footer"><Button onClick={() => closeDialog()}>Back to work</Button><Button variant="primary" onClick={() => closeDialog(onOpenDocs)}>Go to Docs<ArrowRight /></Button></footer>
  </>}</Dialog>;
}
