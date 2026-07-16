<!-- last-verified: 2026-07-16 -->
# Debug Patterns

## Silent-retry 假死：Claude CLI × z.ai 確定性 529
**Date**: 2026-07-16 | **Context**: C1 verification-author 連續失敗（529 ×2、exit-124 零位元組 ×2），五家族 15+ 次 author 全滅
**Problem**: z.ai 閘道對「Claude CLI 形狀」的請求（`POST /v1/messages?beta=true` + claude-code beta 標頭組合）回**確定性 HTTP 529**（~500ms 快速拒絕，非真過載）；CLI 收 529 靜默指數退避無限重試 → 外層 timeout SIGKILL → 表象是「exit 124 + 空 log」，與「模型慢」不可分辨。endpoint tiny-test（直接 HTTP、無 CLI 標頭）全程 200，完全誤導。
**Solution**: 分層診斷四步——(1) 同傳輸 tiny prompt（排除任務規模）；(2) 同 token 直接 curl（切模型層 vs 傳輸層）；(3) 同調用形狀打另一端點（切 CLI 整體 vs 端點互動）；(4) **~40 行 Node logging reverse proxy 夾在 CLI 與端點間**看 REQ/RESP 狀態碼與重試時序——十分鐘定位。修法：`anthropic-compatible` direct-HTTP author runner（`dispatch-anthropic-review.js --raw` + `--max-tokens 30000`），繞過 CLI。
**Failed attempts**: 調大 timeout（300s→540s 照死）；輪替五個模型家族（Grok/Gemini/Opus/Sonnet/MiniMax 各有各的死法，全是誤導）；信 endpoint tiny-test 當 readiness。
**Related**: readiness 探針鐵律——必須**同傳輸、同 payload 級別**；連續 exit-124 零輸出時先切傳輸層再燒 attempt。

## Git worktree 共享 .git/config：worker 裸 `git config` 寫穿主 clone 身分
**Date**: 2026-07-16 | **Context**: C4a r3 dispatch worker 在 worktree 根照抄 oracle fixture 跑了 `git config user.name "Test Bot"`；此後主 clone 28 個 commits（含 push 到 origin/develop 的 merge）作者全變 `Test Bot <bot@test.local>`，直到另一條 session 發現
**Problem**: `git worktree` 的 local config 預設**共用主 repo 的 `.git/config`**（除非啟用 `extensions.worktreeConfig`）。在 worktree 裡執行裸 `git config user.name X` 等同直接改主 clone 身分——隔離 worktree 擋得住檔案寫入，擋不住 config 寫穿。事故鏈：oracle fixture 用裸 `git config`（教壞 worker）→ worker 在 worktree 根實驗 → 寫穿 → 主 clone 之後所有 commit 換人。
**Solution**: 立即：`git config user.name/user.email` 修回真實身分（歷史不重寫）。系統性（BACKLOG）：(a) dispatch-hetero/author 在 run 前快照主 repo 的 `user.name`/`user.email`，teardown 比對，變動 → 修回 + 大聲警告（containment 類防線）；(b) oracle fixture 一律 `git -C "$MINI_REPO" config` 或 subshell `-c user.name=... -c user.email=...` inline，絕不裸寫；(c) worker prompt 紀律已含「不得在 worktree 根建 fixture repo / 跑 git init/config」。
**Related**: wrapper commit 已用 `-c` inline identity（不受污染影響）；worker 自行 commit 的路徑才中招。commit 前 identity 校驗可考慮進 pre-commit（`autopilot-distill-skills:git-identity` 的機械化版）。
