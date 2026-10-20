# Personal agent capabilities

Talvori now brings conversations, recorded Activity and Scheduled work together.
It can reuse explicitly selected past messages and propose reviewed schedule
changes. It is not an OpenAI Your dot integration or full replacement.

OpenAI describes Your dot as coordinating background work, searching prior
conversations, retaining notes, and following scheduled or supported events.
Its Activity and Scheduled views distinguish active work from future work.
Sources: [Tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory),
[Control your dot](https://learn.chatgpt.com/docs/dots/controls).

## Current comparison

| Capability | Talvori status | Boundary |
| --- | --- | --- |
| Chat with connected agents | Implemented | Each user authorizes their own supported provider. Account verification and model entitlement are separate. |
| Inspect ongoing work and results | Implemented | Talvori → Activity shows permission-filtered recorded runs, runtime approval gates, outputs and conversation links. Completed execution is not proof of achieved results. |
| Stop active work | Implemented | Stop affects the selected run. It does not undo changes or cancel future schedules. |
| Manage future work | Implemented | Talvori → Scheduled and Settings use the same canonical schedules, controls and occurrence receipts. |
| Ask for a recurring prompt | Implemented | One-off, daily and weekly proposals require fresh inspection and final confirmation. Saved prompts/model/context remain exact; each provider occurrence can be billed. |
| Ask to pause, reschedule, resume or cancel | Implemented | A typed pending proposal pins the schedule owner, exact version and timing/state. Only that owner can confirm. Prompt/model/recipient/context cannot be changed through this action. |
| Reuse an earlier discussion | Explicit retrieval implemented | Search readable messages, select them and snapshot their canonical content. This is lexical search, not autonomous semantic retrieval or access to ChatGPT/Claude account history. |
| Keep scoped reference notes | Implemented | Approved agent memory is included according to current scope/access. Saves remain reviewed; derived notes retain original run-source permissions. |
| Change workspace records | Bounded implementation | The low-risk policy allows safe new Routes and self-membership links. Supported other edits remain proposals. Unsupported actions are rejected rather than simulated. |
| Parallel delegated agents and automatic report-back | Not implemented | Existing manual Workflows and handoff records are not an autonomous coordinator. No unsupported paid agent launches are enabled. |
| Decide when to sleep and wake or react to events | Not implemented | Fixed schedules are not an event-trigger or adaptive continuation engine. Repeating a frozen snapshot is not fresh-state monitoring. |
| Autonomous cross-chat research and note maintenance | Not implemented | Explicit retrieval and approved memory are not continuous background research. |
| Browser/desktop control or personal remote-runner pairing | Not implemented | Local Workbench tools are not isolated public browser/computer workers. Public visitors never inherit the server operator's CLI account. |
| Slack/Teams/email contact and app actions | Not released | Non-AI Plugins remain paused. Catalog entries do not authorize or execute service actions. |
| Notifications while the app/server is offline | Not implemented | In-app state is available when reopened. There is no Web Push/email delivery service, and no execution while the responsible server is stopped. |

## Use the new flows

1. Open Talvori → **Activity** to inspect runs, search/filter them, stop one, open
   its conversation or review an output. Use **Review conversation** for proposals
   in a completed reply. **Needs you** covers blocked/failed/runtime approval-gated
   runs; it is not an unread-proposal counter.
2. Open **Scheduled** to manage real future occurrences. A cancellation needs a
   confirmation; changing a schedule never stops an already-running occurrence.
3. In a conversation choose **Select context sources** → **Past conversations**.
   Search, select individual messages, and save the snapshot. Search, selection
   and snapshot creation never start a provider. Explicit Send includes it in
   the exact captured context. See [conversation retrieval](conversation-retrieval.md).
4. Ask a connected agent for a schedule or schedule change. A reply only creates
   a pending proposal. Review the real prompt/model/time/timezone/repetition or
   state change before confirming. See [action and schedule boundaries](agent-actions-direct.md).

Scheduled prompts repeat the original reviewed snapshot, not future edits or
newly created sources. No context-refresh permission is implied. Missed or
uncertain dispatches are recorded without blind retries. Access, credentials,
profile and source checks still apply at delivery.

## What the owner must provide

These requirements concern public deployment and live verification, not the
isolated automated test fixtures.

| Blocked result | Required owner setup |
| --- | --- |
| Public, always-on Talvori | A production HTTPS origin and hosting account with a persistent Node backend, private writable storage and TLS reverse proxy. Provision an owner password and stable server-only 32-byte encryption key. Never expose Vite or reuse development CLI accounts for visitors. Follow the exact environment/deployment steps in [AI connections](ai-connections.md#running-the-backend-on-a-public-origin). |
| Public Hugging Face browser authorization | Register Talvori in Hugging Face Applications with the production `/api/ai-connections/huggingface/callback`; configure `TALVORI_HF_CLIENT_ID` and the confidential-client secret when applicable on the server. Users supply their own inference access. |
| Public GitHub Copilot browser authorization | Register the GitHub application with the production `/api/ai-connections/copilot/callback`; configure `TALVORI_GITHUB_CLIENT_ID` and `TALVORI_GITHUB_CLIENT_SECRET`. A live inference tester needs eligible Copilot access; an ordinary GitHub account alone does not verify inference. The operator's Copilot account does not power other users. |
| Live inference verification | Enter a consenting test user's provider key/account through Talvori's connection UI, choose an entitled model, and approve the explicit billable test. Do not paste keys/passwords into chat. Fixture tests do not certify real provider access. |
| Provider-hosted Talvori branding | Update actual registered application names, logos and callback/homepage origins in provider dashboards. See [rebrand checklist](talvori-rebrand.md#provider-hosted-authorization-operator-checklist). Repository assets cannot rename remote registrations. |
| Hosted ChatGPT/Claude subscription authorization | Required provider approval and a supported integration agreement, not a copied local/OSS OAuth client ID. Direct provider API-key routes are separate alternatives. Current restrictions and sources are recorded in [AI connections](ai-connections.md). |

No owner credential, domain or approval can switch on the unimplemented
coordinator, event engine, autonomous retrieval, push delivery or isolated
computer workers. Those remain engineering work; they must not be described as
blocked merely on an API key. Real account tests and production hardening also
remain necessary before claiming open public readiness; current public mode is
an invite-only beta.

## Verification

Automated tests use temporary databases and injected provider/network responses.
They cover search ACLs and historical lineage, snapshot mutation/revocation,
ID-only browser drafts, recurring conversion, owner/version checks, stale
schedule proposals, DST instant preservation, exactly-once decisions and
schedule-list races. Browser checks exercise Activity, Scheduled, retrieval and
proposal review on desktop/mobile without real paid calls. The build and whole
suite must pass before pushing; real provider entitlement is a separate test.
