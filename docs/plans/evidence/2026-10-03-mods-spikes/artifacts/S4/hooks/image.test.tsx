import { test, expect } from 'claude-code/testing'

test('terminal pane draws an Image whose source is the PNG file', async ($, on) => {
  const ui = await $.ui.mount({ plugin: 'spike-image', surface: 'terminal', component: 'Pane', requestId: 'spike-image', props: {}, viewport: { columns: 100, rows: 30 } } as any)
  const img = await ui.find({ type: 'Image' })
  expect(img).toBeDefined()
  expect(JSON.stringify(img!.props.source)).toContain('probe.png')
  await ui.unmount()
})

test('desktop surface: what does mounting the Image tree do?', async ($) => {
  const ui: any = await $.ui.mount({ plugin: 'spike-image', surface: 'desktop', component: 'Pane', requestId: 'spike-image', props: {}, viewport: { columns: 100, rows: 30 } } as any)
  const img = await ui.find({ type: 'Image' })
  const texts = await ui.find({ type: 'Text' })
  console.log('desktop: Image found =', img !== undefined, '| first Text =', JSON.stringify(texts?.text))
  expect(true).toBe(true)
})
