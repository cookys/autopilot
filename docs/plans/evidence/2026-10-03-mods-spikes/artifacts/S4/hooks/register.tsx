import type { Register } from 'claude-code'

const PANE = 'spike-image'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spike-image', description: 'S4: show a PNG via Image {file}' })
    return next(e)
  })

  on('command.run', { command: 'spike-image' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Image probe' })
    return { text: 'spike-image pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Image } = $.ui.resolve(e) as any
    const file = $.plugin.root + '/assets/probe.png'
    return (
      <Box flexDirection="column">
        <Text>You should see a 4-quadrant picture: red/blue top, green/yellow bottom, white diagonal.</Text>
        <Image source={{ file, format: 'png' }} columns={36} rows={12} alt="[image: 4 colour quadrants + white diagonal]" />
        <Text dimColor>file: {file}</Text>
      </Box>
    )
  })
}
