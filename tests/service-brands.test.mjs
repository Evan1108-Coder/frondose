import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceBrand, safeWebsiteUrl } from '../src/lib/service-brands.js';

test('every catalog service resolves to bundled brand artwork', () => {
  for (const name of ['Codex', 'Claude', 'OpenRouter', 'Hugging Face Inference', 'GitHub', 'Google Drive', 'Slack', 'Google account', 'Microsoft Teams', 'Discord', 'Notion', 'GitLab', 'MCP']) {
    assert.match(serviceBrand(name).src, /^data:image\/svg\+xml,/);
  }
  assert.equal(serviceBrand('google_drive').id, 'google-drive');
});
test('website matching respects host boundaries and specific services', () => {
  assert.equal(serviceBrand(null, 'https://drive.google.com/file/123').id, 'google-drive');
  assert.equal(serviceBrand(null, 'https://github.com/org/repo').id, 'github');
  assert.equal(serviceBrand(null, 'https://github.com.evil.example'), undefined);
  assert.equal(serviceBrand(null, 'https://notgithub.com'), undefined);
});
test('unsafe, credential-bearing and malformed URLs cannot supply favicons', () => {
  for (const url of ['javascript:alert(1)', 'file:///private/test', 'https://user:password@example.com', 'broken', undefined]) assert.equal(safeWebsiteUrl(url), null);
  assert.equal(safeWebsiteUrl('https://example.com/path?secret=x').origin, 'https://example.com');
});
