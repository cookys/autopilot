// console v5 P5b: the wide pages' live readers
import { test, expect } from 'claude-code/testing'
import { ctxPctOf, untilText } from './data'

test('ctxPctOf reads the context text; a dash or a not-wired text is null', () => {
  expect(ctxPctOf('42%')).toBe(42)
  expect(ctxPctOf(' 81.6% ')).toBe(82)
  expect(ctxPctOf('—')).toBe(null)
  expect(ctxPctOf('來源未接')).toBe(null)
  expect(ctxPctOf(null)).toBe(null)
})

test('untilText writes the time to a reset as the design does', () => {
  const now = 1_000_000_000
  expect(untilText(null, now)).toBe(null)
  expect(untilText(now + 130 * 60_000, now)).toBe('2h10m')
  expect(untilText(now + 120 * 60_000, now)).toBe('2h')
  expect(untilText(now + 45 * 60_000, now)).toBe('45m')
  expect(untilText(now + 4 * 24 * 60 * 60_000, now)).toBe('4d')
  expect(untilText(now - 60_000, now)).toBe('0m')
})
