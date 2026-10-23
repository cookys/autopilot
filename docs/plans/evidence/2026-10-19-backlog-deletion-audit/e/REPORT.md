# BACKLOG 多列刪除 commit 稽核(e 組)

範圍:`5d0b29c1d`、`bc2d36464`、`2879dac8c`、`9d45531e2`、`dc02e22af`、`ef5d5defc`、`eea9b3173`、`1631709a7`、`a588cd948`、`61ca80aeb`,另確認 `e70de5492`。唯讀稽核,未改 repo。逐列明細見 `rows.tsv`(同目錄)。

分類:A 已完成 / B 已轉移 / C 誤刪 / D 有意放棄 / U 未確認。

## 總表

| commit | 日期 | 刪列 | A | B | C | D | U |
|---|---|---:|---:|---:|---:|---:|---:|
| 5d0b29c1d | 08-01 | 67 個 `###` + 6 個 Resolved 條目 + 5 個 `##` 區段 = 78 | 49 | 19 | 6 | 2 | 2 |
| bc2d36464 | 08-02 | 11 | 11 | 0 | 0 | 0 | 0 |
| 2879dac8c | 08-03 | 4 | 4 | 0 | 0 | 0 | 0 |
| 9d45531e2 | 08-04 | 4 | 4 | 0 | 0 | 0 | 0 |
| dc02e22af | 08-05 | 14 | 14 | 0 | 0 | 0 | 0 |
| ef5d5defc | 07-30 | 12 | 12 | 0 | 0 | 0 | 0 |
| eea9b3173 | 07-31 | 7 | 7 | 0 | 0 | 0 | 0 |
| 1631709a7 | 08-28 | 14 | 12 | 0 | 0 | 2 | 0 |
| a588cd948 | 08-17 | 3 | 2 | 1 | 0 | 0 | 0 |
| 61ca80aeb | 06-01 | 4 | 4 | 0 | 0 | 0 | 0 |
| e70de5492 | 09-14 | 0 | — | — | — | — | — |

C 類共 6 列、未確認 2 列,全部出在 5d0b29c1d。其餘 9 個 commit 沒有誤刪。

說明:任務說 5d0b29c1d 是「67 個標題 + 16 個表格列」。我實際數到 67 個 `###` 標題、6 個 Resolved 區的條目列、5 個 `##` 區段(其中 3 個只是 `##` 改 `###` 並改名),合計 78。「16」我對不上,可能指別的東西;所有被刪的 `###`/Resolved/`##` 內容我都分類了。

## 各 commit 小節

### 5d0b29c1d(2026-08-01 docs: reconcile backlog and archive completed projects)
commit 訊息只說「reconcile backlog、archive completed projects」,沒有逐列依據;QC trailer 是 PASS-WITH-BASELINE。這個 commit 有一部分是改名而不是刪除:舊標題被改寫(例如 `CLAUDE.md 逼近 40k...餘裕 54 bytes` 變成 `...目前僅餘 6 bytes`),所以 `rows.js` 把它們算成刪除。我逐列對過,這種算 B。

- A(49):自稱 DONE/SHIPPED/RESOLVED 的列,我都對上 CHANGELOG 版本標題(v2.14.0、2.17.x、2.25.x、2.26.x、2.28-2.32.x)並確認引用的 commit 存在。另外有幾條表面看不出狀態的,我自己找到出貨證據:[3] reviewer_endpoint 接線(v2.32.46)、[7] check-test-integrity-l1 固定 /tmp 路徑(aedce0057 已移除)、[22][24][25] (v2.31.13/v2.31.18)、[47][49](fd-0 讀取修掉 ENXIO)、[39](agy bwrap 隔離,bc2d36464)、`dispatch-hetero strict postcheck emits empty status`(b496add8d 與其測試)。
- B(19):改名後留在新檔,之後在別處走完。細節見 rows.tsv。幾個值得知道的去向:`SHA-256`(0db64c610 修掉)、`context-budget T3 deny tier`(由 owner 卡片在 293cdaa8b 關閉 BL-0064)、`OpenCode debug skill truncation`(18b73df05 關閉)、`First local runner capability semantics` 與兩個 Codex payload 列仍在現行 BACKLOG。
- D(2):[44] agent-skills 拒絕項(理由在 docs/plans/2026-06-24-agent-skills-learnings.md)、[61] M3 單輪任務死路(結論在 archive 專案 report.md)。
- C(6)、U(2):見下表。

### bc2d36464(08-02 archive backlog convergence)
11 列全部標 SHIPPED,對得上 archive README(2026-08-01-backlog-convergence)與 merge 952df77ad(已在 develop)。程式碼檔案存在(src/readiness/qualification-provider.js、scripts/mission-terminal-reconcile.js、src/engine/controller-execution.js、hooks/tests/codex-enforcement-probe.test.sh)。注意:CHANGELOG v2.34.x 沒有逐項列這 11 項,證據是 merge 與程式檔,不是 CHANGELOG。11 列全 A。

### 2879dac8c(08-03 archive backlog actionable successor)
4 列,archive README 的 intake accounting 表明列為 Completed and removed,merge fa076b3c 存在。commit 另外新增一列「Strict /l5 provider-readiness CLI trust root」,該列由 9d45531e2 的 D4 收掉。4 列全 A。

### 9d45531e2(08-04 prepare v2.34.2)
4 列標 COMPLETE(D1-D4),CHANGELOG v2.34.2 逐項對得上,archive commit 312a41c58 存在。4 列全 A。列上的「獨立驗證仍由 depth-0 負責」字樣,我沒有額外複驗 depth-0 驗證本身,只確認程式與 CHANGELOG 存在。

### dc02e22af(08-05 dispatch-hetero(grok) edits on mission next-touch-debt-retirement-a5)
14 列全是 PLANNED(D1-D8),被這個 mission 節點一次刪掉。archive README 列 D1-D8 complete,我抽驗了程式實體(multiplexer、verify-strength、grok A/B、sealed-zero-diff-validator、explicit identity verdict、numeric HTTP quota gate、identifier-scan path 入口),都在。14 列全 A。風險說明:這個 commit 是 mission 中途的 grok 編輯 commit,刪除與實作同批,archive README 自己寫 terminal gate 才擁有 develop 整合,我確認內容已在 develop(branch contains),但沒有重驗整合 gate 的 receipt。

### ef5d5defc(07-30 prepare v2.34.1 controller execution)
12 列 P0/Mission 債,CHANGELOG v2.34.1 的 Added/Changed/Fixed 逐項對應,並抽驗 awaiting_disposition、min_panel_size、boundary_rejected、RUN_LEDGER_MAX_BYTES、max_leaf_worktrees、work-order 在程式裡。commit 同時新增兩個後繼列(Codex PostCompact wiring、session-local qualification provider),後者在 bc2d36464 收掉,前者在 9d45531e2 收掉。12 列全 A。

### eea9b3173(07-31 archive B/C backlog package)
7 列對應 archive 專案 correctness-gates(4)與 evidence-eval-truth(3),merge 9f26e0822,各項修補 commit 都找到(1361dc900、cb30647e5、4812a7ab1、796c5e736、a5074592f)。archive README 寫「lifecycle evidence debt tracked in BACKLOG」,指的是 `Legacy ready Mission terminals lack exact controller Work Orders`,那列在 bc2d36464 出貨。7 列全 A。

### 1631709a7(08-28 delete 14 struck-through entries)
12 列對應 CHANGELOG v2.34.20-v2.34.38,程式或檔案存在。2 列屬 D:`Fable skills absorption plan`(Board CEO-delegated RESOLVED-NOT-PURSUED,理由寫在計畫標頭與列內;小瑕疵:docs/projects/INDEX.md:531 還寫「tracked in docs/BACKLOG.md」)、`Tree-engine graduation Board review`(board_signoff abort 記在 task-tree-engine events.jsonl:33,並寫了 re-entry 條件)。

### a588cd948(08-17 roster qualification repair v2.34.12)
3 列:Four-layer redesign 已在 v2.34.11 出貨(A);Role qualification absent 由 v2.34.12 修庫並重考 grok implementer,reviewer 席部分在同 commit 改成新列「Reviewer-seat full qualifications...」(B,該新列後來在 a18fe5ee5 改寫、現行 BACKLOG 已無,不在我的範圍,另一組應會看到);Implementer scorecard lapses 由重考加 `--check-scorecard` capability_warnings 處理(A)。

### 61ca80aeb(06-01 mark resolved)
4 列:v2.7.5 test suite、v2.7.6 Item A/B/C。CHANGELOG 與 commit 都對得上(81e769d、c79e44cc0)。commit 當時是搬進 Resolved 區,不是真刪。4 列全 A。

### e70de5492(09-14 backlog 遷移成 pointer 列)
結論:沒有實質丟列。方法:比對 `e70de5492^` 與 `e70de5492` 的 `### ` 標題集合,154 對 154,無缺;manifest 154 項,每個 sidecar 檔在該 commit 都存在;再把舊檔每一行非空白內容拿去比對新 BACKLOG 加全部 sidecar 的行集合,舊檔 1226 行只有 17 行找不到,全是前言文字(舊的格式說明與 2026-09-12 版 FIRED queue,新版已重寫)。唯一的小損失:舊前言那句「`下次修改 X` 不是有效的延後觸發條件」沒有帶到新檔,現在由 Trigger-Type schema(references/backlog-entry.md:22,64)取代,屬規則改成機制,不算丟列。順帶說明:manifest 的 `moved_sha256` 是搬出內容的雜湊,不是整個 sidecar 檔的雜湊,所以我沒用它比對,改用逐行比對。

另一個我注意到但不屬本題的事:遷移後 sidecar 有很多已被後續 commit 刪掉(現行 docs/backlog 只剩 42 個),如 a1cc180cb、293cdaa8b、0db64c610。那些是後續列的關閉,應由其他組稽核。

## C 類與未確認詳表(全部在 5d0b29c1d)

| 原標題 | 類別 | 為什麼算 | Effort | Source | 擋別的工作? | 建議 Trigger-Type |
|---|---|---|---|---|---|---|
| 官方 codex plugin(openai/codex-plugin-cc)作「同級 consult 通道」的 Spike 評估 | C | consult 通道整合已在 v2.31.20 出貨,但殘餘(Spark 額度復位後 `/codex:review` 通道校準、known-bad 10 案 false-pass-on-critical=0 才准進 qc 面;`rescue --write` 沙箱姿態)沒有後繼列。在現行 BACKLOG、sidecar、knowledge 搜 `codex:review`、`codex-plugin-cc` 都是 0。原觸發日 2026-07-07 已過。 | S(Spike) | 2026-07-05 orchestrator-economy 吸收 | 否 | event(需要 write-path 或想把 review 通道進 qc 面時) |
| Engine-routing axis — evidence bar for ANY model→worktype default | C | 它是一條「站著的證據門檻」,管著仍存在的 `Domain-aware routing` 列(現行 BACKLOG:381)。調查數據(WebDev Arena、arXiv 2603.02540、domain 與 phase 兩軸都被反駁)只在個人 memory `[[project_routing-axis-evidence]]`,repo 內 grep 這些關鍵字為 0。刪掉後 `Domain-aware routing` 失去先決條件的提醒。 | n/a(標準,不是工作) | 2026-06-29 兩輪 /survey | 間接:有人要寫死 domain→engine 預設時不會看到這道門檻 | event(「有人提議靜態 model→worktype 表」),或把結論併進 `Domain-aware routing` 的 Context |
| PostToolUse dispatch dies after `/clear` — process restart required(verified) | C | (c) 文件已在 v2.8.1 出貨(hooks/README.md:55),但 (a) SPIKE-GATED 的 SessionStart 偵測、(b) 向 Claude Code 上游回報都沒做;觸發(使用者回報 hook 沒更新、或 CC release note 提到 hook dispatch 變更)沒人追。證據只驗過 CC 2.1.1xx 版,現行版本未重驗。 | spike ~15 分鐘,若可做再 M | 2026-05-14 v2.7.2 | 否 | event |
| Investigate `/reload-plugins` hook count discrepancy | C | `/reload-plugins` 回報 11 個 hook、hooks.json 13 筆,S 級調查從未做;reload-watch hook 還在(hooks/reload-watch.js、hooks.json:165)。純外觀問題。 | S | 2026-05-14 v2.7.2 post-ship | 否 | event(下次寫 reload-watch 邏輯或 CC 改 reload 語意) |
| agy install symlinked-dest self-copy truncation | C | (b) 安裝腳本守衛已在 v2.15.1 出貨;(c) 對 Antigravity 上游回報(3 行重現、1.0.5 與 1.0.7 已驗)從未送出,需要 owner 的帳號與身分同意。現行 BACKLOG、sidecar 無此項;knowledge 只在 debug-patterns.md 提到 Antigravity。 | S(寫報告) | 2026-06-11 事故與沙箱重現 | 否 | owner |
| dispatch 大型 calibration/eval scratch 改走非配額路徑(usrquota 事故殘項 d) | C | 事故修法 (a)(b)(c) 在 v2.32.22 出貨,(d) 大型校準 clone(`swe-calibrate-*` 44 個、各約 110M)仍寫 `${TMPDIR}` 沒做。repo 內找不到產生這批 clone 的腳本(只在 scorecard 測試與 handoff 文字出現),所以可能已不存在或是機外流程;無法證明已不需要。 | S | 2026-07-13 session 診斷、v2.32.22 | 否 | event(下次跑大型 clone 校準或 /tmp 用量異常) |
| Depth-0 loop hardening — content-fingerprint no-progress + hook backpressure | U | 鄰近機制存在:`scripts/check-loop-convergence.js`(860ef7844,連續零執行輪與 generation cap)、`scripts/check-stall-fuse.js`(驗證空轉熔斷),但都不是原列要的「同 diff/同 verdict 雜湊相同就提早中止」。觸發 (a) 是事故型,無法從 repo 判斷現在是否仍需要。我不猜。 | S | 2026-06-24 loop-engineering study | 否 | event |
| OS-sandboxed hetero reviewer (hard isolation on untrusted diffs) | U | bwrap cleanroom 現在涵蓋 codex、kimi、agy(scripts/lib/cleanroom-launch.sh,v2.36.108-109;bc2d36464 的 agy 隔離),所以選項 (a)(c) 部分達成。cc-shim 與 grok 審查仍是「best-effort surface reduction, not a hard sandbox」(scripts/dispatch-review.sh:89-90)。「審查真正不可信的 diff」這個觸發沒有後繼列。是否算完成取決於 owner 是否還要 cc-shim/grok 也硬隔離。 | L | 2026-06-30 gpt-5.5 cc-shim hardening loop | 否 | event(審查外部 PR / supply-chain diff 前) |

最要緊的是 `Engine-routing axis` 那列,因為它是唯一一個「站著的規則」被刪掉、且證據不在 repo 內的項目。其餘 C 類都是小事。

## 方法與限制

- 驗證 A 類時,我以 CHANGELOG 版本標題、commit 存在、程式或測試檔存在三者擇一或並用,沒有重跑任何測試套件(任務禁止)。「檔案存在」不等於行為正確,這一點對 bc2d36464 與 dc02e22af 特別成立:它們的證據是 archive README 加 merge 加程式檔,不是 CHANGELOG。
- B 類只確認「搬到哪裡」與「該處後來的下場」,沒有逐一審那些後續關閉是否正當。
- 沒有被覆蓋的部分:5d0b29c1d 中維持原標題但內文被改寫的列(例如 `Foreman↔depth-0 coordination R6` 的內文),不屬刪除,我沒比對改寫前後的觸發條件是否被保留。
