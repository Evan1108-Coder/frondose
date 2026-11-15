import test from 'node:test';
import assert from 'node:assert/strict';
import { browserAddressUrl } from '../src/lib/browser-address.js';

test('browser URL bar accepts loopback dev servers without requiring a protocol', () => {
  assert.equal(browserAddressUrl('localhost:4174'), 'http://localhost:4174/');
  assert.equal(browserAddressUrl('127.0.0.1:3000/path?q=1#part'), 'http://127.0.0.1:3000/path?q=1#part');
  assert.equal(browserAddressUrl('[::1]:5173/'), 'http://[::1]:5173/');
  assert.equal(browserAddressUrl('localhost'), 'http://localhost/');
  assert.equal(browserAddressUrl('https://localhost:4174'), 'https://localhost:4174/');
  assert.equal(browserAddressUrl('example.com:8443/path'), 'https://example.com:8443/path');
  assert.equal(browserAddressUrl('about:blank'), 'about:blank');
  assert.equal(browserAddressUrl(' localhost:3000\n'), 'http://localhost:3000/');
});

test('browser URL bar still rejects active/local-file protocols, credentials and control characters', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://user:secret@localhost', 'localhost:65536', 'local host:3000', '']) {
    assert.throws(() => browserAddressUrl(input), input);
  }
  assert.throws(() => browserAddressUrl('local\nhost:3000'));
});
