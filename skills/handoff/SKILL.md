---
name: handoff
description: >
  Write or resume a standardized mid-work handoff doc for session continuation.
  Use when: "寫 handoff", "context 快滿", "resume from handoff".
  Not for: project closing (→ finish-flow), /clear snapshot (→ session-handoff hook), compaction (→ state-checkpoint).
---

# handoff

Mid-work session continuation handoff. handoff 只帶對話殘留，工作狀態看 resume。When context is full, write the handoff as the formal continuation file for resuming after `/clear` (not just a backup); auto-compact is only a safety net.

## Write Mode

Triggered by "寫 handoff", "寫 handover", "ctx 太滿", "context 快滿", "clear session 後繼續", "write a handoff", or "hand off to the next session".

1. **Collect State Mechanically**:
   Run commands to collect context:
   ```bash
   git branch --show-current
   git log --oneline -5
   git status --porcelain | head -20
   git stash list | head -3
   <plugin>/scripts/resolve-project-paths.sh --target "$(git rev-parse --show-toplevel)"
   # then, with the resolved projects_dir (`none` ⇒ skip this line):
   ls <projects_dir> | grep -v _archive | head
   # Also check open task list if the harness shows one
   ```

2. **Determine Handoff Path**:
   - Active project: `<projects_dir>/<project>/HANDOFF.md` — `projects_dir` from step 1's
     `resolve-project-paths.sh`, **not** a literal `docs/`
   - `projects_dir: none`, or no active project under it: the **manual route already
     defined below** — the path `node <plugin>/scripts/resolve-repo-placement.js handoff --route manual` prints. Do not invent a
     doc root; a handoff nobody can find is worse than one outside the repo.
   - A context-budget T2/T3 message names a session handoff path (`$XDG_RUNTIME_DIR/autopilot/handoff/<session_id>.md`):
     write the handoff there (the `context-land-gate` Stop hook looks for it, and blocks stopping until it is newer than the fire).
   - Repo not writable or no repo: the path `node <plugin>/scripts/resolve-repo-placement.js handoff --route manual` prints

2.5. **Sweep the session, not just the document** (do this BEFORE drafting step 3):

   Step 3.5 below walks the document you are about to write. That catches only durable content you
   already thought to put in it — a gotcha hit at turn 40 and never written down reaches neither.
   So sweep the **session** first, using the source list in
   [`references/knowledge-routing.md`](../../references/knowledge-routing.md) §3.1, and route each
   hit per §3 **now**. Then `## 陷阱` cites what you landed (a path, or the memory slug) instead of
   restating it, and step 3.5 becomes a completeness check rather than the sweep itself.

   Resolve the sinks first — **this project's**, which are usually not this plugin's:

   ```bash
   <plugin>/scripts/resolve-knowledge-routing.sh --target "$(git rev-parse --show-toplevel)"
   ```

   A role that comes back `none` means the project does not have that sink. Say so and put the
   content in the handoff; do **not** create the directory the reference doc happens to name.

3. **Generate Document**:
   Draft the following verbatim in a temporary body file, then detect the target repo's store with
   `node <plugin>/scripts/project-record.js --target <repo> where`. For `files` (no store), write
   it directly to the step 2 path: if `HANDOFF.md` already exists, REPLACE it (a handoff is a
   snapshot, not a log) and note the replacement in the reply. For `hippo`, `hippo-problems`, or
   `spool`, write through the store instead:

   ```bash
   node <plugin>/scripts/project-record.js --target <repo> handoff new --title <t> --area handoff --origin manual --body-file <f>
   ```

   Use `--origin project-file` for project handoff files under `project/handoff/`. Keep the
   draft for step 3.5; report the store result, including any spool or problem warning. Do not
   fall back to a direct write when a configured store is degraded.

   ```markdown
   ## 目標
   [One-sentence goal of the interrupted work]

   ## 現況
   [Branch, last commit SHA+subject, dirty files, what is DONE vs IN-FLIGHT]

   ## 已決事項(不重議)
   - [Decision 1] — [One-line rationale]
   - [Decision 2] — [One-line rationale]

   ## 下一步
   1. [CONCRETE command or file edit to start with]
   2. [Subsequent concrete step]

   ## 驗證方式
   [Commands and expected output proving work is done]

   ## Read-order
   1. /absolute/path/to/file1 — [Why to read first]
   2. /absolute/path/to/file2 — [Why to read second]
   3. /absolute/path/to/file3 — [Why to read third]

   ## 陷阱
   - [Gotchas discovered this session that would burn a later reader of this backup]
   ```

   **Completeness & PM 席接續表**:
   - **一般席**: handoff 必須包含「目標」「現況」「下一步」三段且皆非空；「現況」提到的 worktree 都要已 commit（`git status --porcelain` 為空，或每個髒檔都列在「現況」裡）。
   - **PM 席**: 另需「## 接續表」區塊，以下五個鍵全部要在：`operator_thread`、`artifacts`、`pending_rulings`、`subagent_outputs`、`card_notes`（`card_notes` 要含 `executor` 子欄）。值可以寫明確的「無」，不能空白，也不能缺鍵。其中 `pending_rulings` 清空前必須是空的（值必須寫「無」，有待決裁定就不能清空）。
   - **新鮮度**: handoff 的 mtime 要新於最近一筆人類使用者回合，也要新於 `last_restart_at_ms`；過時就先重寫再清空。
   - **接續第一步**: `/clear` 後的新 context 不會注入未回訊息清單，接續第一步要先跑 `fleet recent`（`unseen_only`）。

   PM 席「## 接續表」可照抄範例：
   ```yaml
   ## 接續表
   operator_thread: <串接脈絡或 無>
   artifacts: <產出檔案/路徑或 無>
   pending_rulings: 無（清空前必須是空的）
   subagent_outputs: <子代理回報或 無>
   card_notes:
     executor: <地址或 無>
   ```

3.5. **Route the durable content out** (a handoff is a snapshot and gets deleted — Resume Mode step 5.
   Anything left only in it is scheduled for destruction):

   Walk the document you just drafted **段-by-段** (step 2.5 already swept the session; this pass
   catches what the draft itself surfaced) and ask of each one:

   > **「這條超出本次交接嗎?」**

   A 段 that is only true of this interruption (current branch, in-flight diff, the next command)
   stays in HANDOFF.md and dies with it — correct. A 段 that would still be worth knowing on a
   *different* task is durable content sitting in a temporary file, and must be routed **now**, per
   the destination table in
   [`references/knowledge-routing.md`](../../references/knowledge-routing.md) §3:

   | Durable content | Route to |
   |---|---|
   | A fact or gotcha (typically from `## 陷阱`) | `learn` skill |
   | A reusable multi-step procedure | `distill` skill |
   | A rule that binds future sessions rather than being looked up | the resolved `discipline_target` |
   | A real problem you are deliberately not fixing now | the resolved `backlog_path` — one row per [`references/backlog-entry.md`](../../references/backlog-entry.md); evidence at the pointer |

   Call those skills; **do not implement routing logic here.** Handoff's job is to notice that a 段 is
   durable, not to decide where it lands — that decision is the routing doc's, and the write contract
   (including `.claude/knowledge/`'s `git add -f` promotion) is `learn`'s.

   Report what you routed in step 4 so the user can see what outlived the handoff.

4. **Response to User**:
   Reply with the file path, and a reminder that the machine snapshot (`handoff_inject`, see hooks/README.md) is a backup. For the PM seat (or when no fleet seat is resolved), include the paste-ready line: `read <path> 接續`. For non-PM fleet seats, do **not** relay a restart line to the operator — `context-land-gate` dispatches the restart task to hangar automatically. Use this handoff to resume after `/clear`; auto-compact is only a safety net.

## Resume Mode

Triggered by "read ...HANDOFF.md 接續" or "接手上個 session" or "resume from handoff".

1. Read the handoff file.
2. Verify state against reality:
   ```bash
   git log -1
   git status
   ```
   If reality has drifted from "現況", report the drift to the user first before proceeding.
3. Treat `已決事項(不重議)` as settled; do not reopen or litigate them.
4. Execute `下一步` item 1 immediately; do not re-plan unless verification fails.
5. When the work later completes, delete the consumed `HANDOFF.md` file as part of session-end cleanup (a handoff is a snapshot; a stale one misleads a later reader). Deletion is only safe because Write Mode step 3.5 already routed the durable 段 out; if this handoff predates that step, run 3.5's walk over it **before** deleting.

## Proactive Offer Rule

When context pressure signals occur (a compaction just happened; or the conversation is long and the user hints at wrapping/切換), write the handoff as the formal continuation file for resuming after `/clear` (auto-compact is only a safety net). OFFER in one sentence: "需要我寫 handoff 檔案嗎？寫完可 /clear 接續。" (The user should never have to ask "需要寫 handoff 嗎?" themselves).
