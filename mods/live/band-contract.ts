// Shared numbers and glyphs for the collapsed band and the codeforge statusline.
// band-statusline-contract.json is the only editable copy. A hooks module imports only code
// files and cannot import node builtins, so gen-band-contract.js compiles that JSON into
// band-contract-data.ts (values equal the JSON; drift fails gen-band-contract.js --check).
// The published per-session band-facts file copies this same object (see band-statusline-map.md).
// ◷ (`age`) means elapsed. That sentence stays in the map; it is not a contract key.

import { pctInt } from '../tux/format.ts'
import { BAND_CONTRACT_RAW } from './band-contract-data.ts'

export type BandContract = {
  quota_warn_pct: number
  quota_error_pct: number
  round: 'floor'
  bar_on: string
  bar_off: string
  alert: string
  age: string
}

function loadContract(raw: {
  quota_warn_pct: number
  quota_error_pct: number
  round: string
  bar_on: string
  bar_off: string
  alert: string
  age: string
}): BandContract {
  if (raw.round !== 'floor') throw new Error('band-statusline-contract: bad shape')
  if (typeof raw.quota_warn_pct !== 'number' || typeof raw.quota_error_pct !== 'number') throw new Error('band-statusline-contract: bad thresholds')
  if (typeof raw.bar_on !== 'string' || typeof raw.bar_off !== 'string' || typeof raw.alert !== 'string' || typeof raw.age !== 'string') {
    throw new Error('band-statusline-contract: bad glyphs')
  }
  return {
    quota_warn_pct: raw.quota_warn_pct,
    quota_error_pct: raw.quota_error_pct,
    round: 'floor',
    bar_on: raw.bar_on,
    bar_off: raw.bar_off,
    alert: raw.alert,
    age: raw.age,
  }
}

export const BAND_CONTRACT: BandContract = loadContract(BAND_CONTRACT_RAW)

// 'over' at the contract's error percent, 'warn' at the warn percent, else 'ok'. Judged on the raw ratio.
export function ratioLevel(ratio: number): 'ok' | 'warn' | 'over' {
  const warn = BAND_CONTRACT.quota_warn_pct / 100
  const over = BAND_CONTRACT.quota_error_pct / 100
  return ratio >= over ? 'over' : ratio >= warn ? 'warn' : 'ok'
}

// Integer percent, floored. The epsilon keeps a ratio that is an integer percent from reading one below (0.58 * 100).
export function floorPercent(ratio: number): number {
  if (BAND_CONTRACT.round !== 'floor') throw new Error('band-statusline-contract: round is not floor')
  return pctInt(ratio)
}
