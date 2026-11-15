import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectInterfaceSourceCopy } from './interface-language-transform.mjs';
import { INTERFACE_LANGUAGES, INTERFACE_TRANSLATIONS } from '../src/lib/interface-language.js';

// A source-only inventory, not a claim of full coverage: dynamic messages,
// other catalogs and docs need their own review. Names and technical terms
// may intentionally stay identical across languages.
const root = fileURLToPath(new URL('../', import.meta.url));
const copy = new Map();
for (const file of readdirSync(resolve(root, 'src'), { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith('.jsx')) continue;
  const path = resolve(file.parentPath, file.name);
  for (const { text, line } of collectInterfaceSourceCopy(readFileSync(path, 'utf8'), path)) {
    if (!copy.has(text)) copy.set(text, `${relative(root, path)}:${line}`);
  }
}

for (const { id } of INTERFACE_LANGUAGES.filter(row => row.coverage==='preview')) {
  const bundled=JSON.parse(readFileSync(resolve(root,'src/lib/interface-copy',id+'.json'),'utf8'));
  const missing = [...copy].filter(([text]) => !INTERFACE_TRANSLATIONS[text]?.[id]&&!Object.hasOwn(bundled,text));
  console.log(`${id}: ${copy.size - missing.length}/${copy.size} distinct static JSX strings have a catalog entry`);
  if (process.argv[2]===id) for(const [text, location] of missing) console.log(`${location} ${JSON.stringify(text)}`);
}
