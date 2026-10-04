// mods/live/band.tsx — the one-line band above the prompt (plan P1c). Pure view: `el` is the surface table's
// constructors from $.ui.resolve(e) (Box and Text exist on every surface), `text` the snapshot's band text.
// No Image, no Raster: nothing here depends on a graphics protocol.

type El = (props: any) => any

export function Band(el: { Box: El; Text: El }, text: string) {
  const { Box, Text } = el
  return (
    <Box>
      <Text dimColor wrap="truncate">{text}</Text>
    </Box>
  )
}
