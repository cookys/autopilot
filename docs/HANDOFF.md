## 目標

無進行中工作。這份 handoff 記錄的是一個**收束完成**的狀態：四個 peer 交接的請求批次（v2.35.6–v2.35.10）全部出貨並 push，記下的是「下一個 session 需要知道但不在 code 裡」的東西。

## 現況

- **branch**: `develop`，與 `origin/develop` 同步在 `87b70483`
- **working tree**: 乾淨（`git status --porcelain` 空）
- **version**: 2.35.10
- **測試**: 全套件 308/308（最後一次跑在 `b7e7ef95` 之後）

**DONE**（皆已 merge 進 develop 並 push）：

| 版本 | commit | 內容 |
|---|---|---|
| v2.35.6 | `f4b9246b` | 死人開關——禁止把 task-notification 當唯一喚醒路徑 |
| v2.35.7 | `fa9b4a64` | agy 三修 + watcher 改看磁碟事實 |
| v2.35.8 | `0c5f177a` | plan-review seat transport fallback（機制完整；cursor admission 因 containment 實測擋住未加） |
| v2.35.9 | `28bc2c78` | effort 進 seat、考試身分 vs 環境、feed adopt、測試污染 guard |
| v2.35.10 | `b7e7ef95`（見下方陷阱） | feed digest 回報措辭 + 終端機注入修復 |

**IN-FLIGHT**: 無。沒有背景派工、沒有等待中的 review、沒有停放的 peer 請求。

## 已決事項(不重議)

- **cursor 不會拿到 reviewer-class admission** — `qualification-review-provider.js` 對 cursor 無條件拒絕，依據是 2026-08-29 的 18 項對抗性實測（對象正是本機安裝的 `2026.08.25-3e8eec8`）。要翻案必須 cursor-agent 先出真正的 catch-all deny 或撐得過 `--force` 的 sandbox，然後 18 項全部重跑。**不要因為「機制做好了很可惜」就重新爭論。**
- **legacy strike 不回填 effort** — 那些 strike 記錄於「座位＝三欄」的世界，事後指派 effort 是在補一個當初不存在的判斷。留在 legacy 分區才誠實。7840hs 已照此在 UI 標註。
- **effort 只在存在時進 seat hash** — 這個條件是承重的，不是整潔：缺席時位元組等同舊的三鍵物件，所有已記錄的 `seat_hash` 保持有效。**不要「順手統一」成無條件加入。**
- **feed 的 strike 只回報、不採納** — plan §3 凍結的範圍決定，本地撤銷仍由 seat-status／strikes 負責。QC 曾把這報成 MUST-FIX，被駁回。
- **calendar 永不擋人** — expiry 一律 advisory，撤銷靠 strike／model_version 變更／corpus-prompt 契約變更。

## 下一步

沒有被指派的下一步。若要接續，這三件是已知、已評估、未動工的：

1. **`~/.autopilot/engine-capability/qualification-evidence.jsonl` 還有 2 列可疑 fixture**：identity 是 `e|r|f|0|consult`，看起來也是測試殘留，但**不符合**我清理 356 列時證明過的判準（那是另一支測試留下的）。要清必須先查出來源。備份在 `scratchpad/qualification-evidence.backup-1788358021.jsonl`（清理前的 404 列）。
2. **`ladder --role implementer` 回 `[]`**：scorecard 完全沒被動過（sha 全程未變），所以與清理無關。若預期它該有輸出，是獨立的一件事。
3. **BACKLOG 有一筆 🔵 suite oracle lock 訊息清晰度**：拒絕訊息印的是 `.owner` sidecar 裡的 pid，那個 pid 會比行程活得久，所以「正常競爭」和「stale lock」長得一模一樣。鎖本身是 flock、死了會放，是訊息問題不是正確性問題。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain              # 應為空
git log --oneline -1                # 87b70483
node -p "require('./.claude-plugin/plugin.json').version"   # 2.35.10
bash scripts/preflight-release.sh   # ✅ 8/8 for v2.35.10
bash hooks/tests/run.sh --parallel  # ✅ ALL TESTS PASSED (308 test files)
```

跑完 suite 後，四個真 store 檔的 sha256 應與跑之前相同（`run.sh` 現在自己會檢查並在變動時讓 suite 紅）。

## Read-order

1. `/home/cookys/projects/autopilot/CHANGELOG.md` — v2.35.6 到 v2.35.10 五個小節。每一節都寫了 QC panel 抓到什麼、哪些成立哪些被駁回，以及植入負控制的結果。這是理解這批工作最快的路。
2. `/home/cookys/projects/autopilot/docs/projects/2026-09-02-qualification-feed-adopt/README.md` — 尤其「What the work turned up that the plan did not predict」一節。
3. `/home/cookys/projects/autopilot/docs/plans/2026-09-02-cursor-transport-fallback.md` — §3.5 記錄 Phase 5 為什麼擋住，含 18 項實測的引用。要重啟 cursor 這條線必須先讀它。
4. `/home/cookys/projects/autopilot/references/evidence-discipline.md` — 這次新增的兩個教訓已進 repo（見下）。

## 陷阱

- **`git log` 裡有兩個同名的 v2.35.10 release commit**（`1b9039da` 然後 `b7e7ef95`）。不是重複出貨：`1b9039da` 是尚未含 QC 修復與 trailer 的版本，`b7e7ef95` 補上了終端機注入修復並帶 `QC-Verdict`。成因是我把 `git push … | tail` 放進 `&&` 鏈——**pipeline 的 exit status 是 `tail` 的**，所以 push 失敗了後面照樣執行，接著的 `--amend` 就改到了錯的 commit。已 push 到共用分支，不會重寫歷史。下次：管線化的 `git push` 不要接 `&&`。
- **`git stash list` 有 `stash@{0}`（evidence-discipline §20/§21）是別的 session 的**，不是這批工作的。不要 pop、不要清。
- **送審的 diff 不要再過濾 `':!platforms/codex'`** — 同一個過濾器已經讓兩個不同的審查者各報一次假陽性「codex mirror 沒同步」。審查者看不到鏡像就會假設它沒動。
- **`git checkout <file>` 會連你剛寫好的東西一起還原** — 清理植入負控制時我用它，結果把同一檔案裡剛加的功能一起洗掉，測試才抓出來。用 `cp` 從備份還原，不要用 `git checkout`。
- **GLM 席常回 `no_verdict`**（`NO-FINDING-PROOF must contain non-empty checked, evidence, and conclusion fields`）。那是儀器格式問題不是判決，要換一席重跑，不要當成「沒有發現」。

## 已路由出去的耐久內容

以下不隨這份 handoff 消滅，已經進了常態儲存：

- **`references/evidence-discipline.md`** —— 兩條都是**擴充既有小節**而非新開一節（dedup 後發現同一族已經
  有人記過，只是我的案例是更尖的變體）：
  - **§1** 加上「旗標被**接受**不等於被**接進 payload**」：我 grep 到 `effort: options.effort` 存在就當成
    接好了，但那兩個 hit 在**別的** handler。§1 原本的 check 就是「grep callers」，所以這是那條 check 的
    偽陽性模式，補在它旁邊。
  - **§3** 加上「同一個套套邏輯裝得進單一斷言」：我驗「digest 是 64 hex」+「cache 目錄叫這個名字」，
    兩條都從被測答案自己讀回來，改用生產端的 digest 照樣通過。
- **`memory/git-push-pipeline-amend-trap.md`**（新）—— 管線吃掉 push 失敗、`&&` 照跑、amend 改到錯的
  commit。已加進 `MEMORY.md` 索引。
- **`memory/dispatch-review-runner-setup.md`**（更新，非新開）—— 加兩段：`NO-FINDING-PROOF` 格式錯是
  **儀器故障不是「沒有發現」**（同席重跑常再犯，換席比較快）；送審 diff 不要過濾 `':!platforms/codex'`
  （兩個不同審查者各因此報了一次假陽性）。
