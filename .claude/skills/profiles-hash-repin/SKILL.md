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

### 改寫既有行(不是純新增)時多一步(2026-09-07 ladder P4 試出)

把 ceo-agent/dev-flow 的某一行**改字**(而非插入新行),那一行若在 P0 guided baseline 裡,`catalog --check` 會報
`PROFILE_GUIDED_COMPATIBILITY_DRIFT: guided compatibility lost baseline rule <content_hash>`。處置:

1. 用**舊** migration 找那個 hash 是哪一行:`git show HEAD:profiles/rule-migration.json` 內 `mappings[].source.content_hash`。
2. 用**新** migration 找改寫後那行(與伴隨新增行)的 `content_hash` 當 successor。
3. `profiles/guided-baseline-dispositions.json` 追加 `{content_hash, disposition:"rewritten", successor_hashes:[…], rationale}`
   (rationale 要寫 P0 路徑:行號、改了什麼、沒改什麼);`removed` 才不帶 successor。
4. `profile-catalog.json` 的 `guided_dispositions_sha256` 換成新檔 sha;四檔(inventory/migration/catalog/dispositions)cp 到 codex mirror。
5. checker **一次只報一條** lost rule——補一條、重跑、再補,直到 rc=0。

另:migration 的 category 總數從 `mappings[].category` 數;`canonical_rule_count` 就是測試釘值要改的數字。

## 附:新增一個 hook 時的釘值清單(2026-09-07 `dirty-protected-paths` 試出)

改的不是 SKILL.md prose 而是 hook 接線時,鏈是另一條,順序:

1. `hooks/hooks.json` 接線(+ Codex 端 `platforms/codex/hooks/hooks.json` 若要掛,再加 `sync-codex-plugin-skills.sh`
   的 source/dest mapping 與 `check_exact_directory_entries "hooks" …` 清單)。
2. `profiles/hook-classes.json` 加一列(`invariant_effect` 或 `guidance`),否則 `build-profile-payload.js build`
   報 `PROFILE_HOOK_DRIFT: hook classes must classify every wired hook exactly once`。
3. `profiles/profile-catalog.json` 的 `hook_classes_sha256` 換成 `sha256sum profiles/hook-classes.json`,否則
   `catalog --check` 報 `PROFILE_SOURCE_DRIFT: hook classes does not match the profile catalog`。
4. 數字:`sync-version.js --hook-count N`(plugin.json / marketplace.json 描述)、README 兩份 badge `hooks-N`
   (sync-version **不改 badge**,要手動 sed)、`hooks/README.md` 頂部句與 `## Tier A — Default-On (N hooks)` 標頭、
   CLAUDE.md「N hooks (M default-on」;`hooks/tests/check-hook-inventory.test.sh` 寫死的 16/17 要跟著動。
5. `hooks/tests/codex-plugin-package.test.sh` 的 sandbox 只 seed 指定檔案:新 hook 要加進 mapping 表、
   exact-entries 清單與 seed/cp 兩段,否則「support payload drift」假紅。
6. 三檔(hook-classes / catalog / hooks.json)cp 到 `platforms/codex/plugin/`——跑 sync script 即可。

驗證:`node scripts/check-hook-inventory.js --check` rc=0、`catalog --check` rc=0、`codex-plugin-package` 綠。

