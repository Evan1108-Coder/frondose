import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup, renderToPipeableStream } from 'react-dom/server';
import { documentLink, websiteFavicon, normalizeMathDelimiters, hasMathSyntax, emojiLookup, remarkBoundMath } from '../src/lib/document-markdown.js';

const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL('..', import.meta.url));
let component;
async function renderer() {
  if (component) return component;
  const directory = mkdtempSync(join(tmpdir(), 'frondose-rich-render-'));
  try {
    const built = await build({
      absWorkingDir: project, entryPoints: ['src/components/DocumentContent.jsx'], write: false,
      bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
      plugins: [{ name: 'one-react', setup(builder) {
        builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      } }],
    });
    const path = join(directory, 'renderer.mjs');
    writeFileSync(path, built.outputFiles[0].text);
    component = (await import(pathToFileURL(path).href)).DocumentContent;
    return component;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
async function html(content, props = {}) {
  const DocumentContent = await renderer();
  return renderToStaticMarkup(React.createElement(DocumentContent, { content, ...props }));
}
async function mathHtml(content) {
  const DocumentContent = await renderer();
  return new Promise((resolve, reject) => {
    const target = new PassThrough(), chunks = [];
    target.on('data', chunk => chunks.push(chunk));
    target.on('end', () => resolve(Buffer.concat(chunks).toString()));
    const stream = renderToPipeableStream(React.createElement(DocumentContent, { content }), { onAllReady() { stream.pipe(target); }, onError: reject });
  });
}

test('rich messages render nested lists, tables, tasks, quotes, emphasis and literal Unicode', async () => {
  const output = await html('# Title\n\n1. Parent\n   - Child **strong**\n     - Grandchild\n\n> Quoted *emphasis*\n\n- [x] Finished\n- [ ] Next\n\n| Key | Value |\n| --- | ---: |\n| `master` | ~~old~~ → new ≤ ∞ ✓ |');
  assert.match(output, /<h2>Title<\/h2>/);
  assert.match(output, /<ol>[\s\S]*<ul>[\s\S]*<ul>/);
  assert.match(output, /<blockquote>[\s\S]*<em>emphasis<\/em>/);
  assert.match(output, /aria-label="Checked"/);
  assert.match(output, /aria-label="Unchecked"/);
  assert.match(output, /<table>[\s\S]*<th>[\s\S]*<td>[\s\S]*<code>master<\/code>/);
  assert.match(output, /<del>old<\/del> → new ≤ ∞ ✓/);
});

test('Markdown links and bare URLs receive strict protocol and origin-only favicon handling', async () => {
  const output = await html('[Website](https://example.org/private?q=secret) https://example.net/path\n\n[Docs](#/docs/initial-launch) [Workspace](#/areas/area-1) [Local](http://127.0.0.1:4174/)');
  assert.match(output, /href="https:\/\/example.org\/private\?q=secret"/);
  assert.match(output, /src="https:\/\/example.org\/favicon.ico"/);
  assert.doesNotMatch(output, /src="[^\"]*(?:private|secret|127\.0\.0\.1)/);
  assert.match(output, /href="https:\/\/example.net\/path"/);
  assert.match(output, /href="#\/docs\/initial-launch"/);
  assert.match(output, /data-rumbo-icon="FileText"/);
  assert.match(output, /data-rumbo-icon="Globe"/);
  assert.equal(documentLink('#/not-a-page/no'), null);
  assert.equal(documentLink('#/docs/a/b'), null);
  assert.equal(documentLink('#/docs/%2e%2e'), null);
  assert.equal(documentLink('#/conversations/chat-1')?.page.view, 'chats');
});

test('unsafe links, raw HTML and author-supplied images stay inert', async () => {
  const output = await html('[one](javascript:alert%281%29) [two](data:text/html,x) [three](file:///tmp/private) [four](//evil.example)\n\n<img src="https://evil.example/track" onerror="alert(1)">\n\n![Tracking](https://evil.example/track) ![SVG](data:image/svg+xml;base64,abcd)');
  assert.doesNotMatch(output, /<img|<script|href="(?:javascript|data|file|\/\/)/);
  assert.match(output, /&lt;img src=/);
  assert.match(output, /\[Image: Tracking\]/);
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '//host/path', 'https://user:pass@host.example/', 'https:\n//host.example/', '#/docs/a\u0000b']) assert.equal(documentLink(href), null, href);
});

test('workspace emoji images require trusted bounded raster metadata and remain literal in code', async () => {
  const emojis = [{ id: 'custom:1', shortcode: ':hello:', glyph: 'data:image/png;base64,aGVsbG8=', name: 'Hello' }, { id: 'bad', shortcode: ':bad:', glyph: 'https://evil.example/track' }];
  const output = await html('**:hello:** :bad: `:hello:`', { emojis });
  assert.match(output, /<strong><img class="document-custom-emoji"/);
  assert.match(output, /src="data:image\/png;base64,aGVsbG8="/);
  assert.match(output, /:bad:/);
  assert.match(output, /<code>:hello:<\/code>/);
  assert.equal(emojiLookup(emojis).byId.size, 1);
});

test('quoted code retains literal source and the shared code appearance viewer', async () => {
  const output = await html('```js\nconst item = "<script>";\n```\n\n~~~text\n:hello: [not a link](https://evil.example)\n~~~');
  assert.match(output, /class="document-code"/);
  assert.match(output, /class="code-viewer/);
  assert.match(output, /&lt;script&gt;/);
  assert.doesNotMatch(output, /href="https:\/\/evil.example/);
  assert.match(output, /aria-label="js"/);
});

test('math delimiters preserve code and do not mistake ordinary currency for a formula', () => {
  const content = '\\(x^2\\)\n\n\\[\\frac{1}{2}\\]\n\n`\\(not math\\)`\n\n```tex\n\\[literal\\]\n```';
  const normalized = normalizeMathDelimiters(content);
  assert.match(normalized, /\$x\^2\$/);
  assert.match(normalized, /\$\$\n\\frac\{1\}\{2\}\n\$\$/);
  assert.match(normalized, /`\\\(not math\\\)`/);
  assert.match(normalized, /```tex\n\\\[literal\\\]\n```/);
  assert.equal(hasMathSyntax('Costs $20 and $30.'), false);
  assert.equal(hasMathSyntax('$x^2$'), true);
  assert.equal(hasMathSyntax('Unicode ∑ and → require no math engine.'), false);
  assert.equal(hasMathSyntax('`$notmath$`'), false);
  assert.equal(normalizeMathDelimiters('````tex\n\\(literal\\)\n```\n\\[also literal\\]'), '````tex\n\\(literal\\)\n```\n\\[also literal\\]');
  assert.equal(normalizeMathDelimiters('`` before ` \\(literal\\) ``'), '`` before ` \\(literal\\) ``');
});

test('math renders actual local KaTeX with accessible MathML and trust disabled', async () => {
  const output = await mathHtml('Inline $x^2 + \\frac{1}{2}$\n\n$$\n\\sum_{i=1}^{n} i\n$$');
  assert.match(output, /class="katex"/);
  assert.match(output, /<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/);
  assert.match(output, /class="katex-display"/);
  const unsafe = await mathHtml('$\\href{javascript:alert(1)}{Click} + \\includegraphics{https://evil.example/track}$');
  assert.doesNotMatch(unsafe, /<a href="javascript|<img|src="https:\/\/evil.example/);
  const source = readFileSync(new URL('../src/components/DocumentMath.jsx', import.meta.url), 'utf8');
  assert.match(source, /trust: false/);
  assert.match(source, /maxExpand: 500/);
  assert.match(source, /maxSize: 20/);
  assert.match(source, /import 'katex\/dist\/katex.min.css'/);
});

test('oversized math is shown as literal TeX rather than unbounded expansion', () => {
  const tree = { children: [{ type: 'math', value: 'a'.repeat(5000), data: { hName: 'math' } }] };
  remarkBoundMath()(tree);
  assert.equal(tree.children[0].type, 'code');
  assert.equal(tree.children[0].lang, 'tex');
  assert.equal(tree.children[0].data, undefined);
  const quoted = { children: [{ type: 'code', lang: 'math', value: 'literal' }] };
  remarkBoundMath()(quoted);
  assert.equal(quoted.children[0].lang, 'tex');
});

test('favicon fallback never probes loopback, private IPs, local hostnames or credentials', () => {
  for (const url of ['http://localhost:4174/a', 'http://127.0.0.1:4174', 'http://[::1]:4174', 'http://10.0.0.2', 'http://172.16.0.3', 'http://192.168.1.1', 'http://printer.local', 'http://intranet', 'https://user:pass@example.org']) assert.equal(websiteFavicon(url), null, url);
  assert.equal(websiteFavicon('https://example.org/secret?token=never'), 'https://example.org/favicon.ico');
  assert.equal(websiteFavicon('http://100.64.0.1/'), null);
});

test('the math pipeline resolves one patched engine rather than a vulnerable nested dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies.katex, '0.19.0');
  assert.equal(manifest.overrides.katex, '$katex');
  const engines = Object.entries(lock.packages).filter(([key]) => /(?:^|\/)node_modules\/katex$/.test(key));
  assert.deepEqual(engines.map(([, value]) => value.version), ['0.19.0']);
});

test('positioned Markdown retains real leaf offsets through the emoji transform',async()=>{const rendered=await html('# Title\n\nFirst **bold** paragraph.\n\nSecond paragraph.',{sourcePositions:true});assert.match(rendered,/data-source-text-start="9"/);assert.match(rendered,/data-source-text-end=/);assert.match(rendered,/<strong><span data-source-text-start=/);const normal=await html('Ordinary text');assert.doesNotMatch(normal,/data-source-text-start/);});
