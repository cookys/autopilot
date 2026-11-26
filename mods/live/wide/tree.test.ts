import { test, expect } from 'claude-code/testing'
import { COLOR } from './tree'

test('current tab uses the accessible remember theme key', () => {
  expect(COLOR.current).toBe('remember')
})
