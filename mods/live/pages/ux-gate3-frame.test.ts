import { test, expect } from 'claude-code/testing'
import { frameHeight, frameRows } from './frame'
import { PAGES } from './index'
import { Pane } from '../pane'
import { makeT } from '../i18n'

// W1: terminal dimensions differ from host-provided Pane.scroll.bodyRows.
// The host owns borders; every allocated body row belongs to the mod.
test('W1: the tab bar uses the last allocated row at 160x40 and 120x30', () => {
  const mk = (kind: string) => (props: any) => ({ kind, props })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link') }
  for (const [cols, terminalRows, allocated, placement] of [[160, 40, 34, 'dock'], [120, 30, 25, 'inline']] as const) {
    const rows = frameHeight(allocated, placement)
    expect(rows, `${cols}x${terminalRows}: use all host body rows`).toBe(allocated)
    const page = PAGES.find(p => p.id === 'decide')!
    const ctx = { live: null, console: null, size: { cols, rows }, t: makeT('zh-TW'), nowMs: 0 }
    const out = frameRows(page, ctx)
    expect(out.length).toBe(allocated)
    expect(out[allocated - 1].some(s => s.press === 'tab:1:now')).toBe(true)
    const tree = Pane(el, null, 'decide', () => {}, ctx.t, cols, undefined, undefined, undefined, undefined, null, null, null, null, null,
      { pages: PAGES, pageId: 'decide', console: null, nowMs: 0, rows }) as any
    const children = tree.props.children.flat(9).filter(Boolean)
    expect(children.length).toBe(allocated)
    expect(children[allocated - 1].props.children.flat(9).some((n: any) => n?.kind === 'Button' && n.props.hotkey === '1')).toBe(true)
  }
})

test('V5: the tab bar never advertises Escape to close while the prompt may own it', () => {
  for (const cols of [60, 80, 120, 160]) for (const page of PAGES) {
    const ctx = { live: null, console: null, size: { cols, rows: 24 }, t: makeT('zh-TW'), nowMs: 0 }
    const out = frameRows(page, ctx)
    const strips = out.slice(cols < 66 ? -2 : -1)
    expect(strips.map(r => r.map(s => s.text).join('')).join('\n')).not.toContain('Esc')
    expect(strips.flat().filter(s => s.press?.startsWith('tab:')).length).toBe(10)
  }
})
