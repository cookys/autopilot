// R4-5: opt-in host-row diagnostic. No probe filesystem calls when the env is unset.
import type { EngineInterface } from 'claude-code'

type Node = { type?: string; props?: Record<string, any>; children?: unknown[] }
type Host = { props: { placement?: string; scroll?: { bodyRows: number } }; viewport?: { columns?: number; rows?: number } }
const children = (n: Node): unknown[] => [n.children ?? n.props?.children ?? []].flat(Infinity)
const nodes = (n: unknown): Node[] => n === null || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n as Node, ...children(n as Node).flatMap(nodes)]
const hasTabs = (n: unknown): boolean => nodes(n).some(x => x.type === 'Button' && (/^[0-9i]$/.test(x.props?.hotkey ?? '') || /^tab:/.test(x.props?.key ?? '')))

// Count the returned tree, independently of the host's bodyRows budget. Empty
// focus anchors take no row; an explicit empty spacer's height still counts.
function height(n: unknown): number {
  if (typeof n === 'string') return n === '' ? 0 : n.split('\n').length
  if (n === null || typeof n !== 'object') return 0
  if (Array.isArray(n)) return Math.max(0, ...n.map(height))
  const node = n as Node
  const hs = children(node).map(height)
  return typeof node.props?.height === 'number' ? node.props.height
    : node.props?.flexDirection === 'column' ? hs.reduce((a, b) => a + b, 0) : Math.max(0, ...hs)
}
function lastRow(n: unknown): unknown {
  if (n === null || typeof n !== 'object') return n
  const row = Array.isArray(n) ? n : children(n as Node)
  if (!Array.isArray(n) && (n as Node).props?.flexDirection !== 'column') return n
  const visible = row.filter(x => height(x) > 0)
  return lastRow(visible[visible.length - 1])
}

let pending: Promise<void> = Promise.resolve()
export async function probePane($: EngineInterface, e: Host, tree: unknown): Promise<void> {
  let path: string | undefined
  try { path = await $.env.get('AUTOPILOT_MODS_PANE_PROBE') } catch (_) { return }
  if (!path) return
  const framed = nodes(tree).filter(n => /^f\d+$/.test(n.props?.key ?? ''))
  const record = { ts: await $.clock.now(), placement: e.props.placement ?? null, bodyRows: e.props.scroll?.bodyRows ?? null,
    renderedRows: framed.length > 0 ? framed.length : height(tree), lastRowHasTabs: hasTabs(framed.length > 0 ? framed[framed.length - 1] : lastRow(tree)),
    termCols: e.viewport?.columns ?? null, termRows: e.viewport?.rows ?? null }
  // The host's fs API offers read/write, not append. Serialize the diagnostic's
  // read-modify-write within this mod instance so overlapping renders keep both lines.
  const append = async () => {
    let previous = ''
    try { previous = await $.fs.read(path) } catch (_) { /* first render creates the file */ }
    await $.fs.write(path, previous + JSON.stringify(record) + '\n')
  }
  pending = pending.then(append).catch(() => {}) // a diagnostic write failure must not blank the pane
  await pending
}
