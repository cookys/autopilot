// mods/viewer/model.test.js — the viewer's pure half: input parsing, the file window, the diff split, and the one line the MODEL reads.
// Imports the real model.ts (erasable syntax only, so Node strips the types). Run: node --test mods/viewer/model.test.js (also run by run-tests.sh).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let m
test.before(async () => {
  m = await import(path.join(__dirname, 'model.ts'))
})

const MARK = 'SECRET-MARKER-91c7'

test('parseShowInput: exactly one of path and diff', () => {
  assert.equal(m.parseShowInput({}).ok, false)
  assert.equal(m.parseShowInput({ path: 'a', diff: ['HEAD'] }).ok, false)
  assert.deepEqual(m.parseShowInput({ path: 'a.md' }), { ok: true, req: { kind: 'path', path: 'a.md', start: null, end: null } })
  assert.deepEqual(m.parseShowInput({ path: 'a.md', start: 3, end: 9 }), { ok: true, req: { kind: 'path', path: 'a.md', start: 3, end: 9 } })
  assert.deepEqual(m.parseShowInput({ diff: ['HEAD~1', '--', 'src'] }), { ok: true, req: { kind: 'diff', args: ['HEAD~1', '--', 'src'] } })
  assert.deepEqual(m.parseShowInput({ diff: 'HEAD~1 -- src' }), { ok: true, req: { kind: 'diff', args: ['HEAD~1', '--', 'src'] } })
  assert.deepEqual(m.parseShowInput({ diff: [] }), { ok: true, req: { kind: 'diff', args: [] } })
})

test('parseShowInput: bad lines, ranges and control characters are refused', () => {
  for (const bad of [{ path: '' }, { path: 'a\nb' }, { path: 'a', start: 0 }, { path: 'a', start: 1.5 }, { path: 'a', start: 'x' }, { path: 'a', start: 5, end: 4 }, { path: 7 }, { diff: ['a\nb'] }, { diff: [1] }, { diff: ['x'], end: 3 }]) {
    assert.equal(m.parseShowInput(bad).ok, false, JSON.stringify(bad))
  }
  assert.equal(m.parseShowInput({ diff: Array.from({ length: 41 }, () => 'a') }).ok, false)
})

test('parseShowInput: only revisions and a few safe options before the dashes (a whitelist: git takes any unique abbreviation of a long option); after the dashes everything is a path (negative controls)', () => {
  for (const bad of ['--output=/tmp/x', '--output', '--outp', '--ext-diff', '--ext', '--textconv', '--textc', '--open-files-in-pager', '--open', '-O', '-Oorder', '--no-index', '--exit-code', '--stat', '-U', '-Ux', '--unified', '--unified=x', '--cache', '-c']) {
    assert.equal(m.parseShowInput({ diff: ['HEAD', bad] }).ok, false, bad)
  }
  assert.equal(m.parseShowInput({ diff: ['HEAD', '--', '--output=x'] }).ok, true)
  for (const good of ['--cached', '--staged', '-U5', '--unified=10', 'HEAD~1', 'A..B', 'main']) assert.equal(m.parseShowInput({ diff: [good] }).ok, true, good)
})

test('gitDiffArgv: the forced --no-ext-diff --no-textconv come after the model\'s revisions and options and before the dashes', () => {
  assert.deepEqual(m.gitDiffArgv(['A..B', '--', 'x y']), ['git', '--no-pager', 'diff', '--no-color', 'A..B', '--no-ext-diff', '--no-textconv', '--', 'x y'])
  assert.deepEqual(m.gitDiffArgv(['--cached']), ['git', '--no-pager', 'diff', '--no-color', '--cached', '--no-ext-diff', '--no-textconv'])
})

test('fileView: the whole file, a range, a clamp, an empty file, CRLF and a missing trailing newline', () => {
  const v = m.fileView('a.txt', 'one\ntwo\nthree\n', null, null)
  assert.deepEqual({ first: v.first, last: v.last, total: v.total, partial: v.partial, source: v.source }, { first: 1, last: 3, total: 3, partial: false, source: 'one\ntwo\nthree' })
  const r = m.fileView('a.txt', 'one\ntwo\nthree\n', 2, 2)
  assert.deepEqual({ first: r.first, last: r.last, partial: r.partial, source: r.source }, { first: 2, last: 2, partial: true, source: 'two' })
  const c = m.fileView('a.txt', 'one\ntwo\n', 2, 99)
  assert.deepEqual({ first: c.first, last: c.last }, { first: 2, last: 2 })
  assert.equal(m.fileView('a.txt', 'one\n', 50, null).first, 1) // a start past the end clamps to the last line
  assert.equal(m.fileView('a.txt', '', null, null), null)
  assert.equal(m.fileView('a.txt', '\r\nx\r\n', null, null).source, '\nx')
  assert.equal(m.fileView('a.txt', 'no newline', null, null).total, 1)
})

test('fileView: a long file is cut to a part of WINDOW_LINES lines or WINDOW_CHARS characters, and the parts chain (next / previous start)', () => {
  const long = Array.from({ length: 5000 }, (_, i) => 'row ' + (i + 1)).join('\n')
  const a = m.fileView('l.txt', long, null, null)
  assert.equal(a.first, 1)
  assert.equal(a.last, m.WINDOW_LINES)
  assert.equal(m.nextStart(a), m.WINDOW_LINES + 1)
  assert.equal(m.prevStart(a, 100), null)
  const b = m.fileView('l.txt', long, m.nextStart(a), null)
  assert.equal(b.first, m.WINDOW_LINES + 1)
  assert.equal(m.prevStart(b, b.last - b.first + 1), 1)
  // wide lines: the character budget cuts earlier than the line budget
  const wide = Array.from({ length: 400 }, () => 'x'.repeat(500)).join('\n')
  const w = m.fileView('w.txt', wide, null, null)
  assert.ok(w.source.length <= m.WINDOW_CHARS, String(w.source.length))
  assert.ok(w.last < 400 && w.last > 100)
  // one line wider than the whole window still shows (its start) and does not loop
  const one = m.fileView('o.txt', 'y'.repeat(m.WINDOW_CHARS * 2) + '\nnext', null, null)
  assert.equal(one.first, 1)
  assert.equal(one.last, 1)
  assert.equal(one.source.length, m.WINDOW_CHARS)
})

const DIFF = ['diff --git a/a.ts b/a.ts', 'index 1..2 100644', '--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +1,2 @@', ' k', '-old', '+new', '@@ -9,1 +9,1 @@', '-x', '+y',
  'diff --git a/dir/b.ts b/dir/b.ts', 'new file mode 100644', '--- /dev/null', '+++ b/dir/b.ts', '@@ -0,0 +1,1 @@', '+added', ''].join('\n')

test('diffView: sections per file, hunks only (the header lines are read past), counts', () => {
  const d = m.diffView(DIFF)
  assert.equal(d.files, 2)
  assert.equal(d.hunks, 3)
  assert.equal(d.truncated, false)
  assert.deepEqual(d.sections.map(s => s.file), ['a.ts', 'dir/b.ts'])
  assert.equal(d.sections[0].chunks.length, 1)
  assert.ok(d.sections[0].chunks[0].startsWith('@@ -1,2 +1,2 @@'))
  assert.ok(!d.sections[0].chunks[0].includes('index 1..2'))
  assert.equal(m.diffView('').files, 0)
})

test('diffView: chunks stay under the Code limit (whole hunks), a total cap cuts the rest and says so', () => {
  const hunk = i => ['@@ -' + i + ',1 +' + i + ',1 @@', '-' + 'a'.repeat(3000), '+' + 'b'.repeat(3000)].join('\n')
  const many = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n' + Array.from({ length: 40 }, (_, i) => hunk(i + 1)).join('\n') + '\n'
  const d = m.diffView(many)
  assert.ok(d.sections[0].chunks.every(c => c.length <= m.DIFF_CHUNK_CHARS), 'every chunk fits')
  assert.ok(d.sections[0].chunks.length > 1)
  assert.equal(d.truncated, true)
  assert.ok(d.shownChars <= m.DIFF_TOTAL_CHARS)
  assert.equal(d.sections[0].cut, true)
  // one hunk bigger than a chunk stands alone
  const big = m.diffView('diff --git a/f b/f\n@@ -1,1 +1,1 @@\n-' + 'a'.repeat(12000) + '\n+b\n')
  assert.equal(big.sections[0].chunks.length, 1)
  assert.ok(big.sections[0].chunks[0].length > m.DIFF_CHUNK_CHARS)
})

test('the line the model reads: the path and the numbers, never the text', () => {
  const v = m.fileView('notes/a.md', 'first\nsecond ' + MARK + '\nthird\n', null, null)
  const line = m.summaryOfFile(v)
  assert.match(line, /notes\/a\.md lines 1-3 of 3/)
  assert.ok(!line.includes(MARK) && !line.includes('second'))
  assert.ok(line.length < 300)
  const d = m.diffView(DIFF.replace('+new', '+new ' + MARK))
  const dl = m.summaryOfDiff(['HEAD~1'], d)
  assert.match(dl, /git diff HEAD~1 \(2 files, 3 hunks\)/)
  assert.ok(!dl.includes(MARK))
  assert.ok(!m.errorOf('cannot read x').includes(MARK))
  // the engine-level control (viewer.test.ts) and the recorded mutation in the commit message turn red when summaryOfFile carries the text
})

test('startAbove: a pressed path:line opens two lines above the line, never before line 1', () => {
  assert.equal(m.startAbove(30), 28)
  assert.equal(m.startAbove(3), 1)
  assert.equal(m.startAbove(1), 1)
})
