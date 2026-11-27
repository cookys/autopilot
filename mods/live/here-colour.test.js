// `claude` text is ~3.15 contrast on a light theme: it may paint a mark glyph, never words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FILES = ['pages/decide.ts', 'pages/todo.ts', 'pages/frame.ts', 'shell.ts']
const WORDS = /(c\.title|\btitle\b|it\.label|labelOf|r\.from)[^\n]{0,40}color: PALETTE\.here|color: PALETTE\.here[^\n]{0,10}here: true \}\), seg\(pad/

test('card titles, tab names and owner rows are never painted with the here colour', () => {
  for (const f of FILES) {
    const hits = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter(l => WORDS.test(l) && !l.includes('it.label'))
    assert.deepEqual(hits, [], f)
  }
})

test('negative control: the pattern catches a title painted with the here colour', () => {
  assert.match('seg(c.title, { color: PALETTE.here, here: true })', WORDS)
})
