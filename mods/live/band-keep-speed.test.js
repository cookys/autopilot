'use strict'
// A failed data source (quota_forecast no_source) or a stale live snapshot must not
// drop the locally measured speed label. No live dir, no fleet.
// Node cannot import .tsx. The hooks below turn JSX into calls and add .ts, then
// Node's module-typescript strip runs. This file stays on `node --test`.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

function transformJsx(src) {
  let i = 0
  const n = src.length
  const peek = () => src[i]
  const startsJsx = (at) => {
    const c = src[at + 1]
    if (c === '/') return /[A-Z]/.test(src[at + 2] || '')
    return /[A-Z]/.test(c || '')
  }
  function skipWs() { while (i < n && /\s/.test(src[i])) i++ }
  function readString() {
    const q = src[i]
    let out = q
    i++
    if (q === '`') {
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue }
        if (src[i] === '`') { out += src[i]; i++; break }
        if (src[i] === '$' && src[i + 1] === '{') {
          out += '${'
          i += 2
          out += readExpr('}')
          continue
        }
        out += src[i]
        i++
      }
      return out
    }
    while (i < n) {
      if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue }
      out += src[i]
      if (src[i] === q) { i++; break }
      i++
    }
    return out
  }
  // expression starting at i, ending just before a closer that balances the opener already consumed
  function readExpr(closer) {
    let out = ''
    let depthB = 0, depthP = 0, depthK = 0
    while (i < n) {
      const c = src[i]
      if (c === "'" || c === '"' || c === '`') { out += readString(); continue }
      if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += src.slice(i, end); i = end; continue }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end); i = end; continue }
      if (c === '<' && startsJsx(i)) { out += parseElement(); continue }
      if (c === '(') depthP++
      else if (c === ')') { if (depthP === 0 && closer === ')') break; depthP-- }
      else if (c === '[') depthB++
      else if (c === ']') { if (depthB === 0 && closer === ']') break; depthB-- }
      else if (c === '{') depthK++
      else if (c === '}') { if (depthK === 0 && closer === '}') break; depthK-- }
      out += c
      i++
    }
    return out
  }
  function parseElement() {
    i++ // <
    let name = ''
    while (i < n && /[A-Za-z0-9_]/.test(src[i])) { name += src[i]; i++ }
    const props = []
    skipWs()
    while (i < n && peek() !== '>' && !(peek() === '/' && src[i + 1] === '>')) {
      if (peek() === '{') {
        i++
        if (src[i] === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
          i += 3
          const expr = readExpr('}')
          if (src[i] === '}') i++
          props.push(['...', expr])
        } else throw new Error('jsx prop at ' + i)
      } else {
        let key = ''
        while (i < n && /[A-Za-z0-9_]/.test(src[i])) { key += src[i]; i++ }
        skipWs()
        if (peek() === '=') {
          i++
          skipWs()
          let val
          if (peek() === '{') { i++; val = readExpr('}'); if (src[i] === '}') i++ }
          else if (peek() === '"' || peek() === "'") val = readString()
          else throw new Error('jsx value at ' + i + ' ' + src.slice(i, i + 20))
          props.push([key, val])
        } else props.push([key, 'true'])
      }
      skipWs()
    }
    const self = peek() === '/'
    if (self) i += 2
    else i++ // >
    const children = []
    if (!self) {
      while (i < n) {
        if (src[i] === '<' && src[i + 1] === '/' && src.slice(i + 2, i + 2 + name.length) === name) {
          i += 2 + name.length
          if (src[i] === '>') i++
          break
        }
        if (src[i] === '<' && startsJsx(i)) { children.push(parseElement()); continue }
        if (src[i] === '{') { i++; children.push('(' + readExpr('}') + ')'); if (src[i] === '}') i++; continue }
        let text = ''
        while (i < n && src[i] !== '<' && src[i] !== '{') { text += src[i]; i++ }
        if (text.trim() !== '') children.push(JSON.stringify(text))
      }
    }
    const obj = []
    const spreads = []
    for (const [k, v] of props) {
      if (k === '...') spreads.push(v)
      else obj.push(JSON.stringify(k) + ':' + v)
    }
    let propExpr = '{' + obj.join(',') + '}'
    if (spreads.length) propExpr = 'Object.assign({},' + spreads.join(',') + (obj.length ? ',' + propExpr : '') + ')'
    return '__jsx(' + name + ',' + propExpr + (children.length ? ',' + children.join(',') : '') + ')'
  }
  let out = ''
  while (i < n) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') { out += readString(); continue }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += src.slice(i, end); i = end; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end); i = end; continue }
    if (c === '<' && startsJsx(i)) { out += parseElement(); continue }
    out += c
    i++
  }
  return 'function __jsx(type, props, ...children) {\n'
    + '  const p = Object.assign({}, props)\n'
    + '  const ch = children.flat(Infinity)\n'
    + '  if (ch.length === 1) p.children = ch[0]\n'
    + '  else if (ch.length > 1) p.children = ch\n'
    + '  return type(p)\n'
    + '}\n' + out
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.(tsx?|jsx?|json|mjs|cjs)$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL)
      for (const ext of ['.ts', '.tsx', '.js', '.json']) {
        const file = base.pathname + ext
        if (fs.existsSync(file)) return nextResolve(specifier + ext, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) {
      const src = fs.readFileSync(new URL(url), 'utf8')
      return { format: 'module-typescript', source: transformJsx(src), shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

const NOW = 1794200000000
const step = (i) => ({ at: i, model: 'm', isSubagent: false, ttftMs: 100, decodeMs: 2000, outTokens: 200, tps: 80 })
const flat = (n) => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : n?.props ? flat(n.props.children) : ''

async function rowOf(cols, { forecast = 'no_source', liveState = 'ok', steps = 3 } = {}) {
  const { parseConsole } = await import('./console.ts')
  const { BandBar } = await import('./band.tsx')
  const { speedLabelParts } = await import('./speedview.ts')
  const { makeT } = await import('./i18n.ts')
  const M = await import('./model.ts')
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/console/c0/console-full.json'), 'utf8'))
  raw.generated_at_ms = NOW
  raw.sources.tasks = { at_ms: NOW, state: 'ok' }
  raw.sources.quota_forecast = { at_ms: forecast === 'ok' ? NOW : null, state: forecast }
  const con = parseConsole(JSON.stringify(raw))
  const mk = (kind) => (props) => ({ kind, props })
  const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') }
  const live = {
    state: liveState, text: 'x', header: 'x', band: null, pending: [], project_key: null, root_run_id: null,
    link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null,
    watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW },
  }
  const forge = speedLabelParts(Array.from({ length: steps }, (_, i) => step(i + 1)))
  const node = BandBar(EL, live, cols, makeT('zh-TW'), { onInfo() {}, onSlot() {}, onTab() {} }, null, forge, true, null, { snap: con, tab: 'command', cols }, null, null, false).node
  const rows = node.props.children.flat().filter(Boolean)
  return flat(rows[0])
}

test('(a) quota_forecast no_source and 3 timed main steps: failure text and tok/s', async () => {
  const row = await rowOf(120)
  assert.match(row, /額度無預測來源/)
  assert.match(row, /tok\/s/)
})

test('(b) 60 cols: tok/s stays and the failure text is truncated', async () => {
  const row = await rowOf(60)
  assert.match(row, /tok\/s/)
  assert.match(row, /✗/)
  assert.match(row, /額度/)
  assert.match(row, /…/)
  assert.equal(row.includes('autopilot status runs --watch'), false)
})

test('(c) stale live snapshot and timed steps still show tok/s', async () => {
  const row = await rowOf(120, { forecast: 'ok', liveState: 'stale' })
  assert.match(row, /tok\/s/)
})

test('(d) no timed steps: no tok/s', async () => {
  const row = await rowOf(120, { steps: 0 })
  assert.equal(row.includes('tok/s'), false)
  assert.match(row, /額度無預測來源/)
})
