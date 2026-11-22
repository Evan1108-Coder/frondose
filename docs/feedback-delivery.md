# Feedback delivery

Help → Contact us accepts a message, optional reply email, and attachments.
The text (UTF-8 bytes) and files must total **less than 20 MB** together.
The email address is a separate header, not part of that payload budget. Reports
leave the device only after the user clicks **Send feedback**. The app keeps
failed drafts open and does not save or upload them in the background.

| Customer leaves an email | From | To | Reply-To |
| --- | --- | --- | --- |
| Yes | forms@frondose.com | support@frondose.com | The customer's email |
| No | forms@frondose.com | support@frondose.com | Not set |

The desktop main process posts to `https://forms.frondose.com/report` via a
narrow native bridge. It neither accepts a caller-supplied URL nor holds a
mail API key. The separate Cloudflare Worker validates and rate-limits the
request, sets all routing fields itself, and calls Resend. It sends plain text
and directly supplied attachments only (no remote file URLs). Resend may reject
unsupported file types; the app retains the draft if the provider doesn't
accept it.

## Enable later

1. Set up the receiving `support@frondose.com` mailbox. Verify `frondose.com`
   as a sending domain in Resend, then create a domain-scoped sending key.
2. Use Wrangler 4.36 or later with [wrangler.report.toml](../wrangler.report.toml).
   Assign unique rate-limit namespace IDs for your Cloudflare account and use
   the `forms.frondose.com` custom domain. Put the API key in the Worker secret
   `RESEND_API_KEY` (for example, `npx wrangler secret put RESEND_API_KEY --config
   wrangler.report.toml`). Never put the key in source, desktop settings, or
   the website bundle.
3. Keep `FEEDBACK_ENABLED` false until the sender, inbox, secret, and rate
   limits are ready. Set it to `"true"` in the Worker config when ready to
   deploy that separate Worker. This endpoint is intentionally anonymous;
   Cloudflare's limits are approximate and per location. Verify abuse
   protection and alerts on the public route before exposing it broadly.
4. Enable [desktop/report-config.json](../desktop/report-config.json) and build
   a desktop test package. Send one test report with an address and another
   without, and confirm the actual email envelope, received attachments and
   Reply action before enabling this in a public build. If setup is incomplete,
   leave the desktop config false; the form can still be drafted locally.

No report endpoint is deployed by the existing Sites build. The Worker does
not intentionally log report contents; follow the provider and inbox retention
policies. Retries of an unchanged draft use Resend's idempotency key.

References: [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
· [attachment limits](https://resend.com/docs/dashboard/emails/attachments)
· [Cloudflare Worker rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
