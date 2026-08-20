---
name: profiles-hash-repin
description: autopilot repo 內 dev-flow/ceo-agent SKILL.md 文字改動後的 profiles hash 鏈重釘順序——inventory 段位移、migration 重生、catalog 雙 hash + totals、codex 鏡像、測試釘值裁決。
---

# profiles hash 鏈重釘(dev-flow / ceo-agent 文字改動後)

rule-inventory 把兩個 skill 的每一行 prose 當 rule 清點;改動任何一行都會讓
`build-profile-payload.js catalog --check` 連環紅。正確順序(2026-08-20 三次紅試出;前例 0f7568fc):

1. `profiles/rule-inventory.json`:該 source 的 `sha256` 換新檔 hash;`segments[]` 的
   start/end_line 依插入點位移;**`duplicate_rule_sets[]` 的 owner 與 aliases 行號也要位移**(最易漏)。
2. `node scripts/build-profile-payload.js migration --out <scratch>` 重生 migration(拒絕覆寫,
   先寫 scratch 再 cp 回 `profiles/rule-migration.json`)。rule 數會變(每行 prose = 一條 rule)。
3. `profiles/profile-catalog.json`:更新 `inventory_sha256`、`rule_migration_sha256`、
   `category_totals`(從新 migration 重導出;**`obsolete: 0` 鍵要保留**)。
4. `catalog --check` 綠後,三檔 cp 到 `platforms/codex/plugin/profiles/`。
5. 測試釘值:`profile-context-isolation` / `codex-plugin-package` 的 canonical_rules 數字是
   drift guard,**裁決過的有意變更**才改;guided-compatibility 的 frozen baseline 數字**不動**
   (凍結快照;新增 rule 不需 disposition,disposition 只管 baseline rule 消失)。
6. per-skill ratchet:CHANGELOG 該版節要有 `prose-justification:` 行,否則 preflight gate 8 擋。

驗證:`catalog --check` rc=0 + 兩個測試檔串行綠 + 全套件。
