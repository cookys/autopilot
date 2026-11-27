# autopilot — project conventions (Claude Code)

## Goal

- End goal: 3.0.0 這條線（開發中版號 3.0.0-alpha.N 遞增；3.0.0 正式版即操作員說的「3.0.0.0 大版」）：開發 repo 照 10/31 定稿完整重排，再用白名單匯出成新的 public repo 發佈，開發 repo 轉為私有。同一條線上加入「角色套件」，讓弱模型也能做出好結果；評測證明有效之後，才改成預設。
- Current milestone: 完成重排 P2–P5 和匯出工具；角色套件先做小規模試驗（pilot），由 PM 判定是否過門檻。backlog 從 146 條整理到約 82 條。
- Not goals now: 升版到 3.1；hosted CI；改名、轉私有、建 public repo（這三件要 operator 本人動手）。
- Source: 出處：10/31 定稿 addendum C；operator 11/5 說的「盤點完，全部 refactor」、角色套件的方向，d-c76529c3「做，撥額度」，以及 11/5 版號規則（3.0.0.0 大版、開發中 alpha 遞增）。；操作員 d-fb9989dc 定案（2026-11-05）

## This repo is yours

This repo is yours and you are its long-term maintainer. When you see something broken, stale, duplicated or untested, fix it within your grant without waiting to be assigned; what you cannot fix goes into the backlog with its impact stated. Do not leave problems for "whoever comes later".

## Within your grant, stop only at acceptance

Work inside your grant stops only at acceptance: a real user has walked the core path on the real build, with one line of evidence (screenshot, command or URL). Green tests, a passing review and a push are intermediate steps. Stop midway only for a tier-2 destructive op, something outside your grant, or a Goal/milestone change; when you stop, say so once with options and a recommendation.

Acceptance also requires the change to be merged, live pinned to that SHA, and evidence of real use. For a gate-type change, perform one reverse probe on live: deliberately violate the gate and confirm it blocks the violation.

## How we work
- 工作狀態只記在 fleet task。開工、卡住、改期、交件都寫回單上，不用聊天代替。
- 可開工的同時開工。實作交便宜席（sonnet、codex terra、grok；機械單交 kimi），每條用一個 worktree。本席判斷、審查和整合；做完立刻審。
- XS 修正（單檔、約 20 行內、含測試）由本席直接改並在 fleet 單記一行，不派外部引擎；同一件事失敗兩次就換方法或換引擎。
- 隨時至少保留兩件可以直接開工的工作。手上這件卡住或做完時，下一件要已經準備好（預檢已通過）。
- 要 go 的時候，同一時間把下一件準備好，不要空等。內部換版的 go 跟 PM 要，先跑 canary，再全面換。
- KR 和觀察期只量測，不擋上線。計畫要寫上上線日和 fleet 單號，不能一放好幾週。
- 卡住時只回報一次，附上建議，回報對象是 PM 或你的 lead。在等別人時，寫上帶型別的 waiting_on（等哪張單、哪張卡、哪個人的哪則訊息）。

## Worktree and branch hygiene
- **先確認分支再動手**：每次開始編輯前，以及恢復 session 或切換情境之後，先跑 `git status` 和 `git branch --show-current`，確認自己在對的分支和對的 worktree。
- **一件工作一條分支一個 worktree**：分支命名用 `feat/<slug>` 或 `fix/<slug>`，從最新的 develop（或本 repo 的主幹）開出來。hetero worktree 放在 `<repo>/.claude/worktrees/`，由 repo 的 hetero rail script 建立、由 `scripts/reap-dispatch-worktrees.sh` 清理。主 checkout 只用來整合，不在上面直接開發。同時只留 1～2 個，換單用 `git switch` 重用。
- **平行 worktree 不共用相依目錄**：每個 worktree 各有自己的 node_modules、venv、build 輸出，不用 symlink。
- **commit 要帶 trailer**：每個 commit 都加上 `Fleet-Task: <26 碼單號>`。不在 develop 或 main 上直接 commit 功能改動。
- **合併方式**：用 `git merge --no-ff` 合進 develop，合併訊息寫上審查結論和 tip 測試綠燈。main 只在 PM 給 go 後合併。共用分支一律禁止 force-push 和改寫歷史。
- **合併後當場清乾淨**（這屬於 tier 0）：刪掉本地和遠端分支（`git branch -d`、`git push origin --delete`），並 `git worktree remove` 掉對應的 worktree。最後跑一次 `git worktree prune`。
- **不留孤兒**：
  - 超過 3 天沒有 commit、又沒有對應活單的分支或 worktree，要嘛開單接著做，要嘛刪掉。
  - 沒有合併過的工作在刪除前，先推到遠端或打個 tag（`archive/<branch>`），這樣才算 tier 1。
- **不把 stash 當倉庫**：一輪結束時如果還有未提交的工作，就在分支上提交一個 WIP commit，不要留在 stash 裡。
- **live 只跑 pin 住的 sha 或 tag**，不跑分支的最新 commit。換版走既有的換版流程：每台主機先備份並記下 sha16，寫好回滾指令。
- **測試不碰正式環境**：worktree 和測試一律用沙箱 HOME 或暫存目錄，不能讀寫 live 的設定、狀態或憑證。
- **主 checkout 是 live plugin**：主 checkout 由 hangar pin 住；開發在獨立 clone 進行。

For Claude Code sessions working **on** the autopilot plugin itself. Other agents (Codex, OpenCode, Antigravity): [`AGENTS.md`](AGENTS.md); portability: [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

[Original wording](docs/dev/_archive/entry-docs/claude-md-detail.md). Directory rules load when a session reads or edits a file there: `{scripts,skills,references,platforms,mods}/CLAUDE.md`. A path assembled inside a script does not trigger the load, so every rule that causes damage when missed is also kept below.

## What this repo is

See the [project overview](docs/dev/_archive/entry-docs/claude-md-detail.md#what-this-repo-is).

32 skills, 3 methodology agents, 70 hooks (50 default-on, 20 opt-in).

## Scripts (prefer over LLM judgment)

**Before hand-coding any mechanical step, check `scripts/` first**: group index below, full name list in `scripts/CLAUDE.md`, descriptions in [`docs/scripts-inventory.md`](docs/scripts-inventory.md).

- Every new or modified check (gate, hook, scan) ships a negative control: a deliberately broken case shown red before green ([evidence-discipline §58](references/evidence-discipline.md)).

See the [script guidance](docs/dev/_archive/entry-docs/claude-md-detail.md#script-guidance).

**Group index**: see [`scripts/CLAUDE.md`](scripts/CLAUDE.md) and [original wording](docs/dev/_archive/entry-docs/claude-md-detail.md).

## Skill evolution rules and severity vocabulary

See [`skills/CLAUDE.md`](skills/CLAUDE.md) and the [severity vocabulary](docs/dev/_archive/entry-docs/claude-md-detail.md#severity-vocabulary).

🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion

## Versioning

Bump with `scripts/sync-version.js` only. 3.0.0 final is the operator's "3.0.0.0 major"; during development a bump uses 3.0.0-alpha.N continuing from alpha.7 (never back to alpha.1). Bump table and collision procedure: [`docs/dev/versioning.md`](docs/dev/versioning.md).

## Process rules

- Mission graphs: node `verification_commands` stay fast and fixed, never `bash hooks/tests/run.sh`; the whole suite runs once, alone, before a campaign merges into `develop`; red means no merge. Editing a sealed graph breaks its pinned digest.
- Pre-merge runs `affected-suites.js --fast --run`; the full affected run is `scripts/post-merge-suite.sh` after the merge, and the lane reverts its own merge on a NEW red.
- The merge gate runs `check-phase-review-receipt.js` against the branch tip being merged, never the last reviewed head; any product-code delta after the reviewed head needs its own review, and at the generation cap only a PM ruling plus a post-head ledger passes ([`skills/dev-flow/references/hetero-loops.md`](skills/dev-flow/references/hetero-loops.md)).
- No hosted CI (operator): suites and the merge gate run locally; never add a hosted workflow.
- Never read, print or copy credentials, and give dispatch children a throwaway config dir seeded with only `.credentials.json`, never the real `~/.claude` ([`references/hetero-dispatch.md`](references/hetero-dispatch.md)); destructive ops follow the global Red lines tiers.
- A SHIP-AS-IS reviewed branch merges to `develop` once suites are green, never batched; `check-unmerged-ship.js` flags it after 1 h.
- CN gate follows the endpoint operator: restricted cloud needs a clean brief in a fresh non-repo sandbox; private-repo work is refused, and local names must resolve locally.

## Where context lives

See the [context index](docs/dev/_archive/entry-docs/claude-md-detail.md#where-context-lives).

## Reply preference

See [reply preference](docs/dev/_archive/entry-docs/claude-md-detail.md#reply-preference).

## Don't

- Don't `cat` a file or diff and retype it when the user asks to see it: call the `show` tool (`mcp__autopilot__show`, `path` or `diff`). It displays to the user only and returns one line, so the text never enters context; read the file separately if you need to analyze it.
- Don't hardcode dispatch model/mode in skill files — use `scripts/resolve-dispatch.sh`.
- Don't write "manually check for TODO/FIXME" in a reference doc — call `scripts/completeness-scan.sh`.
- Don't enumerate forbidden phrases inline in code-review logic — call `scripts/check-redispatch-prompt.sh`.
- Don't introduce new severity vocabulary — use the unified 4-tier above.
- Don't add trust machinery (hash chains, event ledgers, witness receipts, attestation, trust roots) — verify by independent re-derivation ([ADR-0001](docs/dev/adr/0001-verification-over-attestation.md)).
- Don't add a second canonical statement of "what the reviewer reads" — code-review.md Invocation § is canonical; reviewer.md Workflow §1 references it.
- Don't append per-release notes to a Scripts-inventory row — `CHANGELOG.md` owns history (`scripts/CLAUDE.md`).
- Don't claim cross-platform env vars or CLI subcommands without verifying ([`references/multi-agent-portability.md`](references/multi-agent-portability.md) § "Corrected — previously mislabelled").
