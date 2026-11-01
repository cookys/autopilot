'use strict';
// hooks/tests/lib/plugin-copy.js -- copy the plugin's code (not docs, evals, node_modules) into a scratch root so a
// negative control can break ONE line of the copy and run the real entry point against it (BL-0336 tests).
const fs = require('fs');
const path = require('path');

const DIRS = ['bin', 'hooks', 'src', 'scripts', 'profiles', 'schemas', '.claude-plugin', 'mods', 'references'];

function copyPlugin(repoRoot, dest) {
  for (const d of DIRS) {
    const from = path.join(repoRoot, d);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dest, d), {
      recursive: true,
      filter: (src) => !/(^|\/)(node_modules|\.git|fixtures)(\/|$)/.test(src) || src === from,
    });
  }
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(dest, 'package.json'));
  return dest;
}

// Replace `from` (string or RegExp) with `to` in file `rel` of a copied root; throws when nothing matched (a control that
// no longer matches the source must fail loudly, not pass as a no-op).
function mutate(root, rel, from, to) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(from, () => to);
  if (after === before) throw new Error(`mutation no longer matches ${rel}: ${String(from).slice(0, 80)}`);
  fs.writeFileSync(file, after);
}

module.exports = { copyPlugin, mutate };
