'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('./ansi-to-html-grid.js');

test('CJK content and box borders share the same display width', () => {
  const html = render('┌─────────────────┐\n│現況 待決 abc ‣ ▸│\n└─────────────────┘');
  const rows = [...html.matchAll(/<div class="row">(.*?)<\/div>/g)].map(m => [...m[1].matchAll(/width:(\d+)ch/g)].reduce((n, w) => n + Number(w[1]), 0));
  assert.deepEqual(rows, [19, 19, 19]);
});

test('CJK is two cells and other symbols are one', () => {
  const html = render('現‣▸a🐱');
  assert.deepEqual([...html.matchAll(/width:(\d+)ch/g)].map(m => Number(m[1])), [2,1,1,1,1]);
});

test('SGR colors, bold, inverse and resets', () => {
  const html = render('\x1b[31;104;1mA\x1b[7mB\x1b[27;22;38;5;196;48;2;1;2;3mC\x1b[0mD');
  assert.match(html, /width:1ch;color:#cd3131;background:#3b8eea;font-weight:bold;">A/);
  assert.match(html, /width:1ch;color:#3b8eea;background:#cd3131;font-weight:bold;">B/);
  assert.match(html, /width:1ch;color:#ff0000;background:#010203;">C/);
  assert.match(html, /width:1ch;color:#d4d4d4;background:#1e1e1e;">D/);
  assert.match(render('\x1b[38;2;10;20;30;48;5;244mX'), /color:#0a141e;background:#808080/);
});

test('CLI accepts stdin and a file and escapes HTML', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ansi-grid-'));
  try {
    const file = path.join(dir, 'capture.ansi');
    fs.writeFileSync(file, '<&現');
    for (const args of [[file], []]) {
      const result = spawnSync(process.execPath, [require.resolve('./ansi-to-html-grid.js'), ...args], {input:'<&現', encoding:'utf8'});
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /&lt;/);
      assert.match(result.stdout, /&amp;/);
      assert.match(result.stdout, /width:2ch[^>]*>現/);
    }
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
