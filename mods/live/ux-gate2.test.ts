import { test, expect } from 'claude-code/testing'
import { PALETTE, drawSeg } from './ui'

test('Y6: the drawing helper admits semantic theme roles and rejects legacy raw colour escapes', () => {
  for (const color of Object.values(PALETTE)) expect(drawSeg({ text: '合成文字', color }).color).toBe(color)
  for (const color of ['\u001b[38;5;153m', '\u001b[38;5;220m', '38;5;153', '38;5;220', '#afd7ff', '#ffd700']) {
    expect(drawSeg({ text: '合成文字', color: color as never }).color).toBeUndefined()
  }
})
