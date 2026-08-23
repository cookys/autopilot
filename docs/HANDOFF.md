## 目標

**北極星**(ADR-0001):強模型治理 = 管 outcome/evidence 不管 process。本 session
(2026-08-23)在 CEO 授權下連出四版並清空所有已觸發的 backlog 條目;結束時 backlog 處於
罕見的「**全部未觸發**」乾淨態。CEO 授權止於本 session,新 session 重新確認。

## 現況

- Branch:`develop`,**乾淨**,已推 origin(`a97df694`)。無 stash、無殘枝、單一 worktree。
- 本 session 出貨四版(全部走 `/l4` foreman + sonnet leaves + depth-0 三席權威 panel):
  - **v2.34.35** `687f9e56` — strike-decay:四顆日曆牙全拔,資格降級改成犯錯累積(Board 裁示機器化)
  - **v2.34.36** `323f045f` — official qualification defaults:17 列官方成績單隨 plugin 出貨
  - **v2.34.37** `9c8daa6c` — fix bundle:真實時鐘 instant + 兩個 flaky 上界改負載相對
  - **v2.34.38** `a97df694` — test-integrity:anti-gaming 閘第一次看得見本 repo 的 300 個套件
- Board 兩件積案已裁決(`97c48b0a`):tree-engine graduation **ABORT**(72 天只 2/50 樣本,
  `board_signoff{decision:abort,active:false}` 已入 tree ledger);fable-skills absorption
  **NOT-PURSUED**(價值大半已被後續出貨吸收,plan 蓋章保留不刪)。
- 全套件 275/275、preflight 8/8(ratchet 債已於 `754df354` 以逐條歸因的 prose-justification
  清償並 refresh baseline)。
- Task list:#1-#4 全 completed。

## 已決事項(不重議)

- **資格不因日期失效**(v2.34.35):expires 純 advisory;降級唯一路徑 = strike 累積過門檻 →
  `requalify_required`;唯一出口 = 重考通過開新 epoch(append-only)。ordinary strike 在
  **SHADOW**(`AUTOPILOT_STRIKE_ENFORCEMENT=enforce` 才上牙),critical registry 立即執法。
  strike-blocked 席**不可**被 operator override 洗掉。
- **官方預設不得蓋寫本地證據**(v2.34.36):含誠實 FAILED 列;`--force` 只能重採納先前的
  official-default。「簽署」實作為 **disclosure 非 attestation**(ADR-0001,零 digest 欄位)。
- **test-integrity 停在 `warn` 不設 `block`**(v2.34.38):block 會擋掉幾乎每個誠實的測試維護
  commit 然後被關掉。升級 block 需獨立的準確度紀錄(已立 row)。
- **閘門修復的驗收方式**:depth-0 必須自己植入作弊實測,不信自述;要求「列舉文法 + 具名
  未覆蓋類別」而非「修掉回報的 bug」。
- ADR-0001、rerun-until-green 禁止、TTL advisory —— 照舊。

## 下一步

1. **`/next` 重掃**。目前 backlog **58 條全部未觸發**——無事可撿是正常態,不是漏看。
   最近可能點燃的:`validate-json-schema` 拒絕小數(下個帶浮點的 artifact)、
   `engine-qualify-impl` 不明紅的歸因半件(下次它跑紅,證據這次會在)。
2. ~~未歸檔的專案目錄~~ — **已於 `a1aae042` 完成**。四個(含 `2026-08-21-p6d-orchestration-incident`,
   判定歸檔:矯正專案已歸檔、殘餘工作是有 trigger 的 BACKLOG 條目)全部移入 `_archive/`,
   INDEX 進行中表清空、零 orphan;live 參照(BACKLOG／CHANGELOG／test-integrity 設定與測試註解)
   重指、被移動 README 的相對連結重算深度;凍結的 plan doc 依慣例保留原路徑。
3. **日期覆審**:ordinary-strike 上牙門檻 row **2026-11-22 前必須重讀**,即使什麼都沒發生。

## 驗證方式

```bash
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh   # 8/8 (v2.34.38)
bash hooks/tests/run.sh --parallel 8                             # 275/275
bash hooks/tests/check-test-integrity.test.sh                    # 135 assertions
# 閘門現役實測(注意 base 必須含設定檔,否則會誤判成沒生效):
H=$(git rev-parse HEAD); sed -i '0,/assert_/{/assert_/d}' hooks/tests/risk-counter.test.sh
git commit -qam PLANTED && bash scripts/check-test-integrity.sh validate --range ${H}..HEAD
# 期望:source=base, matched=1, violations=[deleted_line];驗完 git reset --hard -q $H
```

## Read-order

1. `/home/cookys/projects/autopilot/docs/BACKLOG.md` — 58 條開放條目;每條的 Trigger 才是
   重點(白話解析網頁:https://claude.ai/code/artifact/cb60925d-25b4-4bb9-8f00-47d9649f758a)
2. `/home/cookys/projects/autopilot/references/strike-decay.md` — v2.34.35 的降級契約
3. `/home/cookys/projects/autopilot/references/qualification-defaults.md` — v2.34.36 的預設值契約
4. `/home/cookys/projects/autopilot/.claude/test-integrity-config.md` — v2.34.38 的閘門設定 +
   五類具名未覆蓋缺口
5. `~/.claude/projects/-home-cookys-projects-autopilot/memory/MEMORY.md` — 本 session 新增三條

## 陷阱

- **並行 session**:`origin/docs/2026-08-23-coding-harness-consolidation-decision` 是**另一個
  session** 的在途架構決策(R0 + 三份 attack review),**不要碰、不要合、不要評**。本 session
  期間它還造成過兩次干擾(未歸屬的 `.opencode` 版本 bump、殘留 sleep 程序)。
- **test-integrity 設定從 base commit 讀**(防作弊者自帶寬鬆設定):測試 range 的 base 必須
  含 `.claude/test-integrity-config.md`,否則回 `source: template, matched: 0`,會被誤判成
  「修了沒生效」。
- **`.claude/knowledge/` 是已追蹤檔**,但目錄層在 .gitignore —— `git add` 會噴 ignored 警告,
  實際上已 staged。別被訊息騙去用 `-f`。
- **qc-gate 只認 `QC-Verdict: PASS` 字彙**,`SHIP-AS-IS` 不吃;且 trailer 必須與
  `Co-Authored-By` 同末段(舊律,仍有效)。
- **foreman 停車不自醒**:它等自己的背景子程序時不會被喚醒,只有 depth-0 `SendMessage` 能救。
  brief 裡要明令「blocking foreground waits only」,否則每次收尾都要人工戳。
- **CC foreman 的 `owner_absent` 是假象**:`stage-acquire` 跑在瞬時 shell 裡,PID 隨即消失,
  watcher 判 dead 但 agent 還活著。看 git artifacts,別信這個訊號。
- 判紅只信 Summary 段;`preflight-release-routing` 裡的六行 `FAIL [slash-entry-probe]` 是
  嵌套 fixture,該套件本身 9/9 綠 —— 皆前 session 舊律,仍有效。
