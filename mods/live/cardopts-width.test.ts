// cardopts-width.test.ts — the option rows of the card view (cardMain, band.tsx) never exceed the width the card was given,
// also when an option label wraps and its description hangs under the last label line (BL-0422 review 🟡: width 84 at cols 80).
import { test, expect } from 'claude-code/testing'
import * as B from './band'
import * as U from './ui'
import { makeT } from './i18n'

const children = (xs: unknown[]) => xs.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false)
const el = Object.fromEntries(['Box', 'Text', 'Link', 'Button', 'Input'].map(type => [type, (props: any) => ({ type, props, children: children([props.children]) })])) as any
const textOf = (n: any): string => (typeof n === 'string' ? n : n.type === 'Input' ? n.props.placeholder : n.type === 'Link' ? n.props.label : n.children.map(textOf).join(''))
const t = makeT('zh-TW')

const LONG = '這個選項的說明很長，會一直寫到超過一行的寬度，用來確認換行之後每一列都不會超出卡片給的寬度，而且英文 words also wrap properly under the label column'
const view = (width: number): any => ({
  key: 'k', question: '要選哪一個？', background: null, advice: null, notAuthorized: null, note: null, meta: null, locked: false, split: false, grey: false, fix: null, fill: null,
  options: Array.from({ length: 7 }, (_, i) => ({ label: i % 2 === 0 ? '一個很長的選項標籤會折成好幾行 long option label number ' + (i + 1) : '短', description: LONG, picked: false, recommended: i === 2, key: 'o' + i })),
  width, onPress() {},
})

test('cardMain: every row of a card with long wrapping labels and long descriptions fits the width it was given', () => {
  const bad: string[] = []
  for (const cols of [80, 90]) for (const maxRows of [6, 7, 8]) {
    // the main window is narrower than the body: the shell hands the card its inner width less the pad
    for (const width of [cols - 56, cols - 40, cols - 8, cols - 2, 30, 24, 20]) {
      const { rows } = B.cardMain(el, view(width), t)
      for (const r of rows) {
        const w = U.displayWidth(textOf(r))
        // a row is the pad cell plus text: the card's `width` already excludes the pad
        if (w > width + 1) bad.push(`cols${cols}/rows${maxRows}/w${width}=${w}: ${textOf(r)}`)
      }
    }
  }
  expect(bad.slice(0, 6).join("\n"), bad.length + ' rows too wide').toEqual("")
})
