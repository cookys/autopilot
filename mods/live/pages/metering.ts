// mods/live/pages/metering.ts — r5 feedback pack (coverage per host) for the spend page.
// Pure: text in, rows out. A bad document is null; the page then draws the broken row and never a guessed count.
import { displayWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { brokenRow } from './rows'
import type { Row } from './rows'

export const METER_PACK_DIR = '/home/team/projects/capacity/out/r5-feedback'
export const METER_MAX_BYTES = 256 * 1024
// attention/warning is ~3.25:1 on 256-colour light. remember (PALETTE.action) stays >= 4.5:1 on both themes.
export const METER_WARN_COLOR = PALETTE.action
const WARN_AT = 0.10

export interface MeterHost {
  host: string
  expected: number
  got: number
  missing: number
  retention_days: number
  no_data: boolean
}

export interface MeterPack {
  generated_at: string | null
  hosts: readonly MeterHost[]
  evidenceLines: number | null
}

type T = (id: string, a?: Record<string, string | number>) => string

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseMeterPack(text: string): MeterPack | null {
  let j: unknown
  try { j = JSON.parse(text) } catch (_e) { return null }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return null
  const top = j as Record<string, unknown>
  const gate = top.evidence_gate
  const root = (typeof gate === 'object' && gate !== null && !Array.isArray(gate) ? gate : top) as Record<string, unknown>
  const cov = root.coverage
  if (typeof cov !== 'object' || cov === null || Array.isArray(cov)) return null
  const hosts: MeterHost[] = []
  for (const [host, raw] of Object.entries(cov)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const o = raw as Record<string, unknown>
    const expected = num(o.expected)
    const got = num(o.got)
    const missing = num(o.missing)
    const retention = num(o.retention_days)
    if (expected === null || got === null || missing === null || retention === null) return null
    if (o.no_data !== undefined && typeof o.no_data !== 'boolean') return null
    hosts.push({ host, expected, got, missing, retention_days: retention, no_data: o.no_data === true })
  }
  hosts.sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
  let evidenceLines: number | null = null
  if (root.evidence !== undefined) {
    if (typeof root.evidence !== 'object' || root.evidence === null || Array.isArray(root.evidence)) return null
    const lines = (root.evidence as Record<string, unknown>).lines
    if (lines !== undefined) {
      if (!Array.isArray(lines)) return null
      evidenceLines = lines.length
    }
  }
  const generated = root.generated_at
  return { generated_at: typeof generated === 'string' ? generated : null, hosts, evidenceLines }
}

const padR = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - displayWidth(text)))

const openRule = (title: string): Row => [{ text: GLYPHS.structure.open + ' ' + title + ' ' + GLYPHS.structure.rule.repeat(2), color: PALETTE.structure }]

export function meteringRows(pack: MeterPack | null, _nowMs: number, t: T): Row[] {
  if (pack === null) return [brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.meter_missing'))]
  const width = Math.max(0, ...pack.hosts.map(h => displayWidth(h.host)))
  const out: Row[] = [openRule(t('page.spend.meter_title'))]
  for (const h of pack.hosts) {
    const name = padR(h.host, width)
    if (h.no_data) {
      out.push([{ text: ' ' + name + '  ' + t('page.spend.meter_nodata') }])
      continue
    }
    const body = t('page.spend.meter_row', { got: h.got, expected: h.expected, missing: h.missing, days: h.retention_days })
    const warn = h.expected > 0 && h.missing / h.expected > WARN_AT
    out.push([{ text: ' ' + name + '  ' + body, ...(warn ? { color: METER_WARN_COLOR } : {}) }])
  }
  if (pack.evidenceLines === null || pack.evidenceLines === 0) out.push([{ text: ' ' + t('page.spend.meter_evidence') }])
  return out
}
