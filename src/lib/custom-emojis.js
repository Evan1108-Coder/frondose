export const isEmojiImage = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 334000;
export const emojiShortcode = item => `:${item.payload?.shortcode || item.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}:`;
export function customEmojis(items = [], workspaceId, includeArchived = false) {
  return items.filter(item => item.kind === 'emoji' && item.workspace_id === workspaceId && (includeArchived || !item.archived_at)).map(item => ({ id: `custom:${item.id}`, type: 'custom', name: item.name, category: 'My Emojis', glyph: item.payload?.symbol, shortcode: emojiShortcode(item), archived: Boolean(item.archived_at) }));
}
