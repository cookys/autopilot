type St = { key: string; glyph: string; word: string; color: string; done?: number; total?: number; unfrozen?: number; el?: string; live?: number; stall?: number; dec?: number; nodec?: number; phase?: string; reason?: string }
const STATES: St[] = [
  { key: '要你決定', glyph: '▲', word: '要你決定', color: 'warning', done: 3, total: 5, el: '12m', live: 2, dec: 1, phase: '實作', reason: '等你批准：Bash: git commit -m …（2 分）' },
  { key: '疑似卡住', glyph: '⏸', word: '疑似卡住', color: 'error', done: 3, total: 5, el: '15m', live: 2, stall: 1, phase: '審查', reason: '最久的派工 3 分沒有輸出' },
  { key: '完成待驗收', glyph: '✓', word: '完成待驗收', color: 'success', done: 5, total: 5, el: '18m', phase: '收尾' },
  { key: '進行中', glyph: '●', word: '進行中', color: 'suggestion', unfrozen: 2, el: '6m', live: 1, phase: '實作' },
  { key: '待命', glyph: '◌', word: '待命', color: 'inactive' },
]
const PROJ = 'gate-sandbox4'

function Band(el: any, v: string, st: St, cols: number) {
  const { Box, Text } = el
  const bar = () => {
    if (st.total) {
      const f = '▰'.repeat(st.done!), e = '▱'.repeat(st.total - st.done!)
      return <Text><Text color="success">{f}</Text><Text color="inactive">{e}</Text><Text>{' ' + st.done + '/' + st.total}</Text></Text>
    }
    if (st.unfrozen) return <Text dimColor>{st.unfrozen + ' done*'}</Text>
    return null
  }
  const parts: any[] = []
  parts.push(<Text bold color={st.color}>{st.glyph + ' ' + st.word}</Text>)
  if (v !== 'v2') parts.push(<Text>{'  ' + PROJ}</Text>)
  const b = bar()
  if (v === 'v2') {
    if (b) parts.push(<Text>{'  '}{b}{st.phase ? <Text dimColor>{' ' + st.phase}</Text> : null}</Text>)
  } else {
    if (st.phase) parts.push(<Text>{'  ' + st.phase}</Text>)
    if (b) parts.push(<Text>{' '}{b}</Text>)
  }
  if (st.el) parts.push(<Text dimColor>{'  ◷ ' + st.el}</Text>)
  if (st.live) parts.push(<Text>{'  ⚙ ' + st.live}</Text>)
  if (st.stall) parts.push(<Text color="error">{'  ⏸ ' + st.stall}</Text>)
  if (st.dec && v !== 'v2') parts.push(<Text color="claude">{'  ◆ ' + st.dec}</Text>)
  if (st.nodec && v !== 'v2') parts.push(<Text color="inactive">{'  ? ' + st.nodec}</Text>)
  const withReason = !!st.reason
  const w = v === 'v3' ? Math.max(10, cols - 4) : cols
  const inner = (
    <Box flexDirection="column" width={w}>
      <Text wrap="truncate">{parts}</Text>
      {withReason ? <Text wrap="truncate" dimColor>{'  ' + st.reason}</Text> : null}
    </Box>
  )
  return (
    <Box flexDirection="column" key={st.key}>
      <Text dimColor>{'[' + v.toUpperCase() + '-' + st.key + ']'}</Text>
      {v === 'v3' ? <Box borderStyle="round" borderColor={st.color} paddingX={1}>{inner}</Box> : inner}
    </Box>
  )
}

export function Variant(el: any, v: string, cols: number) {
  const { Box } = el
  return <Box flexDirection="column">{(v === 'v3b' ? STATES.slice(3) : v === 'v3' ? STATES.slice(0, 3) : STATES).map(s => Band(el, v.slice(0, 2), s, cols))}</Box>
}
