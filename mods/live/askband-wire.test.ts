import { describe, expect, test } from 'claude-code/testing'
import { askBandRows } from './askband'
import { T_EN } from './i18n'
import { Pane } from './pane'
import { PAGES } from './pages/index'
import { ASKS_LIST_TAIL, makeAsksFeed } from './v74/feeds'

const el = {
  Box: (props: Record<string, unknown>) => ({ kind: 'Box', props }),
  Text: (props: Record<string, unknown>) => ({ kind: 'Text', props }),
  Link: (props: Record<string, unknown>) => ({ kind: 'Link', props }),
  Button: (props: Record<string, unknown>) => ({ kind: 'Button', props }),
}

function collectTexts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(collectTexts)
  const n = node as { kind?: unknown; props?: { children?: unknown } }
  if (n.kind === 'Text') {
    const ch = n.props?.children
    return [typeof ch === 'string' ? ch : Array.isArray(ch) ? ch.join('') : '']
  }
  return collectTexts(n.props?.children)
}

function rowLines(tree: unknown): string[] {
  const root = tree as { props?: { children?: unknown } }
  const children = Array.isArray(root?.props?.children) ? root.props.children : []
  return children.map(ch => collectTexts(ch).join(''))
}

describe('askband-wire', () => {
  test('(a) frame.askRows renders ask band row with same total row count', () => {
    const askRows = askBandRows([
      { status: '未答', count: 1, at: '2026-11-24T10:59:00Z', ask: '需要確認嗎', answer: null },
    ], 100, 0)

    const baseFrame = {
      pages: PAGES,
      pageId: 'now' as const,
      console: null,
      nowMs: 1000,
      rows: 20,
      bodyColumns: 100,
    }

    const withoutAsk = rowLines(Pane(el, null, 'now', () => {}, T_EN, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, baseFrame))
    const withAsk = rowLines(Pane(el, null, 'now', () => {}, T_EN, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { ...baseFrame, askRows }))

    expect(withAsk.length).toBe(withoutAsk.length)
    expect(withAsk.some(line => line.startsWith('我問：'))).toBe(true)
  })

  test('(b) omitting frame.askRows matches baseline output line-for-line', () => {
    const baseFrame = {
      pages: PAGES,
      pageId: 'now' as const,
      console: null,
      nowMs: 1000,
      rows: 20,
      bodyColumns: 100,
    }

    const a = rowLines(Pane(el, null, 'now', () => {}, T_EN, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, baseFrame))
    const b = rowLines(Pane(el, null, 'now', () => {}, T_EN, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { ...baseFrame, askRows: undefined }))

    expect(a).toEqual(b)
  })

  test('(c) asksFeed.refresh populates rows() from fake runner JSON', async () => {
    const feed = makeAsksFeed()
    const payload = [
      { status: '未答', count: 1, at: '2026-11-24T10:59:00Z', ask: '測試問題', answer: null },
    ]
    const ran = await feed.refresh(
      async () => ({ exitCode: 0, stdout: JSON.stringify(payload), stderr: '' }),
      ['node', '/tmp/pm-ask.js', ...ASKS_LIST_TAIL],
      1000,
    )
    expect(ran).toBe(true)
    expect(feed.rows()).toEqual(payload)
  })
})
