## 目標

無進行中工作。這份 handoff 記錄 2026-09-04 第三段：**v2.36.0「dev-flow hetero loops as default」已 merge、push**（`f756fcf5`），
是第一個用自己的 review driver 審自己的版本。

## 現況

- **branch**: `develop`，與 `origin/develop` 同步（merge `f756fcf5`，之後兩個 docs commit：handoff、evidence-discipline §22–25）；working tree 乾淨；feature 分支已刪；session marker 已 clear；
  governance `enforce`、dogfood roster implementer `grok-4.5/high@grok`（派工期間暫切 gemini，已還原）。
- **version**: 2.36.0（30 skills，28 hooks：15/13）。新 skill `hetero-review`；三個新 script（`plan-rubric-scaffold.js`、
  `hetero-review-loop.js`、`check-phase-review-receipt.js`）＋ `scripts/lib/review-chain-derive.js`。
- **測試**: 全套 `run.sh --parallel 4` 277 檔綠含 serial 尾段；殘留 `contract-parity` 8、`resolve-review-loop-consult-discuss-switch` 3
  在 develop 上同樣紅（既有，`implementer_ladder[17]` template fallback ladder），`slash-entry-probe` 負載下 0-byte（preflight 的 LLM probe 8/8 綠）。
- **IN-FLIGHT**: 無派工。harness 鎖住的 `.claude/worktrees/agent-*` 已 reap（若還有殘留是 harness 鎖，`git worktree prune` 即可）。

## 已路由出去的耐久內容（本段補的）

- `references/evidence-discipline.md` §22–25（stub 比真程式寬鬆、測試後門漏進 production、工頭「綠」是主張、`auto` 預設洩漏主機狀態）；sol 審過（docs-only diff，第一輪 MUST-FIX 是我送審範圍漏了 archive 副本，補全後 SHIP）。
- `skills/ceo-agent/references/level-front-door.md`：工頭 DONE 線含全套 suite 平行段（改共享契約時）。
- archive ledger：`brief-common.md`、`brief-d1-example.md`、`watch-hetero.sh` 副本（scratchpad 會隨 session 消失）；`D5.md` 有說明。
- BACKLOG：dispatch-watch script 升級、hands diff 的 fixture 字面 lint。
- memory：`hetero-review-loop-dogfood-lessons`（新）、`dispatch-plan-review-contract`（補 RUNNERS 無 kimi、無 plan_reviewer 角色、growth 1.28×）。

## 已決事項(不重議)

- 四段預設（plan loop → 派工 → per-phase hetero review → qc gate）是 opt-out；三個 knob `auto|on|off`，缺席＝auto、亂值 exit 3、
  topology 缺席走 native fallback＋warning、`auto` 跳過與 implementer 同 runner／家族的席。
- `union-on-verified-critical` 只認 verified Critical（與 qc 同義）；verified Major/Minor 是 `open_findings`，出貨前該修就修（本版 g3 的三個 Major 修了再跑 g4）。
- kimi 不進 `dispatch-plan-review.js` RUNNERS（plan review R6：driver byte-identical）——BACKLOG。
- receipt 的 head 綁定 vs closeout docs commit：誠實做法是 reviewed head 跑 checker 記 ledger；BACKLOG 有 allowlisted-only delta 放行候選。
- 舊 driver 寫的 chain 缺新欄位時，從 artifact＋git 重算補齊並記 ledger（checker 全部重推，不加信任）。

## 下一步

1. **P5 fleet rollout（v2.35.16 拓樸，cuda 優先）仍待 owner 在 cuda 授權**；v2.36.0 各主機 `dev-update.sh` 後 `resolve-dispatch-topology.js` 重生 cache
   （stale cache 會讓 `auto` 退 native fallback——BACKLOG 有 row）。
2. BACKLOG 新增 14 筆（本版）：優先 `normalize_agy_alias` 排除比對、stale topology cache、receipt head 放行、allowlist 去重、`--min-reviewed-seats` 多席 fixture。
3. 未收的 g1 finding `42864072`：`dispatch-consult-hermetic.test.sh` 仍只驅動 resolver，未真的呼叫 `dispatch-consult.sh`（D2-repair-2 C3 嘗試失敗）。
4. owner 未決：這台 dogfood 是否切 `implementer_ladder: auto`（會讓 9 條 roster 釘值失效、review 姿態降 low）。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 空
git log --oneline -1                # f756fcf5
node -p "require('./.claude-plugin/plugin.json').version"   # 2.36.0
bash scripts/resolve-review-loop.sh --field plan_review_resolved_from   # topology
node scripts/check-phase-review-receipt.js --repo-root "$PWD" --ledger docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger --phase core --branch develop --phase-base 1e5c2841   # exit 1（head 已被 docs commit 推走——預期，見 BACKLOG）
```

## Read-order

1. `CHANGELOG.md` v2.36.0 節（QC 段＝四代 review 的帳）。
2. `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D5.md`（closeout、g1 back-fill）與 `D5-integration.md`（suite 漂移三次 pass）。
3. `skills/hetero-review/SKILL.md` 與兩份 references——這是 owner 原話的入口。
4. memory `hetero-review-loop-dogfood-lessons`。

## 陷阱

- 工頭只跑自家 DONE 線；resolver 契約一動全 suite 漂移。**每個 deliverable 整合前跑全套**。
- `auto` 預設會把主機 topology 漏進測試 fixture：釘 `AUTOPILOT_TOPOLOGY_FILE` 到不存在路徑。
- agy 15 分鐘空 log 停滯；brief >10 KB 幾乎必停；拆 ≤8 KB。
- gemini-low 修多約束 driver 檔會來回；同檔第三次直接 medium／high 或 sonnet 原生 hands。enforce 下 raw hetero 必拒。
- `sync-version.js` 不管 README 的 skills badge，要另外改（skill-count-metadata 會抓）。
- 全套 suite 的 `ALL TESTS PASSED` 是平行段；看整份 log 的 `FAIL [x] n passed, m failed` 行。

## 上一段（2026-09-04 前半／中段，已出貨）

v2.35.16 拓樸（見前一版 handoff 與 archive）；同日 v2.36.0 從設計、plan loop（兩代、21 blocker）、五個 deliverable、六位 sonnet 工頭、三十餘把 gemini 刀、
四代自審到 merge 一天完成。
