// K1: forge uses the same fixed frame and navigation as every other page.
import type { Page } from './frame'
import { recentColumn, speedColumn } from '../speedview'

export const forgePage: Page = {
  id: 'forge', key: '', title: '鍛', framed: true,
  render(ctx) {
    const steps = ctx.steps ?? []
    const body = speedColumn(steps, ctx.t, ctx.size.cols).lines
    return { body: steps.length === 0 ? body : [...body, [{ text: '' }], ...recentColumn(steps, 8, ctx.size.cols, ctx.t).lines], actions: [] }
  },
}
