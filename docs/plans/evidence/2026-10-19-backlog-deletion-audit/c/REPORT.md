# BACKLOG 大量刪除稽核 c 組（10 個 commit）

範圍：9d0fbc9bc、41f1bff64、9fc56347f、ab00b82ec、2b312c356、79c0960f7、dabdd20e0、f4f53b1a8、8f5f37245、902542671。
逐列明細：`rows.tsv`（同目錄）。唯讀稽核，沒有改 repo、沒有跑測試套件。

## 總覽

| commit | 日期 | 刪列 | A | B | C | D | 未確認 |
|---|---|---|---|---|---|---|---|
| 9d0fbc9bc | 09-21 | 31 | 31（其中 1 列是「先刪、後才修」） | 0 | 0 | 0 | 0 |
| 41f1bff64 | 09-24 | 10（另有 3 個藏在 sidecar 的條目） | 10（+1 重複條目） | 0 | 0（+2 sidecar 條目） | 0 | 0 |
| 9fc56347f | 09-25 | 7 | 7 | 0 | 0 | 0 | 0 |
| ab00b82ec | 09-29 | 3 | 3 | 0 | 0 | 0 | 0 |
| 2b312c356 | 10-03 | 4 | 4 | 0 | 0 | 0 | 0 |
| 79c0960f7 | 10-03 | 3 | 3 | 0 | 0 | 0 | 0 |
| dabdd20e0 | 10-03 | 5 | 5 | 0 | 0 | 0 | 0 |
| f4f53b1a8 | 10-09 | 3 | 2 | 1 | 0 | 0 | 0 |
| 8f5f37245 | 10-10 | 5 | 5 | 0 | 0 | 0 | 0 |
| 902542671 | 10-11 | 6 | 4 | 0 | 0 | 1 | 1 |

結論：77 個 BACKLOG 列本身幾乎都真的做完；真正的誤刪不在「列」，而在 41f1bff64 連同 sidecar 一起刪掉的兩個條目（見下）。

## 各 commit 小節

### 9d0fbc9bc（31 列）
- 機制：commit 訊息寫「27 LAND rows + qst/64 + 3 wave-1b re-reviewed survivors」，依據是 wave-1 的五個 bundle plan（`docs/plans/_archive/2026/09/2026-09-21-backlog-*.md`）。該 commit 只刪 BACKLOG（327 行刪、0 行增），沒有逐列對照表；對照要靠 hands commit 訊息 `edits on hands/par3-<bundle>/<row>` 和 CHANGELOG `v2.36.81`（逐組列名，另寫「BACKLOG 刪 32 列」）。
- 我的驗證：31 列各自對到一個 hands commit（見 rows.tsv），對應的 `assert_rNN_*` 都還在 `hooks/tests/<bundle>.test.sh`；rlr 34/35、mrce 121、dlrm 16 是「回歸守衛／確認列」，列本身就只要求測試，且真正的修法 commit 存在（8de505788、35cda9ff0、61f9d74e0）。
- 例外（標 A*）：「context-budget: no model-id window source」。hands commit 2fafa2fa7 只加了註解（說 transcript 的 `message.model` 沒有 `[1m]`），測試反而把 T2 在 160k 觸發釘成預期行為，並沒有修。同一個缺陷 2026-10-02 由 peer（gentoo/mple2）重報，到 v2.36.107（4026c1e33，未知視窗時 T2 降為 advisory）才有緩解。CHANGELOG v2.36.81 只寫「context window 無訊號分支」，沒說明是放棄。現況已緩解，所以不算 C，但當時是提前刪除。
- mrce/2（timeout floor）訊息說保留，實際也沒被這個 commit 刪（只刪 31 列）。

### 41f1bff64（10 列 + 9 個 sidecar）
- 機制：commit 訊息說 10 列來自四個 bundle 的後續，附 QC-Verdict（fable-5-1 SHIP-AS-IS）。CHANGELOG v2.36.95 逐列寫 row 編號。10 列都有獨立 `(backlog w1b row N)` commit，全部 A。
- 發現（重要）：被刪的 sidecar `docs/backlog/live-state-dir-context-budget-test-strength-...-of.md` 有 64 行，不是一個條目。2026-09-14 的 BACKLOG 遷移（e70de5492）把舊 BACKLOG 尾端四個 `##` 段落整段倒進最後一個 sidecar，那四段從此只活在這個檔案裡；同時該列在 BACKLOG 裡的 Trigger／Context 欄也被錯接成 consult_dispatch 那一段。41f1bff64 刪 sidecar 時沒有檢查這些內容。四段的下場：
  1. 「A stale topology tuple derails a plan-review loop...」：C（見下表）。
  2. 「The plan-loop freeze predicate cannot be satisfied by the plan loop」：與同 commit 的 row 131（b2ad7eb95）同一缺陷，A。
  3. 「resolve-dispatch.sh cannot express a namespaced model alias」：本來就標 CLOSED（2026-09-11），不用追。
  4. 「consult_dispatch has no seat left once the qc panel excludes everything」：C（見下表）。
- 其他 8 個 sidecar 都只有 9 到 11 行單一條目，沒有夾帶。

### 9fc56347f（7 列）
- 機制：訊息寫 plan 檔 `2026-09-21-backlog-review-loop-resolver-a.md` 的 row 23/36/41/42/43/44/54，各有 RED-at-base 與回歸斷言，附 QC-Verdict。每列一個 `(backlog B1 row N)` commit，CHANGELOG v2.36.96 逐列。
- 備註：row 43 的 sidecar 候選方案是「重生 cache 或發出明確警告」，採後者（eb6fd6b54），符合；row 36 是審計類，修了 scorecard、pin 兩處比對共三點。7 列全 A。

### ab00b82ec（3 列，順便看）
- 機制：訊息逐項說明（改測試基準、把 `>=100` 門檻降到 20、codeforge 0700 已在 codeforge 1b388ed 修）。前兩項的修法就在本 commit 的測試 diff；第三項我在 `/home/cookys/projects/codeforge` 查到 1b388ed（2026-09-29，`create live-dir ancestors 0700`）。3 列 A。

### 2b312c356 / 79c0960f7 / dabdd20e0（10-03，4 + 3 + 5 列）
- 機制：訊息只寫「BACKLOG rows resolved」加 QC-Verdict；對照表是 CHANGELOG v2.36.107／111／112 的逐列（row 1..7、A/B/C/D、E/F/G/H）和每列一個 `(wave-B S fixes row N)`／`(w111 row X)`／`(w112 row X)` commit。12 列全 A。
- dabdd20e0 的「v2.36.111 review follow-ups」整包（5 項 🔵 nit）：REVIEWING cap 對齊、openai rail、bracketed raw-log、dispatch-review 16384 斷言、verify-red-green 負向對照都在 458c2c822；剩下的小項（run.sh SKIP、sweep 詞彙等）有被帶進新列 `v2.36.112 review follow-ups`，那一列現在還在 BACKLOG，所以 B/A 皆可，我記 A。

### f4f53b1a8（3 列）
- 機制：訊息只寫「BACKLOG rows」，實質依據是 `docs/plans/evidence/2026-10-09-residue-auto-reap/contract.md` 開頭「the three BACKLOG rows close here」加 owner 裁定。三列被改寫成三個新列：
  - 「retained worktrees no retention record」：A（alpha.3 R1 的 retention_reason／retention_expires_at）。
  - 「rejected branches never archived or deleted」：A（alpha.3 `reap --auto` 14 天先封存再刪）。
  - 「plain-session and /l4 close-out」：B，轉成「finish-flow close-out does not archive-then-delete」新列（Trigger 是 v7 skill-onoff eval），之後在 902542671 對應的 alpha.4 close-session 出貨。
- 注意：原 sidecar `peer-reported-revival3d-...md` 到 2026-10-18 的 b9caa7db6 才被刪（95 個 orphan sidecar 那批，不在我範圍）。

### 8f5f37245（5 列）
- 機制：訊息逐條說明（pre-push 警告、NO-FINDING-PROOF 多行、arm-bound eval、chain.json lock；兩個 pre-push 列合併成一個修法）。我在 HEAD 查到四個修法都在（`.githooks/pre-push:81,112`、`check-guidance-eval.js:115-127`、`hetero-review-loop.js:44-82`、`dispatch-review.sh:727`）。5 列 A。

### 902542671（6 列）
- 機制：訊息逐條說明。對照：scorer 列（amend-6，本 commit）、overlay 列（新增 `skill-onoff-generic-overlay.test.sh`）、close-session 列和 l4-l6 size 列（v3.0.0-alpha.4，c0c38cd70／53fa21057）皆 A。
- refs/archive 列：D。理由出處是同 commit 加進 contract.md 的一行「Owner ruling, 2026-10-10: archive refs are reminder-only...The age-cap-then-git gc prune rule that the earlier BACKLOG row proposed is not built」，且 `archive_remind_days` 已在 `scripts/lib/residue-config.js`。
- red-suites 列「review-loop-resolver-a r23, qualification-scorecard-tools r51/r52/r75」：未確認。2c0bec205（10-08）修了 r23 與 r75；r51/r52 沒有任何 commit 點名，訊息只寫「both suites green」。我不能跑套件，無法驗證 r51/r52 實際是綠。

## C 類與未確認明細

### C-1 A stale topology tuple derails a plan-review loop, and the failure is unreadable
- BL-id：無（遷移後沒有進入 BACKLOG 的條目，只存在於 sidecar）
- 刪除 commit：41f1bff64（連同 sidecar `docs/backlog/live-state-dir-context-budget-test-strength-two-surviving-mutants-one-vacuous-of.md`）
- 為什麼算 C：舊 BACKLOG（05f97302:docs/BACKLOG.md 第 1391 行）有此條；事故是 `~/.autopilot/topology.json` 記了失效的 `qwen3.8-max-preview@qoderclicn`，wrapper exit 3 且 stdout／stderr 皆空，plan loop 以 `required_seat_transport_exhausted` 終止，修正模型名又被 seal 擋下。條目列的兩個不動 seal 的緩解：（1）`resolve-dispatch-topology.js` 對照 runner 自己的 `--list-models` 驗證；（2）wrapper 把 runner 的 stderr 露出來。HEAD 查證：`--list-models` 只出現在 dispatch-author.sh、dispatch-review.sh、cursor-model.sh，resolve-dispatch-topology.js 沒有；`docs/BACKLOG.md` 與 `docs/backlog/` 找不到任何追蹤；CHANGELOG 的 unratified_observations 只保留了完成席位的 findings，沒解決 tuple 失效。
- Effort／Size：M
- Source：self（某 session 事故實測，非 peer／owner）
- 是否擋別的工作：不擋；但它會讓 plan-review loop 在 topology 過期時整輪作廢。
- 建議 Trigger-Type：event。沿用原文「下一次 plan-review loop 以 `required_seat_transport_exhausted` 結束，或下一次 topology 重生」。
- 原文護欄要帶回：不可為語意漂移放寬 seal；後繼 artifact 要記錄前任 id 與原因。附帶的 Related：topology.json 不存在時 `plan_review_resolved_from: native-fallback` 悄悄變單一家族（HEAD 有 r43 對缺 ladder key 的警告，需確認是否涵蓋整檔不存在）。

### C-2 `consult_dispatch` has no seat left once the qc panel excludes everything
- BL-id：無（同上，只在 sidecar；其內文還被錯接成 BACKLOG 列「live-state-dir / context-budget test strength」的 Trigger／Context）
- 刪除 commit：41f1bff64
- 為什麼算 C：事故是 `cookys-openclaw` 上 qc panel（gpt-5.6-sol／GLM-5.3／Qwen3.8-Max）吃光 roster，`consult_resolved_from: native-fallback` 變成與提問者同模型，`dispatch-consult.sh` 直接拒絕，呼叫者只剩手動叫 runner 的繞路。要求：「consult-only fallback list」（decorrelated 但不在 panel 的引擎，parse 只要求回文字）、警告要點名被排除的引擎。HEAD 查證：`scripts/resolve-review-loop.sh:1305-1313` 仍直接退到 `sonnet/high@claude-native` 並印同一句警告；10-13 的 5cd0eb5f3／79f79d368／f13f7e041 只讓「明確宣告的 consult 席位」生效並套 qc 排除，屬部分緩解，沒有 fallback list、警告也沒點名。BACKLOG 全文找不到追蹤。
- Effort／Size：S
- Source：self（owner 主機上實測，2026-09-11）
- 是否擋別的工作：不擋；但這是「不同家族諮詢」的 consult 席位在該主機上完全不可用。
- 建議 Trigger-Type：event。原文「下次在 qc panel 覆蓋整個 roster 的主機上派 consult，或下次動 `resolve-review-loop.sh` 的 consult 解析」。

### 未確認：Pre-existing red suites: review-loop-resolver-a r23, qualification-scorecard-tools r51/r52/r75
- 刪除 commit：902542671
- 原因：r23、r75 有 2c0bec205 的修法；r51／r52 沒有 commit 點名修它，我也不能跑套件。建議 owner 單跑 `hooks/tests/qualification-scorecard-tools.test.sh` 一次。
- Effort：S；Source：self（stage-graph 施工中觀察）；不擋別的工作；若仍紅，Trigger-Type 用 event（「這些 suite 下次被動到」，原文）。

## 其他觀察
- 風險型態：遷移（e70de5492）後，任何「最後一個 sidecar」可能夾帶舊 BACKLOG 尾端段落。我只掃了我這 10 個 commit 刪的 sidecar：只有上面那個有夾帶。b9caa7db6（10-18，刪 95 個 orphan sidecar，不在我範圍）刪的檔案中，有 10 個含 `##` 子段（例如 `suite-pollutes-real-capability-store.md` 6 段、`shared-sealed-zero-diff-validator.md` 3 段、`opencode-go-responses-transport.md` 3 段），建議負責那個 commit 的稽核者檢查是否有類似夾帶。
- 9d0fbc9bc 的 31 列沒有同時刪 sidecar（當時留成 orphan），所以這批沒有 sidecar 夾帶風險，但也代表它們的上下文要等 b9caa7db6 才消失。
- 這 10 個 commit 裡只有 41f1bff64 有「列和 sidecar 內容不一致」（該 BACKLOG 列的 Trigger 是別的條目的）；其他我有抽樣比對 Trigger，沒有發現。
