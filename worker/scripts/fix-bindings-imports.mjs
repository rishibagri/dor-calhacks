// Node ESM needs explicit extensions; generated bindings emit "./foo". Append ".js" to
// relative specifiers in dist/module_bindings so `node dist/main.js` can load them.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = new URL('../dist/module_bindings/', import.meta.url).pathname;
const SPEC = /(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+?)(?<!\.js)\2/g;
for (const name of await readdir(dir)) {
  if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue;
  const path = join(dir, name);
  const src = await readFile(path, 'utf8');
  const out = src.replace(SPEC, (_m, pre, q, spec) => `${pre}${q}${spec}.js${q}`);
  if (out !== src) await writeFile(path, out);
}
