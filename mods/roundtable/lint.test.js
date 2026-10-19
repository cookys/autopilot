// # RED at 0de69d4e5: no mods/roundtable sources yet — the lint finds nothing to scan and the "sources exist" assertion fails.
// Source lint for the roundtable mod. The same function is applied to a bad fixture string (negative control).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const THEME = /['"`](claude|warning|error|success|suggestion|inactive|subtle|merged)['"`]/
const HEX = /#[0-9a-fA-F]{3,8}\b/
const BG = /\b(backgroundColor|inverse)\b/

function violations(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
  const out = []
  code.split('\n').forEach((l, i) => {
    if (HEX.test(l)) out.push((i + 1) + ': hex')
    if (BG.test(l)) out.push((i + 1) + ': background-or-inverse')
    if (THEME.test(l)) out.push((i + 1) + ': theme-key')
  })
  return out
}

test('roundtable sources have no hex colour, no background or inverse, and no theme-key literal', () => {
  const dir = __dirname
  const files = fs.readdirSync(dir).filter(f => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  assert.ok(files.length >= 3, 'model, pane, register')
  const found = []
  for (const f of files) {
    for (const v of violations(fs.readFileSync(path.join(dir, f), 'utf8'))) found.push(f + ' ' + v)
  }
  assert.deepEqual(found, [])
})

test('negative control: the same lint reports a planted hex, background, inverse and theme key', () => {
  const bad = '<Text color="warning" backgroundColor="#ff00aa" inverse>'
  const v = violations(bad)
  assert.ok(v.some(x => x.includes('hex')))
  assert.ok(v.some(x => x.includes('background-or-inverse')))
  assert.ok(v.some(x => x.includes('theme-key')))
  assert.deepEqual(violations('<Text color={PALETTE.here}>'), [])
})
