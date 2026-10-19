import test from 'node:test';
import assert from 'node:assert/strict';
import * as icons from 'lucide';
import { ICON_REACTIONS, EMOJI_REACTIONS, REACTION_CATALOG, getReaction, normalizeReactionColor, reactionKey } from '../src/lib/reaction-catalog.js';

test('reaction catalog contains over 200 distinct line glyphs and a broad accessible Unicode collection', () => {
  assert.ok(ICON_REACTIONS.length > 200);
  assert.ok(EMOJI_REACTIONS.length > 600);
  assert.equal(new Set(REACTION_CATALOG.map(item => item.id)).size, REACTION_CATALOG.length);
  assert.equal(new Set(EMOJI_REACTIONS.map(item => item.glyph)).size, EMOJI_REACTIONS.length);
  assert.equal(new Set(ICON_REACTIONS.map(item => JSON.stringify(item.path || icons[item.icon]))).size, ICON_REACTIONS.length);
  assert.ok(ICON_REACTIONS.filter(item => item.category === 'Talvori' && item.path).length >= 16);
  for (const item of REACTION_CATALOG) {
    assert.ok(item.name && item.category);
    assert.equal(getReaction(item.id), item);
    if (item.type === 'icon') assert.ok(item.path || Array.isArray(icons[item.icon]), item.icon);
    else assert.ok(item.glyph && !/[<>]/.test(item.glyph));
  }
});

test('reaction colors accept only six-digit hex and stable identities include tint', () => {
  for (const invalid of ['red', '#fff', 'url(https://example.com)', '#ffffff;background:red', {}, true]) assert.equal(normalizeReactionColor(invalid), undefined);
  assert.equal(normalizeReactionColor('#AaBbCC'), '#aabbcc');
  assert.equal(normalizeReactionColor(null), null);
  assert.notEqual(reactionKey({ id: 'icon:rocket', color: null }), reactionKey({ id: 'icon:rocket', color: '#818cf8' }));
  assert.equal(getReaction('emoji:<script>'), undefined);
});
