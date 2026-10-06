type St = { key: string; glyph: string; word: string; color: string; done?: number; total?: number; el?: string; live?: number; stall?: number; dec?: number; unfrozen?: number }
export const STATES: St[] = [
  { key: '要你決定', glyph: '▲', word: '要你決定', color: 'warning', done: 3, total: 5, el: '12m', live: 2, dec: 1 },
  { key: '疑似卡住', glyph: '⏸', word: '疑似卡住', color: 'error', done: 3, total: 5, el: '15m', live: 2, stall: 1 },
  { key: '完成待驗收', glyph: '✓', word: '完成待驗收', color: 'success', done: 5, total: 5, el: '18m' },
  { key: '進行中', glyph: '●', word: '進行中', color: 'suggestion', unfrozen: 2, el: '6m', live: 1 },
  { key: '待命', glyph: '◌', word: '待命', color: 'inactive' },
]

export const PANE_ID = 'legend'

function Line(el: any, v: string, st: St, onInfo: () => void, hoverTip: boolean) {
  const { Box, Text, Button } = el
  const bar = st.total
    ? <Text><Text color="success">{'▰'.repeat(st.done!)}</Text><Text color="inactive">{'▱'.repeat(st.total - st.done!)}</Text>{' ' + st.done + '/' + st.total}</Text>
    : st.unfrozen ? <Text dimColor>{st.unfrozen + ' done*'}</Text> : null
  const glyph = <Text bold color={st.color}>{st.glyph}</Text>
  return (
    <Box flexDirection="column" key={'l' + st.key}>
      {v === 'v4a1' ? null : <Text dimColor>{'[' + v.toUpperCase() + '-' + st.key + ']'}</Text>}
      <Box>
        {hoverTip
          ? <Box key={'h' + st.key}>{glyph}<Box position="absolute" top={-1} left={2} display="none" hover={{ display: 'flex' }}><Text bold color={st.color}>{'(' + st.key + ')'}</Text></Box></Box>
          : glyph}
        {v === 'v4a' || v === 'v4a1' ? <Text bold color={st.color}>{' ' + st.word}</Text> : null}
        {bar ? <Text>{'  '}{bar}</Text> : null}
        {st.el ? <Text dimColor>{'  ◷ ' + st.el}</Text> : null}
        {st.live ? <Text>{'  ⚙ ' + st.live}</Text> : null}
        {st.stall ? <Text color="error">{'  ⏸ ' + st.stall}</Text> : null}
        {st.dec ? <Text color="claude">{'  ◆ ' + st.dec}</Text> : null}
        <Text>{'  '}</Text>
        <Button key={'i' + st.key} plain dimColor autoFocus hotkey="i" onPress={onInfo}>ⓘ</Button>
      </Box>
    </Box>
  )
}

export function V4(el: any, v: string, onInfo: () => void) {
  const { Box } = el
  const list = v === 'v4a1' ? STATES.slice(0, 1) : STATES
  return <Box flexDirection="column">{list.map((s, i) => Line(el, v, s, onInfo, i === 0 && v === 'v4a1'))}</Box>
}

export function Legend(el: any, onClose: () => void) {
  const { Box, Text, Button } = el
  const leg: [string, string, string][] = [
    ['▲', 'warning', '要你決定：有一件事卡在你的批准或選擇'],
    ['⏸', 'error', '疑似卡住：派工太久沒輸出（行尾 ⏸n = 卡住數）'],
    ['✓', 'success', '完成待驗收：做完了，等你看過'],
    ['●', 'suggestion', '進行中：正常跑，不用管'],
    ['◌', 'inactive', '待命：沒有任務在跑'],
    ['▰▱', 'success', '進度條：已完成 / 總數'],
    ['◷', '', '經過時間'],
    ['⚙', '', '正在跑的派工數'],
    ['◆', 'claude', '待你決定的事項數'],
    ['?', 'inactive', '未知狀態（資料不足）'],
  ]
  const W = [7, 64]
  const D = [12, 12, 12, 8, 8]
  const drows = [['grok-4.7', '實作 hand', '實作', '0:15', '—'], ['codex', '審查', '審查', '3:20', '3m ⏸'], ['sonnet', '工頭', '等待處置', '12:04', '—']]
  const cell = (c: string, w: number, bold = false, color?: string) => <Box width={w} flexShrink={0}><Text bold={bold} color={color}>{c}</Text></Box>
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box><Text bold>圖例</Text><Text>{'  '}</Text><Button plain dimColor role="dismiss" hotkey="x" onPress={onClose}>[ 關閉 ✕ ]</Button></Box>
      <Box>{cell('符號', W[0], true)}{cell('意思', W[1], true)}</Box>
      {leg.map(([g, c, m]) => <Box key={g}>{cell(g, W[0], true, c || undefined)}{cell(m, W[1])}</Box>)}
      <Text> </Text>
      <Text bold>目前</Text>
      <Box><Text bold color="warning">▲ 要你決定</Text></Box>
      <Text>{'專案  gate-sandbox4    階段  實作'}</Text>
      <Text>{'原因  等你批准：Bash: git commit -m …（2 分）'}</Text>
      <Text> </Text>
      <Box>{['runner', '角色', '階段', '經過', '安靜'].map((h, k) => cell(h, D[k], true))}</Box>
      {drows.map(r => <Box key={r[0]}>{r.map((c, k) => cell(c, D[k]))}</Box>)}
    </Box>
  )
}
