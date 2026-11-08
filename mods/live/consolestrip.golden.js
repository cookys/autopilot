// mods/live/consolestrip.golden.js — shared by consolestrip.test.js and the golden generator: loads the REAL tabs.ts / i18n.ts under node
// (a one-line resolve hook adds the `.ts` the sources leave off their relative imports) and renders the NON-console tab strips (the pane's
// stripOf and the band's barStrip) at 120 / 80 / 20 columns, both locales, with and without something waiting. Plain data out.
'use strict'
const path = require('node:path')
const { register } = require('node:module')

let loaded
async function load() {
  if (loaded) return loaded
  register('data:text/javascript,' + encodeURIComponent('export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith(\'.\')){try{return await n(s+\'.ts\',c)}catch{}}throw e}}'), require('node:url').pathToFileURL(__filename))
  const tabs = await import(path.join(__dirname, 'tabs.ts'))
  const i18n = await import(path.join(__dirname, 'i18n.ts'))
  loaded = { tabs, i18n }
  return loaded
}

const WAITING = { detail: { qc: null, residue: null, load_source: null }, pending: [{}] }
const segView = s => ({ text: s.text, bold: s.bold === true, dim: s.dim === true, color: s.color === undefined ? null : s.color, here: s.here === true })

// extra: the trailing arguments the console build adds; the baseline calls pass none
async function render(extra = {}) {
  const { tabs, i18n } = await load()
  const out = {}
  for (const locale of ['en', 'zh-TW']) {
    const t = i18n.makeT(locale)
    for (const cols of [120, 80, 20]) {
      for (const [name, snap] of [['none', null], ['waiting', WAITING]]) {
        const s = extra.pane === undefined ? tabs.stripOf(snap, { t, cols }, 'now', true) : tabs.stripOf(snap, { t, cols }, 'now', true, extra.pane)
        out[`pane/${locale}/${cols}/${name}`] = { next: s.next === null ? null : segView(s.next), tabs: s.tabs.map(x => ({ id: x.id, on: x.on, label: segView(x.label) })), rule: s.rule.map(segView), rows: s.rows, exact: s.exact }
        for (const usage of [true, false]) {
          const b = extra.band === undefined ? tabs.barStrip(snap, t, 'now', null, usage) : tabs.barStrip(snap, t, 'now', null, usage, extra.band)
          out[`band/${locale}/${cols}/${name}/${usage ? 'usage' : 'nousage'}`] = { width: b.width, tabs: b.tabs.map(x => ({ id: x.id, width: x.width, start: x.start, label: segView(x.label) })) }
        }
      }
    }
  }
  return out
}
module.exports = { render, load, WAITING }
// node mods/live/consolestrip.golden.js > fixtures/console/golden-strip-nonconsole.json   (regenerate ONLY from a tree whose non-console strip is meant to change)
if (require.main === module) render().then(v => process.stdout.write(JSON.stringify(v, null, 1) + '\n'))
