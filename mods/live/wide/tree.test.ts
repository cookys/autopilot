import { test, expect } from 'claude-code/testing'
import { COLOR, PANE_COLOR } from './tree'

test('current tab uses the accessible remember theme key', () => {
  expect(COLOR.current).toBe('remember')
})

test('wide pane text never falls back to the terminal default colour (light pane was unreadable)', () => {
  for (const role of Object.keys(PANE_COLOR) as (keyof typeof PANE_COLOR)[]) expect(PANE_COLOR[role]).toBeDefined()
  expect(PANE_COLOR.text).toBe('inactive')
})
