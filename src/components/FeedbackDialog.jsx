import { useState } from 'react';
import { copyUserText } from '../lib/clipboard.js';
import { SUPPORT_LOG_SECTION } from '../lib/support-logs.js';
import { pageHash } from '../lib/navigation.js';
import { Button, Dialog } from '../ui.jsx';
import { Copy } from './icons.jsx';
import './help-menu.css';

const CONTACT_EMAIL = 'evanlu1108@gmail.com';

export function FeedbackDialog({ onClose, onOpenLogs }) {
  const [copyStatus, setCopyStatus] = useState('');

  async function copyEmail() {
    try {
      setCopyStatus(await copyUserText(CONTACT_EMAIL) ? 'Copied to clipboard' : 'Select and copy the email address.');
    } catch {
      setCopyStatus('Select and copy the email address.');
    }
  }

  return (
    <Dialog title="Contact us" className="rumbo-contact-dialog" onClose={onClose}>
      <div className="rumbo-contact-body">
        <p>For feedback, bug reports, or questions, email:</p>
        <strong dir="ltr" translate="no">{CONTACT_EMAIL}</strong>
        <Button type="button" icon={Copy} onClick={copyEmail}>Copy email address</Button>
        <p role="status">{copyStatus}</p>
        {onOpenLogs ? <p className="rumbo-contact-log">
          <a href={pageHash('settings', SUPPORT_LOG_SECTION)} onClick={event => {
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            onOpenLogs();
          }}>Go to support logs</a>
          <span>Copy the log for the date the problem happened and paste it into your email.</span>
        </p> : null}
      </div>
    </Dialog>
  );
}
