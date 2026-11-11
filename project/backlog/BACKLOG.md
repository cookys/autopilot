# autopilot — BACKLOG

<!-- next-id: BL-0428 -->

One entry = one index row per [`references/backlog-entry.md`](../../references/backlog-entry.md); evidence lives at
the row's `Pointer` (a plan, a project, or a sidecar under `docs/backlog/`). Gate:
`node scripts/check-backlog-entries.js --backlog project/backlog/BACKLOG.md` (config `.claude/backlog-config.md`, `mode: block`;
residual debt in `.claude/backlog-debt.json` ratchets down only). Migrated 2026-09-14 by
`scripts/migrate-backlog-entries.js` (manifest `project/backlog/MIGRATION-2026-09-14.json`).

**FIRED queue (order, as of 2026-09-14)** — rows whose trigger has fired are worked in this order:

1. ~~`chatgpt-tunnel-host` (E)~~ SHIPPED v2.36.32 · 2. ~~`openclaw` main claim~~ v2.36.28 · 3. ~~`<host>` four defects~~ v2.36.33 ·
4. ~~foreman rail Shape B~~ v2.36.34 · 5. ~~`308-db` (a) residue sweep~~ v2.36.35 · 6. ~~2026-09-12 dogfood four defects~~ v2.36.36 ·
7. ~~backlog entry schema Phases 1–4~~ v2.36.38–39 · 8. ~~disposition resume~~ v2.36.41 · 9. ~~ledger flag burns a grant~~ v2.36.42 · 10. ~~reviewer no_verdict releases the claim~~ v2.36.43. Next: operator-named work, or the 308-8f dispatch-hetero reports.

### band 加一個寵物分頁，先查 codepower 有沒有在做
- **Id**: BL-0413
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: codeforge
- **Report**: fleet 01M6RED2SK (codeforge, 2026-11-06)
- **Reply**: unknown
- **Problem**: 想在 band 上看寵物，現在沒有這個分頁；codeforge 要求。codepower 那邊可能已經在做。
- **Impact**: 重複開工會浪費；沒人做 codeforge 就一直等。
- **Trigger**: ready；開工前先問 codepower 是否已有進行中的工作
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PEER-REPORTED codeforge 2026-11-06
- **Pointer**: project/backlog/band-usage-pet-tabs.md

### 三支測試套件只在負載下紅，單獨跑綠
- **Id**: BL-0414
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: self
- **Problem**: plan-review-roster-admission 與 runner-binary 在負載高時紅；foreman-eval-sandbox 在 11/6 全套平行時紅。單獨跑都是綠；review-server 另列為 BL-0425。
- **Impact**: 全套平行時出現假紅，真壞掉會被當成雜訊放過。
- **Trigger**: next full-suite run, or the next touch of these suites
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: full-suite runs 2026-11-06
- **Pointer**: project/backlog/flaky-under-load-suites.md

### fleet lane 文字沒有清掉
- **Id**: BL-0415
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: self
- **Problem**: fleet 相關的 lane 文字還留在 repo 裡，沒有清乾淨（參照 2b1d4711）。
- **Impact**: 舊文字會誤導之後讀文件的人和 agent。
- **Trigger**: ready；next docs lane
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: fleet lane residue, ref 2b1d4711
- **Pointer**: project/backlog/fleet-lane-text-and-task-due.md

### dispatch-hetero 每一輪都誤判主 checkout 被改
- **Id**: BL-0416
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: revival.3d
- **Report**: fleet 01M6RX2ZRM (revival.3d, 2026-11-06)
- **Reply**: unknown
- **Problem**: 原推測「fingerprint 把 --branch 的分支算進去」已實測推翻，該分支本來就被排除；真正原因未明。拒收訊息現在列出變動項目，等下次被拒再判斷。
- **Impact**: 受影響的專案每輪都被拒，只能手動繞過。
- **Trigger**: revival.3d 下次被拒時，把新的拒收訊息貼回來
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED revival.3d 2026-11-06
- **Pointer**: project/backlog/dispatch-hetero-fingerprint-branch-ref.md

### fleet task 派工時能否帶 next_evidence_due
- **Id**: BL-0417
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: owner
- **Problem**: PM 要求另排一項：派工時能不能順便帶上下次證據到期時間；hub 79000b8 會丟掉 task_result 的 until，已排在 fleet 的 BL-0014。
- **Impact**: 沒有到期時間，PM 看不出一個任務何時該有新證據。
- **Trigger**: fleet BL-0014 unfreezes on 2026-11-10
- **Trigger-Type**: date:2026-11-10
- **Effort**: S
- **Source**: PM fleet 01M6RQYG00 (2026-11-06)
- **Pointer**: project/backlog/fleet-lane-text-and-task-due.md

### dispatch-hetero-account 的 subtest 可能還會跑出 fixture
- **Id**: BL-0418
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: self
- **Problem**: 這支套件有個 subtest 會在它的 cwd repo 裡提交；GIT_DIR 外洩那一類已修，但是否還有剩下的情況沒有記錄。
- **Impact**: 漏掉的情況會改到外層 repo 的檔案。
- **Trigger**: ready；next touch of dispatch-hetero-account.test.js
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: gitenv follow-up 2026-11-06
- **Pointer**: project/backlog/flaky-under-load-suites.md

### seedclean g3 其餘加固：trap 還原、fork 後的空窗、review 路徑 timeout -k
- **Id**: BL-0421
- **Status**: open
- **Since**: 2026-11-07
- **Origin**: self
- **Problem**: account 路徑還原 trap 時是重設而非存回原本的；trap 要放在 fork 之前；要用不回應信號的替身驗 137；review 的 cc-shim 缺 -k；review 的 account 路徑缺 timeout -k（76f11d50）。
- **Impact**: 極端時序下憑證副本或子程序可能殘留。
- **Trigger**: next touch of the account rails seeding code
- **Trigger-Type**: event
- **Effort**: S
- **Source**: seedclean g3 review (adb8f4b0, de92deb9, 76f11d50)
- **Pointer**: project/backlog/docsz6-hardening-notes.md

### band「待你動手 N」改放最上面的選單列
- **Id**: BL-0422
- **Status**: open
- **Since**: 2026-11-07
- **Origin**: peer
- **Reporter**: codeforge
- **Report**: fleet 01M6SZVASD (2026-11-07)
- **Reply**: none
- **Problem**: 待你動手的數字是全域的，不是單張卡的，放在主視窗標題語意不對；改放最上面的選單列，前提是 80 欄寬放得下、不截字。
- **Impact**: 數字位置會讓人誤以為只屬於目前這張卡。
- **Trigger**: next change to the band top menu row
- **Trigger-Type**: event
- **Effort**: S
- **Source**: codeforge fleet 01M6SZVASD (2026-11-07)
- **Pointer**: project/backlog/docsz6-hardening-notes.md

### panel 一次送多張卡時 claim 依序執行，掛掉時整批卡很久
- **Id**: BL-0423
- **Status**: open
- **Since**: 2026-11-07
- **Origin**: self
- **Problem**: 一次送多張卡時，認領是一張接一張，每張最多重試約 30 秒；courier 掛掉時整批會卡很久。
- **Impact**: courier 故障時操作員要等好幾分鐘才看到結果。
- **Trigger**: panelclaim is wired onto $.process
- **Trigger-Type**: event
- **Effort**: S
- **Source**: panelclaim hand report (2026-11-07)
- **Pointer**: project/backlog/docsz6-hardening-notes.md

### bl-ap-streamjson：json 與 stream-json 的 result 位元組是否一致
- **Id**: BL-0372
- **Status**: open
- **Since**: 2026-11-04
- **Origin**: self
- **Problem**: 還不知道真實 dispatch 下 json 與 stream-json 兩種輸出格式的 result 位元組是否一致；這是 G40 agent lane 被動觀測的前提。要用真實 dispatch 量測，PM 目前停車中。
- **Impact**: 前提沒確認就做被動觀測，兩種格式若不一致，觀測到的結果會對不上。
- **Trigger**: 3.0.0 之後；Tasks 0-3 已於 05a70bf82 合併；Tasks 4-5（約 70 次 haiku 呼叫）等已註冊的 alias（d-2a19fdb5）；兩層都 PASS 才切 G40 P2 旗標；PM 追蹤 bl-ap-sj45
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PM 2026-11-04 ordering message
- **Pointer**: project/backlog/bl-ap-streamjson-result-bytes.md

### G40 mirror 鎖的 perl 備援在 macOS 上沒驗證過
- **Id**: BL-0381
- **Status**: open
- **Since**: 2026-11-04
- **Origin**: self
- **Problem**: mirror 鎖優先用 flock 指令，沒有時改用 perl；標準 macOS 沒有 flock 指令，perl 這條路徑沒在 macOS 上跑過。
- **Impact**: macOS 主機上若 perl 路徑壞掉，mirror 寫入會失敗並在 status 顯示 lock_helper，不會寫壞資料。
- **Trigger**: 3.0.0 之後；第一次在 macOS 主機跑 G40 mirror 時
- **Trigger-Type**: event
- **Effort**: S
- **Source**: BL-0374 結案時留下的後續（cd7f28002）
- **Pointer**: project/backlog/g40-mirror-oslock-macos-perl-unverified.md

### develop 上五支測試套件在 base 就是紅的
- **Id**: BL-0366
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: self
- **Problem**: 五支測試套件在主線的基準點就失敗，不在已知紅名單裡，也不知道從哪個提交開始紅；驗收時在基準與修改後各跑一次，失敗相同。
- **Impact**: 完整套件跑出紅燈，真正的新壞掉會被這五支蓋住。
- **Trigger**: next touch of runs-watch, the status CLI or the review rail, or the full-suite run before the 3.0.0 release
- **Trigger-Type**: event
- **Effort**: M
- **Source**: sealbase acceptance runs cv1 and cv2, 2026-11-01
- **Pointer**: project/backlog/four-suites-red-on-develop-base.md

### 專案路徑解析的後續兩點
- **Id**: BL-0367
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: self
- **Problem**: 專案根目錄預設取目前所在目錄，在子目錄執行檢查會失敗而且訊息沒說用了哪個根；另有一個測試的讀取計數在走正規路徑時會漏算。
- **Impact**: 使用者在子目錄執行會看到不明原因的失敗；漏算的計數讓測試可能假綠。
- **Trigger**: next edit to graph-check, graduation or doc-drift-gate, or a report of a failure caused by running from a subdirectory
- **Trigger-Type**: event
- **Effort**: S
- **Source**: planpath acceptance, 3b39f9077, 2026-11-01
- **Pointer**: project/backlog/planpath-follow-ups.md

### 封存基準檢查在搬檔時太慢
- **Id**: BL-0368
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: self
- **Problem**: 封存基準的改寫檢查對每筆清單條目都重掃全部約四千六百筆，一次檢查要算約兩千一百萬次路徑對應；結果正確但很慢。
- **Impact**: 搬檔階段每次跑檢查都要等很久。
- **Trigger**: P1 file-move lane uses check-rewrite and finds it slow
- **Trigger-Type**: event
- **Effort**: S
- **Source**: sealbase review, 6b31d2a67, 2026-11-01
- **Pointer**: project/backlog/seal-baseline-filledbymove-slow.md

### live pane 在來源沒變時仍顯示「資料過舊」
- **Id**: BL-0365
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: peer
- **Reporter**: openclaw fleet session
- **Report**: 01M6BK2FVVCH6BHAJJPE095XEQ
- **Reply**: 2026-11-01 01M6BK34N1Z70RKBGGVJRX9X2J
- **Problem**: 即時面板在沒有新變化時，也會跳出資料過舊、發佈者沒在發佈的提示，連 watcher 已正常結束的情形都算在內。使用者打字到一半也會被這則提示打斷。
- **Impact**: 沒有新變化被誤報成過期，打字時畫面還跳動，使用者不知該不該處理。
- **Trigger**: planpath and sealbase (migration plan P1 prerequisite lanes) merged; owner must approve before/after real-terminal screenshots before merge
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED openclaw 2026-11-01 (fleet msg; operator quote in sidecar; reply sha owed to the fleet session after merge)
- **Pointer**: project/backlog/live-pane-stale-text-when-nothing-changed.md

### 回合被判定主工作目錄被改動，但分支位置其實沒動
- **Id**: BL-0285
- **Status**: open
- **Since**: 2026-10-23
- **Origin**: peer
- **Reporter**: hangar
- **Report**: 2026-10-23 bundle docs/hangar-harvest-2026-10
- **Reply**: none
- **Problem**: 有一次實作回合被判定為主工作目錄被改動而整輪作廢，但紀錄證明分支位置沒動，只有系統自己的簿記參照變了；原因還沒重現。
- **Impact**: 可能無故作廢一輪已完成的實作與其花費。
- **Trigger**: next edit to main-checkout-boundary.sh or the lifecycle-roots writer, or a third unexplained main_checkout_mutated rejection
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED hangar 2026-10-23 (bundle docs/hangar-harvest-2026-10 ea8b40a95); session d12f8e4c 2026-09-19, hypothesis, unreproduced
- **Pointer**: project/backlog/main-checkout-mutated-with-no-head-movement.md

### mods Now tab: a background row may never end after a session resume
- **Id**: BL-0002
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: mods 的 Now 分頁上，session 離開再 resume 後，原本的背景工作不會再送完成通知，那一列可能永遠掛著；對話紀錄裡也沒有 resume 標記可判斷。
- **Impact**: 最壞是畫面上殘留一列已不存在的背景工作，屬於顯示問題；先實測再決定要不要修。 (draft)
- **Trigger**: a stale 背景指令 or 監看 row is seen, or a session is resumed after quitting with background work running
- **Trigger-Type**: event
- **Effort**: S
- **Source**: feat/mods-activity review, 2026-10-12 (UNVERIFIED live behavior)
- **Pointer**: project/backlog/mods-activity-row-never-ends.md
- **Context**: Half fixed in b36936691: a retained background row is dropped when the transcript is unreadable and the session id changed. Left: resume; probe quitting mid `sleep 600`, find a transcript signal.

### Cross-repo dispatch has no worktree or handoff rule
- **Id**: BL-0004
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: 一個專案的工作要派到另一個專案的程式庫去做時，目前沒有規則說明該用哪個專案的工作樹、標記檔與交接文件。當初規劃工作樹位置規則時，刻意把這一項延後。 (draft)
- **Impact**: 跨專案派工時各 session 可能各做各的、交接位置不一致；平常很少遇到。 (draft)
- **Trigger**: 3.0.0 之後；the first real cross-repo dispatch that goes wrong (worktree, marker or handoff location disagrees)
- **Trigger-Type**: event
- **Effort**: M
- **Source**: worktree-placement gap 5, deferred by the plan (D12), 2026-10-12
- **Pointer**: project/backlog/worktree-and-handoff-placement-has-no-rule.md
- **Context**: Owner 2026-10-17: keep as is, set no rule now; decide when a real case appears. Rails resolve placement from their own --from repo root; nothing says which repo root, marker or handoff a cross-repo run uses.

### PEER-REPORTED (hangar): register preview/review servers with lab-ingress instead of ad-hoc 0.0.0.0 ports
- **Id**: BL-0018
- **Status**: open
- **Since**: 2026-10-05
- **Origin**: peer
- **Reporter**: hangar（hangar--claude-2）
- **Report**: 01M45R3JWAVVZ5WDTQ4M89A503
- **Reply**: 2026-10-05 01M45R4M3V0999MB5HEV8E7R84
- **Problem**: hangar 的 claude 工作階段反映：預覽與審查伺服器應向 lab-ingress 登記，而不是各自開 0.0.0.0 的臨時埠。目前審查伺服器只綁本機 127.0.0.1，沒有登記機制。 (draft)
- **Impact**: 其他機器想看預覽時只能自己想辦法；原定版本已不會出貨，需擁有者重訂時程並與 hangar 確認。 (draft)
- **Trigger**: 3.0.0 之後；mods shipped with 3.0.0 AND hangar lab-ingress v2 `lab preview` decided
- **Trigger-Type**: peer
- **Effort**: M
- **Source**: fleet `01M45R3JWAVVZ5WDTQ4M89A503` from hangar--claude-2 (2026-10-05, on cookys' request); replied `01M45R4M3V0999MB5HEV8E7R84`
- **Pointer**: project/backlog/lab-ingress-preview-integration.md
- **Context**: review server self-registers; a PreToolUse hook (not skill text) routes ad-hoc previews to `lab preview` with a LAN-bound registered fallback; registry format co-defined with hangar.

### agy `--input-format stream-json` raises the payload ceiling but does NOT remove it — and above it the failure is SILENT
- **Id**: BL-0021
- **Status**: open
- **Since**: 2026-09-11
- **Origin**: peer
- **Reporter**: <host>
- **Report**: 2026-09-11 peer
- **Reply**: 2026-09-11 session 587b795f:2936
- **Problem**: <host> 回報：agy 改用 stream-json 輸入雖提高了內容上限，但超過上限後會無聲失敗而不報錯。我方已在本機驗證屬實，目前仍保留硬性上限檢查。 (draft)
- **Impact**: 若有人移除上限檢查，超長內容會無聲出錯；現行檢查已擋住，只需保留該原則。 (draft)
- **Trigger**: 3.0.0 之後；the next agy-rail dispatch refused by `agy_argv_ceiling_assert`, or any work that proposes routing `dispatch-review.sh` / `dispatch-hetero.sh` / `dispatch-author.sh` through stream-json.
- **Trigger-Type**: event
- **Effort**: S
- **Source**: peer report from <host> 2026-09-11, re-derived locally the same day with four probes; the since-removed `lib/agy-argv-ceiling.sh` guard, callers at…
- **Pointer**: project/backlog/agy-input-format-stream-json-raises-the-payload-ceiling-but-does-not-remove-it-a.md
- **Context**: agystdin 0221af27e: stdin stream-json shipped fail-closed (170000 B cap, empty-response and token-ceiling checks). Stays open: lifting the cap safely needs a per-host measurement or a tail-nonce self-check.

### No route for external field experience contributed INTO autopilot itself
- **Id**: BL-0085
- **Status**: open
- **Since**: 2026-08-25
- **Origin**: self
- **Problem**: 在其他專案使用 autopilot 學到、屬於 autopilot 的專案知識，沒有路徑回灌：學習技能只寫到該專案，提煉技能又排除 autopilot。同儕回報的流程（先回覆、再登 BACKLOG）不涵蓋這類知識。
- **Impact**: 其他專案學到的教訓會流失，autopilot 本身讀不到；目前只有一個案例（n=1），所以只是登記，還沒動工。
- **Trigger**: 3.0.0 之後；A second instance of a lesson learned while using autopilot on another project that belongs in autopilot's own skills/references and has nowhere to go.
- **Trigger-Type**: event
- **Effort**: S
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)
- **Pointer**: project/backlog/no-route-for-external-field-experience-contributed-into-autopilot-itself.md
- **Context**: Owner 2026-10-18: project knowledge, separate from peer reports; tied to the codeforge/mnemos ecosystem (codeforge is the first Mnemos source, a memory daemon). The route likely belongs with its project-knowledge flow.

### `peer-coordination` skill — ruled in, blocked on a spike sweep
- **Id**: BL-0086
- **Status**: open
- **Since**: 2026-08-25
- **Origin**: peer
- **Reporter**: <host>（推定）
- **Report**: 2026-08-24 peer
- **Reply**: 2026-08-25 session 61892959:1108
- **Problem**: 其他專案經 peer 通道要求新增「同儕協調」技能，讓多個 session 互相派工、溝通有統一做法。兩輪異質審查已裁定要做，但要先在各機器跑完實測才能動工。 (draft)
- **Impact**: 沒有此技能時，各 session 自行摸索協調方式，容易踩重複的坑。 (draft)
- **Trigger**: 3.0.0 之後；The R5 spike list below comes back with dated, per-machine results. Do not author the
- **Trigger-Type**: event
- **Effort**: M
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel
- **Pointer**: project/backlog/peer-coordination-skill-ruled-in-blocked-on-a-spike-sweep.md
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has

### mods P5 proxy-decision reminders (writer first)
- **Id**: BL-0110
- **Status**: open
- **Since**: 2026-10-04
- **Origin**: owner
- **Problem**: 擁有者要求 mods 介面能顯示「代理替你做的決定」提醒。目前沒有任何地方記錄這類決定，所以介面無從顯示；要先做記錄寫入，再做監看，最後才是顯示。 (draft)
- **Impact**: 擁有者想看到代理的決定卻看不到；屬新功能，排在 mods 隨 3.0.0 發布之後。 (draft)
- **Trigger**: 3.0.0 之後；after mods ship with 3.0.0
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: owner request and C4 research, 2026-10-04
- **Pointer**: project/backlog/mods-p5-proxy-decision-reminders.md
- **Context**: no live decision ledger exists and nothing writes proxy-decision rows, so the live band cannot show them yet; writer, then watcher sidecar, then display.

### mods/live recent conversation: groups expand by mouse only
- **Id**: BL-0123
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: self
- **Problem**: mods/live 介面的「最近對話」區塊，群組只能用滑鼠點開；在 tmux 裡用鍵盤無法移到群組並展開，按 Enter 反而觸發前面的切換分頁按鈕。 (draft)
- **Impact**: 只用鍵盤或 ssh 的使用者無法展開群組；擁有者若要用鍵盤才需處理。 (draft)
- **Trigger**: 3.0.0 之後；Claude Code 支援 pane 內非分頁 Button 的鍵盤焦點或 hotkey 時
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: now-recent-turns screenshot run, merge `82d34da4`, 2026-10-12
- **Pointer**: project/backlog/mods-live-recent-groups-keyboard.md
- **Context**: 2026-10-17 measured on Claude Code 2.1.301: in-pane Button hotkey draws its prefix but keys go to the input box; focus stays on top tabs only. Host blocks it; reported to Claude Code.

### autocompact: users never learn to set autoCompactWindow; T2 still says STOP
- **Id**: BL-0124
- **Status**: open
- **Since**: 2026-10-12
- **Origin**: owner
- **Problem**: 使用者通常不知道要設定自動壓縮視窗（autoCompactWindow），偵測功能和 T2 新提示文字都已完成，剩下是在下一版發布標題寫出這個設定，讓使用者知道要設。 (draft)
- **Impact**: 使用者會被不必要地要求停下重開；擁有者已驗證 Claude Code 的摘要夠用，改文字屬指引，需評測證據。 (draft)
- **Trigger**: next alpha or 3.0.0 release cut
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: context reset cost analysis, 2026-10-12
- **Pointer**: docs/plans/evidence/2026-10-12-context-reset-cost/README.md
- **Context**: detection and T2 wording shipped (BL-0124 merge, ON/OFF eval docs/plans/evidence/2026-10-14-t2-wording-onoff/). Left: name autoCompactWindow in the next release heading so users learn to set it.

### Move exam registration to llm-playground; autopilot reads one JSON
- **Id**: BL-0194
- **Status**: open
- **Since**: 2026-10-15
- **Origin**: owner
- **Problem**: 考試登記機制要全部搬到 llm-playground，不維護多份；由 dyno 產出一份 JSON 給 autopilot 綜合評估，至少含每小時解題數、資格、通過率、花費。
- **Impact**: 兩邊各記一份會不一致，排席位時看到的數字對不上。
- **Trigger**: 3.0.0 之後；llm-playground 回報 intake 流程後，由 owner 確認新的 P5–P7 範圍。
- **Trigger-Type**: peer
- **Effort**: M
- **Source**: owner, 2026-10-15
- **Pointer**: project/plans/2026-10-16-bl0194-qualification-registry-move.md
- **Context**: Exam moves to llm-playground intake after SWE34, via engine-qualify headless. Trust auto/confirm/off (default auto). P5–P7; P3 optional, off; P4b is a residual pull.

### 依功能把 autopilot 分成 hetero engine、flow、lab 三塊（拆法未定）
- **Id**: BL-0206
- **Status**: open
- **Since**: 2026-10-18
- **Origin**: owner
- **Problem**: autopilot 同時含異質引擎（panel、discuss、plan review、code review）、軟體開發流程、實驗性功能，使用者難分辨哪些是核心。拆法還沒定。
- **Impact**: 不分組只是說明與目錄較雜，沒有功能影響；使用者要分辨用途時較費力。
- **Trigger**: 3.0.0 之後；owner 重新提起分組，或新增的技能與腳本再次難以歸類
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: owner, 2026-10-18（放棄 tier 欄位時順帶提出，以後再說）
- **Pointer**: project/backlog/split-autopilot-into-hetero-engine-flow-lab.md
- **Context**: 拆法未定（候選深度見 sidecar）；owner 2026-10-18 說以後再說，不主動推進。

### roundtable Phase 1 - the /roundtable skill, distilled from several manual rooms
- **Id**: BL-0216
- **Status**: open
- **Since**: 2026-09-19
- **Origin**: owner
- **Problem**: 圓桌第一階段要把幾場手動開過的討論整理成可重複使用的技能，目前只有書面計畫，技能還沒寫。
- **Impact**: 每次討論仍得手動組場，前面幾輪累積的做法無法沉澱成固定流程。
- **Trigger**: 3.0.0 之後；three more manual rooms run under the Phase 0 protocol, each with an evidence dir, OR the owner asks for the skill by name
- **Trigger-Type**: owner
- **Effort**: L
- **Source**: original operator 2026-09-19 Phase 0 ("值,先詳細寫成 plan 留 backlog,我們應該多經歷幾輪再來繼續"); restored 2026-10-19; dropped by 5f3aa3b1d
- **Pointer**: project/plans/2026-09-19-roundtable.md
- **Context**: Room-log: utterances append to room.jsonl; windows only read it. Windows A and B built and owner-approved 2026-10-19. Fleet transport excepts hetero discussion; review stays hetero. Skill still waits on its trigger. Detail is in Pointer.

### Openclaw leftover side effects: a refusal keeps a live lease, and verify PATH is a precondition miss
- **Id**: BL-0218
- **Status**: open
- **Since**: 2026-09-12
- **Origin**: peer
- **Reporter**: openclaw
- **Report**: 2026-09-12 fleet
- **Reply**: none
- **Problem**: 主訴求已出貨。還剩兩件：拒絕時回報已釋放，持久狀態卻仍留有效租約，下次啟動會撞上未關租約；驗證指令繼承的搜尋路徑缺工具，找不到命令應算前置條件失敗。
- **Impact**: 下次啟動被未關租約擋住；缺工具被當成驗證失敗，分不清是環境還是產品。
- **Trigger**: a refusal reports released while durable state keeps a live lease, or verify_cmd inherits a PATH missing the operator tool
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: openclaw fleet relay 2026-09-12; restored 2026-10-19; dropped by 5f3aa3b1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/backlog/peer-reported-openclaw-an-active-l5-marker-deadlocks-the-bounded-campaign-l5-its.md
- **Context**: Main claim shipped in v2.36.28. Original effort label was Fix. (a) may be partly covered by v2.36.71, unconfirmed.

### Per-hook by per-harness support matrix with verification dates
- **Id**: BL-0231
- **Status**: open
- **Since**: 2026-09-07
- **Origin**: owner
- **Problem**: 掛鉤與執行環境支援表各格多數仍未以實際觸發驗證（證據檔只有一筆打包紀錄，沒有實際觸發）。另需 owner 決定：表只收我們自己註冊的掛鉤，grok 與 agy 的原生事件證據是否擴充進來。
- **Impact**: 矩陣上的「支援」多數仍未被實際觸發證明；原生事件層也沒有證據列，grok 與 agy 的掛鉤支援只能靠散文記載。
- **Trigger**: 3.0.0 之後；the next hook registered on a second harness, a harness-maintenance run that finds a hook-event claim older than 60 days, or the owner deciding whether the matrix should accept native-event (grok/agy) evidence rows
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: owner 2026-09-07 dirty-tree hook; restored 2026-10-19; dropped by 061cc11c7; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/backlog/per-hook-per-harness-support-matrix-with-verification-dates-hook-inventory-that.md
- **Context**: Old id BL-0026. 2cdefb419 wired only the 60-day advisory into preflight. Left: most cells unverified (no fired evidence), plus owner call on grok/agy native rows. See sidecar.

### Upstream report for agy install symlinked-destination truncation
- **Id**: BL-0236
- **Status**: open
- **Since**: 2026-06-11
- **Origin**: owner
- **Problem**: 安裝時若目的地是符號連結，會把來源檔案截成空檔。防護已出貨，向上游回報仍要擁有者同意才能送。
- **Impact**: 上游不知道這個會清掉檔案的行為，別人的安裝仍可能踩到。
- **Trigger**: Before the next agy plugin install of autopilot in the fleet, or the next hardening slot; owner must send the report
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: 2026-06-11 incident plus sandbox repro; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/backlog/agy-install-symlinked-dest-upstream-report.md
- **Context**: Guard shipped in v2.15.1. The upstream report still needs the owner account and identity consent.

### Watcher roots set has no upper bound
- **Id**: BL-0239
- **Status**: open
- **Since**: 2026-10-04
- **Origin**: self
- **Problem**: 監看器記錄的專案根目錄清單沒有上限。其餘強化已修完，這項留給後續階段。
- **Impact**: 長時間追蹤很多專案時，這份清單會一直變大。
- **Trigger**: 3.0.0 之後；P3 start
- **Trigger-Type**: event
- **Effort**: M
- **Source**: mods P1a reviews, 2026-10-04; restored 2026-10-19; dropped by a1cc180cb; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/backlog/mods-p1a-known-follow-ups.md
- **Context**: Old id BL-0109. Everything else in that row was already fixed. P3 owns the bound.

### workflow-snapshot P3: handoff reads the snapshot and dev-flow calls task-card
- **Id**: BL-0243
- **Status**: open
- **Since**: 2026-10-13
- **Origin**: owner
- **Problem**: 交接時讀取壓縮快照，以及流程開始時自動寫任務卡，這兩件還沒做，要等評測與擁有者裁決。
- **Impact**: 交接仍不會讀快照，任務卡也不會在流程開始時自動寫入。
- **Trigger**: 3.0.0 之後；P3: handoff reads the snapshot and dev-flow calls task-card, after guidance and eval
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: original backlog row; restored 2026-10-19; dropped by 0a9c9efac; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/plans/2026-10-13-workflow-snapshot-at-compaction.md
- **Context**: Prior row deleted in 0a9c9efac. The T2 text change (formerly BL-0147) was dropped 2026-11-05.

### Mission stays not ready after a section 11 downgrade
- **Id**: BL-0248
- **Status**: open
- **Since**: 2026-10-19
- **Origin**: peer
- **Reporter**: codepower <host>
- **Report**: 01M59ZPRRAH8CGMG59HHD8816N
- **Reply**: 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX
- **Problem**: 第十一節降級並記錄整合之後，任務圖仍判定還沒準備好，也沒有辦法把節點標成結束。
- **Impact**: 整合做完仍過不了就緒檢查，任務卡在無法收尾的狀態。
- **Trigger**: after a section 11 downgrade and record-integration, the mission graph still says not ready and nothing marks the node terminal
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PEER-REPORTED codepower <host> 2026-10-19
- **Pointer**: project/backlog/mission-not-ready-after-section-11-downgrade.md
- **Context**: See BL-0220. 2026-10-23 BLOCKED: no "section 11 downgrade" concept in the repo; need a minimal repro from codepower <host> (detail in the Pointer); the fleet MCP was down, request not sent.

### agy 1.4.2 headless large output prints SUCCESS envelope but process does not exit
- **Id**: BL-0253
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: peer
- **Reporter**: codepower
- **Report**: 01M5AMCPARPY10G4GYCJAKT80X
- **Reply**: 2026-10-20 01M5AMDBG5B1ZDDVFD1CPTKM3Y
- **Problem**: agy 一點四點二在無頭模式輸出很大（約六千詞元以上）時，會印出成功信封，但行程不結束，要等外面逾時。一點二點一不會。
- **Impact**: 派工審查的 agy 席可能一直等行程結束，審查因此卡住。
- **Trigger**: when codepower confirms a fix or workaround on their side, or the first agy review seat run that hangs after a closed envelope
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: PEER-REPORTED codepower 2026-10-20
- **Pointer**: project/backlog/agy-142-headless-envelope-no-exit.md
- **Context**: Probably affects the agy review seat. 2026-10-23: agy-served claude-sonnet-5-5-low hands parked on their own background tasks until the dispatch wall timeout; see sidecar.

### P6 feed-trust follow-ups: confirm-mode answer step, plan wording, reject-then-confirm, repeated stderr
- **Id**: BL-0261
- **Status**: open
- **Since**: 2026-10-20
- **Origin**: self
- **Problem**: 信任檢查剩兩件事：確認模式下 owner 在面板回覆後，還得再跑一次答覆指令才算數；計畫第五節對紀錄驗證的用詞與實作不符。其餘兩項已修。
- **Impact**: 前者要改技能說明才能自動化，後者是文件與行為不一致。
- **Trigger**: 3.0.0 之後；next guidance eval allowed to edit the engine-onboarding skill text, or the next change to the P6 plan
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hetero-review p6trust g2
- **Pointer**: project/backlog/p6-trust-followups.md
- **Context**: Items 3 and 4 merged (feedtrust d079b69bb). Items 1 and 2 left; item 1 is skill text at skills/engine-onboarding/SKILL.md:77 and needs eval evidence.

### Cross-harness token discipline for resident seats
- **Id**: BL-0271
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: peer
- **Reporter**: llm-playground claude-4 (<host>)；llm-playground claude-4 (<host>)；llm-playground claude-4 (<host>)
- **Report**: 01M5EWE5D6HT343H26BCXSHBPM；01M5EX8WGH1FT9MJDXYNQ2WGWN；01M5EY27E8E1PJVDB7B05FEENX
- **Reply**: 2026-10-21 01M5EWEHPTPD4F0P6KAP5VDCAH；2026-10-21 01M5EX9883PHTTG3N2HPE08CG6；2026-10-21 01M5EY2GX2JCMJB1VX3TMF81EX
- **Problem**: 跨工具的長駐席位沒有共用的用量紀律。交接時機、讀檔、輪詢、子代理與回覆節奏都靠各席自己拿捏。
- **Impact**: 主執行緒會累積到十億級用量。壓縮後仍比新執行緒肥，成本與延遲都下不來。
- **Trigger**: 3.0.0 之後；the owner decides whether to build P1-P3 of the concurrency plan.
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: PEER llm-playground claude-4 2026-10-21
- **Pointer**: project/backlog/cross-harness-token-discipline.md
- **Context**: Item 4: owner chose P0 only (d-02c60498); p0spike 8eee6eac0 settled the seven hook facts; P1-P3 not started.

### Guidance cut gate is red on develop and not in preflight
- **Id**: BL-0272
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: self
- **Problem**: 指引裁切檢查在開發主線上是紅的，也沒接進合併前檢查。它一定要指定基準，而合併前檢查沒有固定的舊版基準。
- **Impact**: 摘要與評測包不一致時，合併前檢查現在不會擋下。
- **Trigger**: after the second-phase pack covers every manifest file that differs from the 2.x baseline
- **Trigger-Type**: event
- **Effort**: S
- **Source**: dwire merge 215d9084c, 2026-10-21 discoverability audit
- **Pointer**: project/backlog/guidance-cut-gate-red-not-in-preflight.md
- **Context**: The check against base 3.0.0-alpha.3 exits 1. The evidence-discipline digest does not match the pack.

### Remaining entry gaps from the 2026-10-21 discoverability audit
- **Id**: BL-0277
- **Status**: open
- **Since**: 2026-10-21
- **Origin**: owner
- **Problem**: 盤點還有幾個入口沒教完。派工樹只有一行說明，工頭派工自述還沒接上第五級，警告格式號稱會在工作階段開始時用但沒有掛上，任務的多數子命令也沒有入口。
- **Impact**: 功能在，但其他代理仍不知道這些入口何時該用。
- **Trigger**: the remaining entry gaps named in the 2026-10-21 audit can be taught now
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: 2026-10-21 discoverability audit
- **Pointer**: docs/plans/evidence/2026-10-21-discoverability-audit/README.md
- **Context**: Detail in remaining-discoverability-entry-gaps.md. Dispatch-tree sentence withdrawn 2026-10-23: neither pilot arm opened depth0-control-loop.md; needs a SKILL.md-level change with its own eval.

### Seat schema admits / and . in engine and model; audit path-building consumers
- **Id**: BL-0291
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: 座位 schema 現在允許引擎與模型名稱含斜線和句點（oqseat 單元），所以含上層目錄的名稱也能通過檢查；所有用這些名稱組檔案路徑的使用端都需要逐一檢查。
- **Impact**: 若某處直接把 id 拼進檔案路徑，可能寫到預期目錄之外。
- **Trigger**: the audit can be picked up now; no merge needed
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: 2026-10-24 oqseat review (lane/oqseat, not yet on develop)
- **Pointer**: project/backlog/seat-schema-slash-dot-path-consumers.md
- **Context**: The widening is on lane/oqseat, not yet on develop; develop's isSafeSeatId still rejects them. Details in sidecar.

### plan-review: author-side precondition_failed burns the logical id
- **Id**: BL-0296
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: plan 審查在作者端的前置條件失敗時，會把邏輯 id 直接燒掉，同一代重跑也被終局鎖擋住，只能換 id。
- **Impact**: 一個小前置錯誤就要換 id 重來，浪費一輪審查。
- **Trigger**: next plan review that dies on an author-side precondition_failed
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: bldone9 2026-10-24 code reading
- **Pointer**: project/backlog/plan-review-precondition-burns-logical-id.md

### Long sessions never reap their background work
- **Id**: BL-0297
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: peer
- **Reporter**: llm-playground <host>
- **Report**: 01M5NBBZDBHD4Y53Q78QP2ZNKB
- **Reply**: none
- **Problem**: 長時間的工作階段不會回收背景工作：背景殼層、監看與等待迴圈會一直累積，tasks 目錄也越積越多。peer llm-playground 回報。
- **Impact**: 資源被吃掉，還會有失控的等待迴圈。
- **Trigger**: a long session shows leftover background shells, or a state-checkpoint restore is edited
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED llm-playground <host> 2026-10-24
- **Pointer**: project/backlog/long-session-background-work-not-reaped.md

### Claude Code upstream report draft (owner decides whether to send)
- **Id**: BL-0301
- **Status**: open
- **Since**: 2026-10-24
- **Origin**: self
- **Problem**: 整理了一份給 Claude Code 上游的回報草稿，交 owner 決定是否送出。內容是同為 2.1.309 時觀察到的四個行為問題。
- **Impact**: 不回報的話，這些問題會繼續影響長時間工作。
- **Trigger**: 3.0.0 之後；owner decides whether to send the draft
- **Trigger-Type**: owner
- **Effort**: XS
- **Source**: bldone9 2026-10-24 observations on CC 2.1.309
- **Pointer**: project/backlog/claude-code-upstream-report-draft.md

### bash-launch-guard test timing assertion fails under high host load
- **Id**: BL-0305
- **Status**: open
- **Since**: 2026-10-25
- **Origin**: self
- **Problem**: 其中一條防護測試要求長輸入（16000 字元與 64 KB）各在 100 毫秒內處理完。主機負載高（約 35）時穩定失敗：10/25 量到 121 與 106 毫秒，三次重跑都紅；負載正常時是綠的。
- **Impact**: 推送前跑套件會出現和改動無關的紅，要人工判讀是不是真的有問題。
- **Trigger**: next time the suite is run before a push, or the test file is edited
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: 2026-10-25 pre-push suite runs at 670b3ffaf and 1d38cfefb
- **Pointer**: project/backlog/bash-launch-guard-timing-assertion-load.md

### dev-setup --harness agy --install fails validation on agy 1.4.7
- **Id**: BL-0308
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: peer
- **Reporter**: <host> peace--claude-2
- **Report**: 2026-10-26 fleet
- **Reply**: 2026-10-26 fleet
- **Problem**: 3.0.0-alpha.6 在 agy 1.4.7 安裝驗證失敗（3 個錯誤、4 個警告，載入的 agent 為 0）：三個 agent 檔的工具欄位格式不對，另有檔案不被載入或被截斷。
- **Impact**: agy 上裝不起這個 plugin；agy 審查目前走 cleanroom，不受影響。
- **Trigger**: 3.0.0 之後；someone needs the autopilot plugin itself installed on agy, or agy reviewers stop using cleanroom
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED <host> (peace--claude-2) 2026-10-26, agy 1.4.7, 3.0.0-alpha.6
- **Pointer**: project/backlog/agy-147-plugin-install-validation.md
- **Context**: Check first whether Claude Code and Codex read an array-form tools field; then edit the source files or convert at agy install time.

### Orchestrator slows itself down: seven process gaps from a peer
- **Id**: BL-0309
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: peer
- **Reporter**: <host> peace--claude
- **Report**: 2026-10-26 fleet
- **Reply**: 2026-10-26 fleet
- **Problem**: peer 回報編排者自己拖慢進度的七處：交接檔不分 owner 指示與前任判斷、停滯偵測看不到只改計畫不合入、DOA 內仍去問、審查迴圈不隨嚴重度縮編等。
- **Impact**: 流程多花輪次與 owner 時間；指引類改動要先有 ON/OFF 評測。
- **Trigger**: 3.0.0 之後；an ON/OFF eval slot opens for items 1, 5, 7, the item 3 DOA-table rows and the top-stale wiring (efficiency class, jumps the queue)
- **Trigger-Type**: owner
- **Effort**: L
- **Source**: PEER-REPORTED <host> (peace--claude) 2026-10-26
- **Pointer**: project/backlog/orchestrator-self-slowdown-seven-gaps.md
- **Context**: Items 2, 6 shipped c9366c79a; item 3 mechanism shipped 4a34aa3a0; item 4 closed (d-f1aea07b, A). Left: top-stale wiring, item 3 DOA-table rows, items 1, 5, 7, all guidance needing ON/OFF eval. See sidecar.

### Stamped eval rows may have lost files from their frozen set
- **Id**: BL-0310
- **Status**: open
- **Since**: 2026-10-26
- **Origin**: self
- **Problem**: 已蓋章的評測列可能漏凍結檔案（bpack、gdorm、dcard-v3、qs-v3）。要查蓋章後這些檔有沒有被改過；改過的話，該列結果無法從原檔重新推導。
- **Impact**: 檔案蓋章後若被改，舊評測列的結果就無法重新驗證。
- **Trigger**: a spare lane is free for the audit, or an old stamped row is re-derived
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: fbstamp closure-scan observation 2026-10-26
- **Pointer**: project/backlog/stamped-rows-missing-frozen-files.md
- **Context**: Past batch evidence must not be edited; this is a read-only check. transcript-query.js unchanged since 10/4.

### Suites red on base at every pre-push run: one list
- **Id**: BL-0313
- **Status**: open
- **Since**: 2026-10-27
- **Origin**: self
- **Problem**: 推送前跑套件，有十幾支在 base 上本來就紅（非新引入），每次都要人工判讀；清單與各自的紅法見旁檔。
- **Impact**: 真正的新紅會被淹沒，每次推送都得重新分辨。
- **Trigger**: next pre-push suite run, or a lane touches one of the listed suites
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: pre-push suite runs 2026-10-26 to 10-27 (noexpiry, agyargv2, fbland, fbv3)
- **Pointer**: project/backlog/base-red-suite-list.md
- **Context**: bash-launch-guard timing is BL-0305 and is not repeated here.

### The library path openDecision() skips the --not-authorized and DOA checks
- **Id**: BL-0320
- **Status**: open
- **Since**: 2026-10-28
- **Origin**: self
- **Problem**: 只有命令列開卡會檢查「這題為何輪不到自己決定」的旗標與 DOA；程式內部開卡的路徑（提問攔截 hook、子代理預算 hook、資格考確認代 owner 開卡）完全不檢查。
- **Impact**: 自動開卡的路徑在自主模式下仍能開出 DOA 內的卡，繞過 BL-0309 第 3 項剛上的防線。
- **Trigger**: someone picks up BL-0309 item 3 follow-ups, or an auto-opened card inside the DOA is seen in an autonomous session
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: doagate merge 4a34aa3a0 and depth-0 ruling 2026-10-28 (self)
- **Pointer**: project/backlog/open-decision-library-path-unchecked.md
- **Context**: Depth-0 ruling on doagate deliberately did not add the check to the library path; first inventory what boundary each of the three callers' cards belongs to, then decide whether to add it. Follow-on of BL-0309.

### A review seat that fails once voids the whole generation
- **Id**: BL-0322
- **Status**: open
- **Since**: 2026-10-28
- **Origin**: self
- **Problem**: 四席審查中只要有一席失敗（例如被閒置上限砍掉），整代審查就作廢，必須人工把同一席重派才能繼續；同席重派通常就成功。
- **Impact**: 每次單席故障都多等一輪並要人介入，審查變慢。
- **Trigger**: next review generation voided by a single seat fault, or the next edit to the review collector
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: bltidy20 handoff list 2026-10-28; idle cap shipped ae247356e, paid-batch auth stop shipped 8183aaaf2
- **Pointer**: project/backlog/review-seat-fault-no-auto-redispatch.md

### Selection result reports each changed file's contribution
- **Id**: BL-0333
- **Status**: open
- **Since**: 2026-10-29
- **Origin**: owner
- **Problem**: 選出幾百支套件時，看不出是哪個改動檔把它們拉進來的，也就不知道該先處理哪個。
- **Impact**: 每次都要手動逐檔試跑才能找出灌水來源，這次調研就花了大量時間。
- **Trigger**: 3.0.0 之後；work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: owner request 2026-10-29 (suite speed research)
- **Pointer**: project/backlog/pre-push-suite-speed.md
- **Context**: Contribution report: add per-file contrib to --json. Negative control: single-suite diff reports exactly 1 sole-pulled. After BL-0332.

### Time assertions scale with the timing factor and host-wide process scans are prefix-scoped
- **Id**: BL-0334
- **Status**: open
- **Since**: 2026-10-29
- **Origin**: owner
- **Problem**: 幾支測試用固定的短時間判斷（例如 2 秒內工人要啟動），機器忙的時候工人還沒起來就被判失敗；另有測試掃整台機器的程序，會看到別人的。
- **Impact**: 2026-10-29 串行跑已紅過一次；平行下預期更多假紅（預測：負載 30+ 時牆鐘斷言串行下就已紅）。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: owner request 2026-10-29 (suite speed research)
- **Pointer**: project/backlog/pre-push-suite-speed.md
- **Context**: Scale time asserts by test_timing_scale, prefix-scope pgrep, wait FAKE_STARTED in gate-rules R2 :133. Negative control: red under load before, green after (B3).

### Missing paths, files or tools abort or silently disable autopilot on a fresh host or after a /tmp wipe
- **Id**: BL-0336
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: llm-playground session on <host>；llm-playground session on <host>
- **Report**: 01M66YQ9Y3R3PC1DF2EK7HGXKH；01M66YW3B1QS5VK0PNAA9JTBN0
- **Reply**: 2026-10-31 01M66YQG8DWF6HCWJ9N335GH43；2026-10-31 01M66Z1CTT0FDC92N0WWARYBDP
- **Problem**: 新機器或重開機清掉暫存目錄後，許多地方假設目錄、檔案或工具已存在，缺了就中止或悄悄失效；例子是狀態列常駐顯示無法使用，因為背景監看程式找不到清單目錄。
- **Impact**: 新機器與重開機後多個功能悄悄壞掉，使用者看不到原因，只能手動補目錄。
- **Trigger**: U1 merged 700dce7db (2026-10-31), pushed, reporter notified (fleet msg 01M67VAETCTWH5C1ZPZKC2KJ65); U2 remains: doctor, detach/flock failure messages, F5 diagnostics, evaluateLiveDir
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PEER-REPORTED llm-playground 2026-10-31, scope widened by owner via <host>
- **Pointer**: project/backlog/missing-path-assumptions.md
- **Context**: Widened by owner (second Report). Eg runs-watch.js:1059 aborts on missing /tmp/autopilot-dispatch-runs. Design doc first (inventory, ensureDir helper, unavailable reason, doctor, empty-HOME test).

### Decision card opened from another repo's cwd lands in that repo and the panel never shows it
- **Id**: BL-0337
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: hangar session (openclaw)
- **Report**: 01M66YRNXRT5SNRXF6QDRV3JGF
- **Reply**: none
- **Problem**: 從別的專案目錄執行開決策卡指令時，卡片會寫進該目錄所在的專案，操作者的面板讀的是另一個專案，所以看不到卡，指令卻照常回傳編號、毫無警告。
- **Impact**: 操作者漏看一張待決卡；這次改口頭回答，沒有損害，但可能再發生。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: PEER-REPORTED hangar 2026-10-31
- **Pointer**: project/backlog/open-decision-cwd-scope.md
- **Context**: Scope from process cwd git-common-dir; only unbound warns (~L275). Options: warn/refuse on repo mismatch, derive from session marker, fix SessionStart hint wording.

### SessionStart agent-brief hint is not copyable and the two dispatch guards reject it one at a time
- **Id**: BL-0338
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: llm-playground session on <host>
- **Report**: 01M66Z68PA0PZDR96C0XRKECP1
- **Reply**: none
- **Problem**: 開工提示把派工單頭三行串成一行，照抄會被預算守衛擋；改三行後，貴引擎又被模型守衛擋，因為提示沒寫「刻意使用」的寫法，兩道守衛各擋一次。
- **Impact**: 每次在新 session 派貴引擎至少白擋兩次，浪費時間與額度。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: PEER-REPORTED <host> 2026-10-31, owner asked; depth-0 verified
- **Pointer**: project/backlog/brief-header-hint-guards.md
- **Context**: hooks/lib/brief-header-template.js:76 joins lines with " | "; hooks/subagent-budget.js:498; dispatch-model-guard. Fix: copyable 3-line template incl. intentional form, one merged message, regression test.

### engine-scorecard strip-expiry silently writes the real engine-capability store when only one directory is overridden
- **Id**: BL-0339
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: peace (<host>)
- **Report**: 01M67HZPT918GAWJG237T0JG8N
- **Reply**: 2026-10-31 01M67J17Z9Z9A3TADXHQCSBGXC
- **Problem**: 成績單工具的去除期限指令同時動到兩個資料夾，一個放席位成績列，一個放證據與釘選。只改道其中一個時，另一個會悄悄寫進真實的資料夾。
- **Impact**: 回報者的子代理對副本跑時，真實的證據與釘選被改寫，事後靠備份還原；資料安全問題。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: PEER-REPORTED peace (<host>) 2026-10-31, priority high (data safety)
- **Pointer**: project/backlog/engine-scorecard-strip-expiry-store-split.md
- **Context**: Fix direction: refuse when only one of the two dirs is overridden, or list every path about to be written before writing. Add a negative control (one override only must be refused).

### dispatch-review.sh cannot read only the last message and has no REWORK or STOP verdict
- **Id**: BL-0340
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: peace (<host>)
- **Report**: 01M67HZPT918GAWJG237T0JG8N
- **Reply**: 2026-10-31 01M67J17Z9Z9A3TADXHQCSBGXC
- **Problem**: 審查派工腳本沒有「只讀最後一則訊息」的模式，判決詞彙也沒有 REWORK 或 STOP；回報者目前把判決塞在發現清單的一行裡承載。
- **Impact**: 回報者靠繞路承載判決；判決詞彙刻意只有 SHIP-AS-IS／FIX-THEN-SHIP，擴充會牽動 receipt 與 finalize 契約。
- **Trigger**: next edit to dispatch-review.sh or the verdict vocabulary, or a second peer asks for REWORK/STOP
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED peace (<host>) 2026-10-31
- **Pointer**: project/backlog/dispatch-review-last-message-and-verdicts.md
- **Context**: Evaluate first: a last-message-only read mode, and whether widening the verdict vocabulary is worth the receipt and finalize contract change.

### Strike writer allowlist has no writer for project-embedded calibration
- **Id**: BL-0341
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: peace (<host>)
- **Report**: 01M67HZPT918GAWJG237T0JG8N
- **Reply**: 2026-10-31 01M67J17Z9Z9A3TADXHQCSBGXC
- **Problem**: strike 寫入者的允許名單裡沒有「專案植入校準」這類寫入者，回報者只能暫借 qualification_admin 的身分寫入。
- **Impact**: 回報者借用不屬於自己的寫入者身分，紀錄的來源標示不準確。
- **Trigger**: next edit to the strike writer allowlist, or a second project embeds calibration
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED peace (<host>) 2026-10-31
- **Pointer**: project/backlog/strike-writer-allowlist-calibration.md
- **Context**: Decide whether to add a dedicated writer id for project-embedded calibration to the strike writer allowlist.

### Scorecard stores written before 2026-10-26 need a manual strip-expiry on every machine or all seats read as unqualified
- **Id**: BL-0342
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: peer
- **Reporter**: peace (<host>)
- **Report**: 01M67HZPT918GAWJG237T0JG8N
- **Reply**: 2026-10-31 01M67J17Z9Z9A3TADXHQCSBGXC
- **Problem**: 2026-10-26 以前寫入的成績單資料，每台機器都要手動跑一次 strip-expiry，否則所有席位都被判不合格；說明文字有寫，但沒跑時的失敗方式很難看出原因。
- **Impact**: 沒跑的機器上所有席位都判不合格，使用者不知道要補跑哪個指令。
- **Trigger**: next edit to engine-scorecard store loading, or another machine reports all seats unqualified
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED peace (<host>) 2026-10-31
- **Pointer**: project/backlog/scorecard-pre-1026-store-migration.md
- **Context**: Evaluate migrating automatically on load, or an explicit prompt from doctor or SessionStart naming the strip-expiry command.

### runs-watch: a regular file at <live>/runs makes the parent mkdir fail with EEXIST and leaves no launch result
- **Id**: BL-0344
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: self
- **Problem**: 即時狀態資料夾裡的 runs 若是一般檔案而不是目錄，監看程式建立目錄會失敗，而且不留下任何啟動結果檔，面板看不到原因。
- **Impact**: 面板上看不到失敗原因；舊版也一樣，屬既有缺口，不是新引入的退步。
- **Trigger**: next edit to runs-watch.js launch path, or BL-0336 U2
- **Trigger-Type**: event
- **Effort**: S
- **Source**: BL-0336 U1 third-round acceptance finding 2026-10-31
- **Pointer**: project/backlog/runs-watch-runs-path-is-file.md
- **Context**: Fix direction: detect a non-directory at <live>/runs and write a launch result file with the reason. Related to BL-0336 (missing-path assumptions).

### engine-effort-default.test.sh goes falsely red 4 cases every day from 00:00 to 01:00 UTC
- **Id**: BL-0345
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: self
- **Problem**: 其中一支引擎預設努力程度的測試，測試資料用「現在減一小時」當簽發時間，卻用「現在」的日期當資格日期；跨過 UTC 午夜時兩個日期對不上，回報成績單資格日期與能力證據不符，假紅 4 條。
- **Impact**: 每天 UTC 00:00–01:00（台北 08:00–09:00）跑這支測試會假紅，容易被誤判成真的回歸；09:00 之後自己轉綠。
- **Trigger**: work can start now
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: reproduced 2026-10-31 Taipei 08:40 on develop 7a5bd925d, green after 09:00
- **Pointer**: project/backlog/engine-effort-default-test-midnight-date-skew.md
- **Context**: Fix: derive issued time and qualified_at date from the same single instant. Negative control: pin the clock to 00:30 UTC and the 4 cases must stay green.

### status runs --json drops the reason when the runs directory is rejected
- **Id**: BL-0347
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: self
- **Problem**: status runs --json 在 runs 目錄被拒時，原因放在陣列的 runs_dir_error 屬性上，JSON.stringify 會丟掉它，所以 JSON 輸出看不到原因；stderr 與文字輸出有顯示。
- **Impact**: 用 JSON 輸出的使用者與腳本拿到空結果，看不出是目錄被拒。
- **Trigger**: next edit to src/status/cli.js runs output, or BL-0336 U2
- **Trigger-Type**: event
- **Effort**: S
- **Source**: BL-0336 U1 second-generation review suggestion 2026-10-31
- **Pointer**: project/backlog/status-runs-json-drops-runs-dir-error.md
- **Context**: src/status/cli.js about L167-193. Fix: JSON mode emits an object, or the reason goes in a serializable place. Negative control: a rejected runs dir must show its reason in --json output.


### Registry reader follow-ups from the relay2 review (four cut suggestions)
- **Id**: BL-0349
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: self
- **Problem**: relay2 審查砍了四條小建議：搬檔工具寫死路徑沒接登錄表、一個全域旗標不會回復、一個參數的讀取範圍變了沒註明、key 數敘述對不上。
- **Impact**: 都不影響現行行為；P3、P4 搬檔時寫死路徑會漏跟、同一程序先後跑兩種模式會讀錯目錄，文件數字對不上會誤導讀者。
- **Trigger**: relayout P3 or P4 starts, or next edit to scripts/check-plan-graduation.js
- **Trigger-Type**: event
- **Effort**: S
- **Source**: relay2 review g1 (753bac21) and g2 (1e396ce2, f162da8f, 5ca6c335), 2026-10-31
- **Pointer**: project/backlog/registry-reader-relay2-follow-ups.md
- **Context**: Four small fixes, one commit; details in the sidecar.


### Top-level leftovers for relayout P phases: skill-creator-workspace, .qc, .autopilot/evidence
- **Id**: BL-0351
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: self
- **Problem**: 頂層還有三塊雜物沒決定去留：技能評測工作區（89 個追蹤檔）、審查判決檔目錄、評測報告目錄（2 個檔）。
- **Impact**: 搬或刪之前若不查讀取者，會弄壞評測腳本、pre-push 關卡與下一次觸碰驗證。
- **Trigger**: relayout P phase that touches the top level
- **Trigger-Type**: event
- **Effort**: M
- **Source**: relay2 layout work, 2026-10-31
- **Pointer**: project/backlog/top-level-leftovers-relayout.md
- **Context**: Readers and risks per item are in the sidecar.

### live band 後續四件：窄寬度溢出、重複 slot 按鈕、待決入口、R2 偶發紅
- **Id**: BL-0355
- **Status**: open
- **Since**: 2026-10-31
- **Origin**: self
- **Problem**: band 讓下層疊放並加上分頁後，審查與驗收留下四個小缺口：分頁列在窄終端可能比欄寬還寬；「現況」「審查」分頁內重畫了 band 列已有的按鈕；待決數的入口只在寬終端出現；一支派工規則測試在高負載時偶發紅。
- **Impact**: 窄終端可能破版；Tab 焦點多停幾格；窄終端無直達「待決」入口；全套同跑時 R2 測試偶發假紅。
- **Trigger**: next edit to mods/live/band.tsx, or the next time dispatch-hetero-gate-rules.test.sh flakes
- **Trigger-Type**: event
- **Effort**: M
- **Source**: bandyield round 2 four-vendor review and acceptance, 2026-10-31
- **Pointer**: project/backlog/live-band-follow-ups.md
- **Context**: Four independent items in the sidecar; they can be split when picked up.

### autopilot 的 extension 機制：讓 codeforge 等套件由 autopilot 統一安裝與掛載
- **Id**: BL-0356
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: peer
- **Reporter**: codeforge
- **Report**: 01M69BDD8K7CMWARG6NPDXMYSQ
- **Reply**: 2026-11-01 01M69BE8CG8B760BH3WYM44AST
- **Problem**: 一般使用者現在要分別裝 autopilot 和 codeforge 等套件，owner 說「不然一般 user 要裝一堆套件也是困擾」；band 在 host 端一次只有一條 mod 鏈，分頁由誰統一畫也沒有定案。
- **Impact**: 使用者得自己湊齊多個套件並各自設定，hooks 與分頁互相搶位，體驗零碎。
- **Trigger**: 3.0.0-alpha.7 released (relayout P1-P5 paths settled); owner chose to start from alpha.8, before 3.0.0 final
- **Trigger-Type**: event
- **Effort**: L
- **Source**: PEER-REPORTED codeforge 2026-11-01 (owner decision on card d-0e2e6e0d; codeforge main b12c8d0, BACKLOG B31 and agent-coupling ADR)
- **Pointer**: project/backlog/extension-mechanism.md
- **Context**: Consensus, contract pieces and plan-review focus are in the sidecar. Plan first, codeforge joins the plan review.

### band 加一個 fleet 分頁，由 autopilot 畫
- **Id**: BL-0358
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: peer
- **Reporter**: codeforge
- **Report**: 01M69BHRJMNZ6XRXEERDTX62KG
- **Reply**: 2026-11-01 01M69BJE67SRNZD4C6XN9F6Z0G
- **Problem**: 想在 band 上直接看到 fleet 的狀態，現在要開終端打指令才看得到。
- **Impact**: 要看在線的 peer、未讀訊息與待核准數量，都得離開畫面去打指令。
- **Trigger**: 3.0.0 之後；after 3.0.0-alpha.7 ships, or when the BL-0356 plan is written
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED codeforge 2026-11-01; owner chose autopilot-drawn tab on card d-d99e2d99
- **Pointer**: project/backlog/band-fleet-tab.md
- **Context**: No approve button on the tab (human-only tty gate); research how a mod reads fleet state first.

### 速度量測與顯示從 forge-stats 移交給 live mod（分頁 ϟ 標籤、速度欄、最近請求表）
- **Id**: BL-0359
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: peer
- **Reporter**: codeforge
- **Report**: 01M6A95050YK4D480QJXK54QDW
- **Reply**: 2026-11-01 01M6A95N5HQ26507XPERC9JFVJ
- **Problem**: owner 在 codeforge 的卡片 d-7b0f7a4a 選 A：速度整包改由 autopilot 量測並繪製，含分頁列的 ϟ 標籤、速度欄（平均、最佳、最新、首字、走勢）與最近請求表。forge-stats 之後只畫 Ferris、寵物、記憶與大腦。
- **Impact**: 移交前 live mod 仍讀 codeforge 的 keyed Box；我們上線並把 sha 告訴 codeforge 後，他們才移除自己的速度程式，中間沒有空窗。
- **Trigger**: 3.0.0 之後；after 3.0.0-alpha.7 ships (the mods path moves during the relayout, same reason as BL-0358)
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PEER-REPORTED codeforge 2026-11-01 (fleet message), owner card d-7b0f7a4a
- **Pointer**: project/backlog/live-speed-handover-from-forge-stats.md
- **Context**: Algorithm, handover order and the pet-label question are in the sidecar. Show the owner a screenshot before any UI change; reply to codeforge with the sha once live.

### agent-call SKILL.md 沒有指向 FYI 寄件規則
- **Id**: BL-0361
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: peer
- **Reporter**: hangar
- **Report**: 01M6ACKW3XX6KSGQDVA31SQDKR
- **Reply**: 2026-11-01 01M6ACM9T44SZ88EKG392KF0H3
- **Problem**: agent-call 技能只在定址段連到定址參考文件，而且只要求送頻道廣播前才讀。一般的送出與回覆讀不到新增的「不需回覆的訊息要標 FYI」那一段。
- **Impact**: 不需要回覆的訊息沒有標 FYI，會叫醒閒置的 session。
- **Trigger**: next edit to skills/agent-call/SKILL.md
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED hangar 2026-11-01 (fleet message; hangar BACKLOG row waits on our sha)
- **Pointer**: project/backlog/agent-call-fyi-pointer.md
- **Context**: SKILL.md needs one line pointing at the section in references/peer-addressing.md (db0fb565a). Guidance change: apply the mechanism-vs-guidance test first. Reply to hangar with the sha.

### leak-guard 還原放行的兩條硬化
- **Id**: BL-0362
- **Status**: open
- **Since**: 2026-11-01
- **Origin**: self
- **Problem**: 還原放行有兩處沒有測到：同一檔超過 500 行 finding 時改走整檔 blame 的路徑沒有單元測試；blame 標頭的比對寫死 40 位 SHA-1，SHA-256 的 repo 會解析不到，所有放行都失效。
- **Impact**: 只影響放行，掃描本身不受影響；兩者出錯時都是不放行、不會漏放；目前 repo 是 SHA-1。
- **Trigger**: next edit to scripts/leak-guard.js
- **Trigger-Type**: event
- **Effort**: S
- **Source**: leakfu review g5 (CUT/FOLLOW-UP suggestions), 2026-11-01
- **Pointer**: project/backlog/leak-guard-restore-hardening.md

### bash-launch-guard 對長串命令替換輸入的處理時間超線性
- **Id**: BL-0370
- **Status**: open
- **Since**: 2026-11-03
- **Origin**: owner
- **Problem**: 每次執行 Bash 前都會跑的啟動守衛，遇到很長的連續「錢字號加左括號」字串時，輸入越長就越慢，而且變慢的幅度比輸入增加得更快。
- **Impact**: 一般指令不受影響；只有超過約 16 KB 的怪異輸入會變慢，128 KB 時要半秒。
- **Trigger**: next edit to scripts/lib/bash-launch-rules.js
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PM base-reds triage (br3 lane), 2026-11-03
- **Pointer**: project/backlog/segments-dollar-paren-superlinear.md

### 派工 brief 自動帶上「先讀子目錄 AGENTS.md」
- **Id**: BL-0387
- **Status**: open
- **Since**: 2026-11-04
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: BL-0383 入口文件拆分的 Q6 裁示, 2026-11-04
- **Reply**: none
- **Problem**: Codex、agy、OpenCode 這類工具不會自己往子目錄走，從根目錄開工就看不到各子目錄的規則檔。入口文件拆分只在派工說明裡加了一句文字，要求 brief 寫明「先讀該子目錄的 AGENTS.md」，沒有任何機制檢查。
- **Impact**: 派去 Codex 或 agy 的工作若漏寫這句，工人看不到該目錄的規則，可能做出違反子目錄規定的改動。
- **Trigger**: BL-0383 合併之後，下次動 dispatch 軌道的 brief 組裝時
- **Trigger-Type**: event
- **Effort**: M
- **Source**: pm:knowledge/harness-entry-docs.md 規則 4（pm repo 無 remote，無網址）
- **Pointer**: project/backlog/brief-reads-subdir-agents-md.md

### autopilot CLAUDE.md 裡給使用端的規則從沒送到使用端
- **Id**: BL-0388
- **Status**: open
- **Since**: 2026-11-04
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: BL-0383 入口文件拆分的即時注入測試, 2026-11-04
- **Reply**: none
- **Problem**: 即時測試顯示，把 autopilot 當 plugin 裝的使用端專案，不會載入 plugin 的任何 CLAUDE.md，根目錄和子目錄都一樣。所以 autopilot 根目錄或子目錄 CLAUDE.md 裡原本要給使用端 session 看的規則，從來沒送到過它們。
- **Impact**: 使用端 session 看不到這些規則，可能做出違反規定的事，而 autopilot 這邊以為已經寫明。
- **Trigger**: PM 派工；現在不做
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: BL-0383 live injection test (PM, 2026-11-04)
- **Pointer**: project/backlog/consumer-rules-in-claude-md.md

### 全套件跑完的紀錄，推送前的結果檢查讀不到
- **Id**: BL-0390
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 全套件與審查流程的檢討, 2026-11-05
- **Reply**: none
- **Problem**: 推送前的結果檢查只讀「受影響套件」那種紀錄，全套件跑完存下的紀錄會被忽略，所以用全套件驗過的合併，還得再補跑一次部分套件才能過關。
- **Impact**: 合併者要跑兩次套件，浪費時間，還容易漏補。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PM 2026-11-04/05 (approved)
- **Pointer**: project/backlog/outcome-gate-full-suite-record.md

### 受影響套件的挑選在純文件變更時太寬，又漏掉三種依賴
- **Id**: BL-0391
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 全套件與審查流程的檢討, 2026-11-05
- **Reply**: none
- **Problem**: 只改文件也會挑出幾乎全部套件，全套件規定幾乎每條工作線都觸發；同時漏掉複製腳本進暫存目錄、掃整棵目錄內容、凍結技能檔副本的三種測試。
- **Impact**: 挑選又寬又漏：多花時間跑無關套件，真正會紅的反而沒挑到。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: PM 2026-11-04/05 (approved)
- **Pointer**: project/backlog/affected-suites-blind-spots.md

### 全套件跑時，序列套件變紅不會單獨重跑
- **Id**: BL-0392
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 全套件與審查流程的檢討, 2026-11-05
- **Reply**: none
- **Problem**: 全套件執行只會把並行池裡紅的套件單獨重跑，列在序列清單的套件不會。負載高時計時敏感的序列套件紅了，單獨跑卻是綠的，卻被當成退步。
- **Impact**: 負載高時會有假紅，合併者得手動辨認，容易誤判成真的退步。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PM 2026-11-04/05 (approved)
- **Pointer**: project/backlog/run-all-serial-rerun.md

### mods 三個測試腳本從不在全套件裡跑
- **Id**: BL-0393
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 全套件與審查流程的檢討, 2026-11-05
- **Reply**: none
- **Problem**: 三個 mod 測試腳本現在能用真的 claude 跑（要手動指定路徑），但全套件執行還沒帶這個路徑，所以在全套件裡仍被哨兵擋掉、從沒跑過。
- **Impact**: 這三個 mod 的 852 個測試仍沒有在全套件裡自動把關。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: PM 2026-11-04/05 (approved)
- **Pointer**: project/backlog/mods-run-tests-full-suite.md

### rrint1 審查留下的後續小項
- **Id**: BL-0394
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: review seats（hetero-review rrint1 g1）
- **Report**: rrint1 g1 review, 2026-11-05
- **Reply**: none
- **Problem**: 審查迴圈有幾個小缺口：Range 的值大小寫不一致會被當成無法辨識、單獨的 --expect-range 被默默忽略、重新定稿路徑不提醒未解決項，另有兩個測試不夠嚴。
- **Impact**: 都是小缺口，不修不會壞，但審查範圍檢查偶爾會誤判或漏報。
- **Trigger**: 下次改 hetero-review-loop.js 時
- **Trigger-Type**: event
- **Effort**: S
- **Source**: rrint1 g1 deferred Suggestions
- **Pointer**: project/backlog/rrint1-review-follow-ups.md

### 主 checkout 的 hooksPath 指進工作線目錄，會蓋掉全域實驗室鉤子
- **Id**: BL-0395
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 主 checkout 鉤子路徑事件, 2026-11-05
- **Reply**: none
- **Problem**: 主 checkout 的本機設定曾把鉤子路徑指進某條工作線的目錄，所有 worktree 的推送都跑那條線的鉤子；該目錄一刪或換分支鉤子就悄悄消失，還蓋掉全域實驗室鉤子。已手動修好。
- **Impact**: 鉤子悄悄失效，推送前的檢查沒跑，沒人發現。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PM 2026-11-05 (approved)
- **Pointer**: project/backlog/repo-local-hookspath-shadow.md

### mods 真實 claude 守衛可能被殘留的子孫行程搶時間差
- **Id**: BL-0396
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: review seats（hetero-review modsreal g3, astra）；PM（pm--claude）
- **Report**: modsreal g3 review, 2026-11-05；2026-11-05 PM ruling
- **Reply**: none；none
- **Problem**: 守衛先驗沙箱根目錄身分再掃描清理；claude 跑完後仍活著的子孫行程可在驗身分與掃描之間換掉路徑，讓掃描只看到符號連結而誤判為綠，或讓 chmod 跟著換過的連結走。
- **Impact**: 守衛偵測意外洩漏憑證或對話紀錄的能力在極端時序下失靈；不是對付惡意行程。
- **Trigger**: modsreal 工作線合併後
- **Trigger-Type**: event
- **Effort**: S
- **Source**: modsreal g3 review (astra); PM ruling 2026-11-05 (not a blocker)
- **Pointer**: project/backlog/real-claude-guard-descendant-race.md

### dispatch-author-kill-after：並行池裡紅過一次，原因未留下
- **Id**: BL-0397
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: 全套件並行池中，殺進程逾時測試紅了一次，單獨重跑卻綠；池內那次的輸出沒有留下，不知道為什麼紅。它的姊妹測試以前也因同機行程互相干擾而不穩。
- **Impact**: 之後再紅仍查不出原因，只能當偶發放過，真正的問題可能被掩蓋。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PM 2026-11-05 fleet（全套件 run-all, jobs 6, 負載約 39）
- **Pointer**: project/backlog/dispatch-author-kill-after-flaky.md

### 審查收據：54 個可能被漏修的已驗證發現要人工逐條查
- **Id**: BL-0398
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: 全機統計 443 份審查收據中有 99 份留有前幾代已驗證卻沒寫解決記錄的發現。粗估其中 54 條所引用的檔案之後從沒被改過，可能是被漏修，不只是漏記。
- **Impact**: 真的被漏修的 Major 發現會帶著已通過的收據上線，沒人知道。
- **Trigger**: 期限 2026-11-08，進行中的工作線優先
- **Trigger-Type**: date:2026-11-08
- **Effort**: M
- **Source**: PM ruling 2026-11-05 fleet（host count 2026-11-05）
- **Pointer**: project/backlog/unresolved-finding-audit.md

### 審查迴圈收尾輸出把未解決與待解決混在一個數字
- **Id**: BL-0399
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: codeforge
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: 收尾輸出的未解決發現數，把已驗證但還沒被後一代明確解決的發現也算進去。這是設計如此，但輸出沒說明，解決的寫法也沒寫清楚。
- **Impact**: 使用端看到數字不為零，不知道是真的沒修，還是只差一筆解決記錄。
- **Trigger**: next touch of the hetero-review-loop finalize summary
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PEER-REPORTED codeforge 2026-11-05
- **Pointer**: project/backlog/review-loop-open-vs-pending-split.md

### 殺進程逾時測試在高負載主機上單獨跑也會紅
- **Id**: BL-0400
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: 殺進程逾時測試在主機負載四十多時，單獨跑也有四條時間斷言失敗，量到九到十五秒，超出測試寫死的上限。時間上限不能硬加寬，要改成不靠牆上時間的判法。
- **Impact**: 高負載時這支測試固定紅，會蓋住真正的新壞掉。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: PM 2026-11-05 fleet（四次執行，負載 40-43）
- **Pointer**: project/backlog/kill-after-timing-bounds-under-load.md

### 四支測試只在並行池裡紅，另一支偶發
- **Id**: BL-0401
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: 全套件並行時有四支測試紅、單獨跑卻綠，是同機互相干擾。另有一支付費批次停止測試偶發紅，13ac151f0 全套件又見 runs-watch-start 只在並行池紅、單獨綠。
- **Impact**: 完整套件會出現假紅，要靠人工單獨重跑才能判斷。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: M
- **Source**: PM 2026-11-05 fleet（04913afdf 全套件）
- **Pointer**: project/backlog/suite-pool-interference-and-intermittents.md

### d0gate 測試的凍結樣本只對已結案那一輪成立
- **Id**: BL-0402
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: self
- **Problem**: d0gate 測試現在拿凍結樣本跟釘住提交上的程式比對，因為那一輪已結案。開新一輪時沒有重釘，測試就會比對過期的版本。
- **Impact**: 新一輪 d0gate 若沒重釘，測試照樣綠但沒驗到現行程式。
- **Trigger**: next d0gate round
- **Trigger-Type**: event
- **Effort**: XS
- **Source**: wfix merge 8c0d36273
- **Pointer**: project/backlog/d0gate-stub-repin-on-new-round.md

### 公開匯出工具要排除本機 hippo 資料夾
- **Id**: BL-0403
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: self
- **Problem**: 第二階段公開匯出工具還沒明文排除本機 hippo 資料夾，版面清單也還沒登記它。沒排除，本機資料可能被帶進公開匯出。
- **Impact**: 本機資料夾可能混進公開匯出。
- **Trigger**: relayout C2 export tool
- **Trigger-Type**: event
- **Effort**: S
- **Source**: relayout plan amendment E1 review 2026-11-05
- **Pointer**: project/backlog/relayout-c2-export-hippo.md

### 即時面板輸入雙 @ 時自動補全席位名稱
- **Id**: BL-0404
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 2026-11-03 fleet
- **Reply**: none
- **Problem**: 想在即時面板輸入兩個 @ 時，列出席位名稱讓人補全（例如 @@codex）。這是新功能，不是缺陷，目前沒有人回報任何症狀。
- **Impact**: 不做的話，指定席位仍要手打完整名稱，容易打錯。
- **Trigger**: 角色成員機制的計畫完成之後
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PM 2026-11-03 request；fleet 01M6FA4D51Q47AGXJR4ACY94TP 處置：排在 role-members 之後
- **Pointer**: project/backlog/seat-name-autocomplete.md

### G29：owner 端的派工與處理迴圈要寫一份薄計畫
- **Id**: BL-0405
- **Status**: open
- **Since**: 2026-11-05
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 2026-11-05 fleet
- **Reply**: none
- **Problem**: owner 端要改用艦隊子席位派工、依驗收判斷並有重試額度、用完升級給 PM，另要子樹進度顯示。第 3 項已轉到 fleet 的 backlog；第 1、2、4 項在 role-members 之後寫一份精簡的 owner 端計畫；其他項目關掉。
- **Impact**: 不做的話，owner 端的派工、驗收與升級仍靠各 session 自行處理，進度也看不到。
- **Trigger**: 角色成員計畫完成之後
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PM go-ledger G29；fleet 01M6FBQGQEMB5E513JSG7957WD 處置：第 1、2、4 項在 role-members 後寫精簡 owner 端計畫
- **Pointer**: project/backlog/g29-owner-dispatch-handling-loop.md

### 計畫回執要能收下超過世代上限後的補錄
- **Id**: BL-0406
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 01M6NMTWQJPNV799ZQYD71MSNW
- **Reply**: none
- **Problem**: 計畫審查超過世代上限後，回執檢查不收補錄，只能靠 PM 裁定頂替。程式審查已有補錄選項。11 月 5 日發生兩次。
- **Impact**: 每次超過上限都靠人工裁定，回執閘門形同缺席。
- **Trigger**: leadbase 完成之後
- **Trigger-Type**: event
- **Effort**: M
- **Source**: PM go 2026-11-05 (fleet 01M6NMTWQJPNV799ZQYD71MSNW)
- **Pointer**: project/backlog/plan-receipt-post-cap-ledger.md

### mods 小改動讓受影響套件挑到一半以上
- **Id**: BL-0407
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: self
- **Problem**: 只改 mods/roundtable 十個檔案，受影響套件挑出 496/789，等於每次都要跑全套。還不知道 mods 的變更為何擴散這麼廣。
- **Impact**: 小改動也觸發全套規則，浪費時間。與 BL-0391、BL-0410 同屬挑選準確度。
- **Trigger**: PM 派工
- **Trigger-Type**: owner
- **Effort**: S
- **Source**: autopilot depth-0, 2026-11-06 (rtchat)
- **Pointer**: project/backlog/affected-suites-accuracy-2026-11-06.md

### G39：不用託管 CI（範圍 a、b）
- **Id**: BL-0408
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 01M6FJW5Z8Q6N76XPQ05HKJAQN
- **Reply**: none
- **Problem**: 操作員決定不用託管 CI，但還留著兩個託管 workflow 和 Pages 設定。範圍 a、b 要等各工作線清空後再做。
- **Impact**: 不做的話，違反操作員決定的託管設定還在。
- **Trigger**: 各 lane 清空之後
- **Trigger-Type**: event
- **Effort**: S
- **Source**: PM fleet 01M6FJW5Z8Q6N76XPQ05HKJAQN
- **Pointer**: project/backlog/g39-no-hosted-ci.md

### G25：角色套件實驗併入 rolekit 計畫後關掉
- **Id**: BL-0409
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 01M6FAH6W29MQH5ATPC8E080MK
- **Reply**: none
- **Problem**: 角色套件實驗的內容要併進 rolekit 計畫的附錄，併完這一條就關掉。附錄由 rolekit lane 寫，這裡只記處置。
- **Impact**: 不記的話，實驗內容散在兩處，容易漏。
- **Trigger**: rolekit lane 寫完附錄
- **Trigger-Type**: event
- **Effort**: XS
- **Source**: PM fleet 01M6FAH6W29MQH5ATPC8E080MK
- **Pointer**: project/backlog/g25-role-bundle-into-rolekit.md

### 受影響套件漏掉被改審查腳本自己的套件與新的計畫路徑測試
- **Id**: BL-0410
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: PM（pm--claude）
- **Report**: 01M6HB7DK2BGZEZHT69R4DQX7C
- **Reply**: none
- **Problem**: 受影響套件挑選漏掉被改動的審查腳本自己的套件，也漏掉新的計畫路徑測試，有假綠風險。結果閘門只認受影響套件的紀錄，認不得全套紀錄。
- **Impact**: 漏挑的套件若紅，合併時看不到。
- **Trigger**: WIP 空出來即可；排在 bl-ap-streamjson 之前
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PM fleet 01M6HB7DK2BGZEZHT69R4DQX7C
- **Pointer**: project/backlog/affected-suites-accuracy-2026-11-06.md

### A3 要求每個會 commit 的帳號都有 hippo，但有兩類帳號沒有
- **Id**: BL-0411
- **Status**: open
- **Since**: 2026-11-06
- **Origin**: peer
- **Reporter**: hippo
- **Report**: 01M6HXPAF9ZTF59XKH68H8HR3A
- **Reply**: none
- **Problem**: A3.7 要求每個會 commit 的帳號都裝 hippo，但 Windows 帳號（操作員 A1）和公司主機帳號（d-10ab93ef）都沒有。
- **Impact**: 條件照寫會讓這兩類帳號永遠過不了，或被迫繞過。
- **Trigger**: A3 規劃時
- **Trigger-Type**: event
- **Effort**: S
- **Source**: hippo fleet 01M6HXPAF9ZTF59XKH68H8HR3A item 4
- **Pointer**: project/backlog/a3-hippo-account-exemption.md

### G40 探針政策依供應商分開建置
- **Id**: BL-0375
- **Status**: open
- **Since**: 2026-11-04
- **Origin**: self
- **Problem**: 額度探針要依各供應商分別訂政策。Claude 只有定期探測要等實驗結果，隨選探測不用等。這條是 BL-0372 之後的建置。
- **Impact**: 不做的話，額度探針第四階段仍關著。
- **Trigger**: BL-0372 兩層都 PASS 並切 G40 P2 旗標之後
- **Trigger-Type**: event
- **Effort**: M
- **Source**: operator d-2d6a93aa via PM, 2026-11-04
- **Pointer**: project/plans/2026-11-03-g40-agent-lane-quota.md

### 用量分頁的後續整理五項小修
- **Id**: BL-0424
- **Status**: open
- **Since**: 2026-11-07
- **Origin**: self
- **Problem**: 用量分頁審查留下五項小問題：空的分組會蓋掉別的分組；窄於四十欄時退回最小版本；指示符號佔掉兩格；一個測試標題寫錯；註冊檔裡的註解與程式不符。
- **Impact**: 都只影響顯示與可讀性，不影響資料。
- **Trigger**: next touch of the band usage tab
- **Trigger-Type**: event
- **Effort**: S
- **Source**: usagetab g1/g2 review Suggestions (2026-11-07)
- **Pointer**: project/backlog/usage-tab-follow-ups.md

### review-server 的測試在高負載下回 000，要查出根因
- **Id**: BL-0425
- **Status**: open
- **Since**: 2026-11-07
- **Origin**: owner
- **Problem**: review-server 測試裡「watcher 啟動的伺服器回 200」在全套負載 44 時回 000，全套與單獨重跑都紅；但單獨在兩個基底上各跑一次都綠。要在高負載穩定重現並修好根因。
- **Impact**: 全套高負載時出現假紅，真壞掉會被當成雜訊放過。
- **Trigger**: ready；在負載 40 以上用壓力工具或平行套件重現
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PM fleet 01M6TY1Q06 (2026-11-07)
- **Pointer**: project/backlog/flaky-under-load-suites.md

### 2026-11-16 刪除 codex 額度視窗的暫時路由設定
- **Id**: BL-0426
- **Status**: open
- **Since**: 2026-11-11
- **Origin**: owner
- **Problem**: PM 01M747R1N0 因 codex 額度見底，把實作者、審查者雲端退路、驗證作者、計畫審查暫時改走其他引擎，並放行同 runner 雙席；11-16 重置後要刪掉並確認路由回到名冊。驗證作者先換回 argon（qodercn 到 11-21）。
- **Impact**: 不刪的話，過期設定仍然生效，路由會一直繞開 codex 且同 runner 的獨立性被削弱。
- **Trigger**: date:2026-11-16
- **Trigger-Type**: date:2026-11-16
- **Effort**: XS
- **Source**: PM fleet 01M747R1N0 (2026-11-11)
- **Pointer**: project/backlog/BACKLOG.md
- **Context**: 11-16 order (PM 01M74FDC5Z): VA to gemini-4-argon-high@agy until qodercn works, then restore roster-overlay test pins, then delete other override blocks and allow_same_runner_dual_seat; keep qc_panel.

### Lead and lane skills should default to parallel for unrelated work
- **Id**: BL-0427
- **Status**: open
- **Since**: 2026-11-11
- **Origin**: self
- **Problem**: Operator rule (2026-11-11): unrelated incoming work gets its own worker at once (mechanical work to Haiku, Sonnet or a non-Claude seat); "queued behind X" only for a real dependency or the same scarce resource. The shipped lead and lane skills do not state this, so sessions queue serially.
- **Impact**: Unrelated items wait behind the one in hand and the lead does mechanical work itself.
- **Trigger**: ready; needs eval ON/OFF evidence before the wording ships (skills/CLAUDE.md)
- **Trigger-Type**: ready
- **Effort**: M
- **Source**: PM 01M74K28MQ (2026-11-11)
- **Pointer**: project/backlog/parallel-by-default-for-leads.md

### Two suites red on clean develop: skill-onoff-d0gate-cc and qualification-consult-discuss-transport
- **Id**: BL-0428
- **Status**: open
- **Since**: 2026-11-11
- **Origin**: self
- **Problem**: On develop 2baff5f99 (before the stack4 merge) both fail when run alone: hooks/tests/skill-onoff-d0gate-cc.test.sh ("FAIL: kept G4 evidence", projects-files.json shape []) and scripts/qualification-consult-discuss-transport.test.js ("consult: end-to-end broker -> sandbox -> socket -> real provider.js succeeds", actual failed). Root cause not looked at yet.
- **Impact**: Two more entries in the baseline red list that every merge has to diff against; a real regression in either suite would hide behind them.
- **Trigger**: ready
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: stack4 merge 66fc4f426 (2026-11-11)

### A test suite writes fake MiniMax rows into the real dispatch usage ledger
- **Id**: BL-0429
- **Status**: open
- **Since**: 2026-11-11
- **Origin**: self
- **Problem**: /run/user/1001/autopilot/dispatch-usage-202611.jsonl on aimax395 (team) holds 48 rows for runner cc-shim / MiniMax-M3 / account minimax in the week to 2026-11-11, in groups of four (2 running, 1 reviewed, 1 no_verdict) with usage none, wall_secs null, no run manifest, at the times full or affected suites ran. They look like dispatch-review fixture runs whose usage ledger is not redirected to a temp dir.
- **Impact**: The ledger is the primary data for quota and cost views; fake rows make MiniMax use look real (found while cross-checking the first quota-provider-sync probe, PM 01M75H3XZ0) and inflate counts on every suite run.
- **Trigger**: ready
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: qps401 probe check (2026-11-11)
