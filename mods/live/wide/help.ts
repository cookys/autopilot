// mods/live/wide/help.ts — console v5 wide 9 說明 page. Pure: static legend & key table (no scroll keys; includes e, Tab, g).
import { GLYPHS } from '../../tux/glyphs'
import type { WidePageOut } from './types'

const FOLDED = GLYPHS.structure.folded
const SECTIONS = ['狀態圖示', '按鍵表', '符號'] as const

export function wideHelp(focus: number): WidePageOut {
  const idx = Math.max(0, Math.min(SECTIONS.length - 1, focus))
  const s = GLYPHS.state
  const g = GLYPHS.structure
  const list = ['說明', ...SECTIONS.map((name, i) => `${i === idx ? FOLDED : ' '} ${name}`)]

  let reply: string[]
  if (idx === 0) {
    reply = [
      `${s.running} 進行中  ${s.done} 完成／已選  ${s.failed} 失敗  ${s.stalled} 讀不到  ${s.findings} 過時  ${s.need_you} 要你動手`,
      `${FOLDED} 目前這一筆  ${g.recommend} 建議  ${g.answer} 已送出  ${s.waiting} 等人`,
      '底列左邊是狀態，右邊是分頁；數字鍵直接切頁。',
    ]
  } else if (idx === 1) {
    reply = [
      '1–9        切到第 N 頁',
      'j/k        換一筆（待決頁用 p/n 換張）',
      'o          展開焦點列（待決頁沒有）',
      'a/b/c      選選項（待決、待辦）',
      'f          沒選的卡填成建議',
      'm          寫附註（只有待決）',
      's / y / x  送出前先預覽 / 確認 / 取消',
      'g          複製等你動手卡的網址',
      'Tab        換到下一頁',
      'e          展開來龍去脈（待決卡預設收起）',
      'Esc        待決回輸入框；其他頁關閉',
      'Enter      附註輸入中：存附註',
    ]
  } else {
    reply = [
      `${g.open} 展開  ${g.folded} 收起  ${g.info} 說明`,
      `${g.speed} 速度  ${g.residue} 殘留  ${g.recommend} 建議`,
    ]
  }

  return {
    stepTitle: SECTIONS[idx],
    list,
    reply,
    hints: 'j/k 換段 · Esc 關閉',
    summary: '狀態圖示與按鍵表',
    hist: null,
  }
}
