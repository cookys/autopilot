// questionAfterTitle: the text drawn after a card's title, never repeating the title.
import { test, expect } from 'claude-code/testing'
import { questionAfterTitle } from './cardtitle'

test('questionAfterTitle: equal -> nothing; prefix -> the rest; otherwise 「：」 + question', () => {
  expect(questionAfterTitle('丙線', '丙線')).toBe('')
  expect(questionAfterTitle(' 丙線 ', '丙線  ')).toBe('')
  expect(questionAfterTitle('丙線：測試綠了，合併到 develop', '丙線：測試綠了，合併到 develop 嗎？')).toBe('嗎？')
  expect(questionAfterTitle('合併 plan ', '合併 plan 要不要合？')).toBe('要不要合？')
  expect(questionAfterTitle('合併 plan', '要不要把計畫合進 develop？')).toBe('：要不要把計畫合進 develop？')
  expect(questionAfterTitle('丙線', '')).toBe('：')
})
