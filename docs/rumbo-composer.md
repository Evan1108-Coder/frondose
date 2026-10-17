# Rumbo conversation composer

The composer is a Rumbo-native implementation inspired by the publicly visible layout of React Bits Pro Prompt Input 7. It does **not** install, copy, or claim to be the licensed React Bits component. The Pro registry requires a license key and was not configured in this repository.

In existing conversations, supported local agents offer **Discuss** (conversation, no project folder), **Inspect** (read-only project access), and, where the Codex profile permits it, **Build** (workspace-write coding). Browser-connected models use their existing conversation path. These controls do not change the provider permissions or skip Rumbo's context review. Provider/model selection, selected context, scheduling, slash commands, and send-key preferences remain in place.

The attachment button and drag-and-drop both accept text/code files and PNG, JPEG, WebP, or GIF images. Accepted attachments appear above the text field and can be removed before sending. A file is limited to 350 KB; the combined serialized attachment payload is limited to 650 KB and 20 files. The new Rumbo Agent prompt keeps attached files in the draft when it creates the conversation, so they can be reviewed there before sending. Creating the conversation does not contact the provider.

Images can be saved with a conversation, but not every local runner can consume image input. The existing context/runner checks determine what is actually sent. The upload tray does not imply image understanding by every model. New-conversation attachments are held in the page until the conversation is created; unlike an existing conversation's composer draft, they do not survive a page reload.
