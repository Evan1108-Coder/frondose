/** A handoff never replaces an existing draft or revives native-tool consent. */
export function coordinationDraft(result, chatId, composer) {
  if (result?.chat_id !== chatId || result.dispatched !== false || typeof result.content !== 'string' || !result.content.trim() || typeof result.agent_id !== 'string' || !result.context?.id || result.context.chat_id !== chatId || typeof result.context.content !== 'string') throw new Error('The prepared handoff does not match this conversation.');
  if (composer.text.trim() || composer.files.length || composer.turn || composer.context || composer.replyTo || composer.sending) throw new Error('Your current draft is safe. Send it or clear it before loading this handoff.');
  return { text:result.content, recipient:result.agent_id, permission:'conversation', context:result.context, replyTo:null, nativeTools:false, model:'', reasoning:'' };
}

/** Apply context defaults, never replace text, attachments or an uncertain turn. */
export function personalComposerDefaults(preferences, composer) {
  if (composer.personalPreferencesInitialized || composer.turn || composer.sending) return null;
  return { memory:preferences.include_memory !== false, includeChat:preferences.include_chat !== false, includeWorkspace:preferences.include_workspace !== false, contextPackIds:Array.isArray(preferences.context_pack_ids)?preferences.context_pack_ids:[], hasSavedPreferences:true, personalPreferencesInitialized:true };
}
