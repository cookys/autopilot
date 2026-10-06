const FR = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export default function Spin(_p: any, s: any) {
  const { Box, Text } = s.elements
  if (s.state === undefined) { s.setState(0); s.every(1000, () => s.setState(((s.state ?? 0) + 1) % FR.length)) }
  const i = s.state ?? 0
  const blink = i % 2 === 0
  return (
    <Box flexDirection="column">
      <Box>
        <Text inverse backgroundColor="#ff5555" bold>{' 要你決定 '}</Text>
        <Text>{' gate-sandbox4 │ 實作 │ ██████░░░░ 60% (3/5) │ 12m '}</Text>
        <Text color={blink ? 'warning' : undefined} dimColor={!blink}>{FR[i]}</Text>
        <Text dimColor>{' tick=' + i + ' cols=' + s.columns}</Text>
      </Box>
      <Text dimColor>等你選 A 或 B</Text>
    </Box>
  )
}
