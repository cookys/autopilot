---
name: handoff
description: >
  Write a standardized mid-work handoff doc for session continuation, and resume from one.
  Triggers: "寫 handoff", "寫 handover", "ctx 太滿", "context 快滿", "clear session 後繼續",
  "write a handoff", "hand off to the next session", "接手上個 session", "resume from handoff".
  Not-for: end-of-project closing (→ finish-flow), machine snapshot on /clear (→ the session-handoff
  hook, enable via ~/.autopilot/config.json handoff_inject), compaction recovery (→ state-checkpoint hook).
---

# handoff

Mid-work session continuation handoff.

## Write Mode

Triggered by "寫 handoff", "寫 handover", "ctx 太滿", "context 快滿", "clear session 後繼續", "write a handoff", or "hand off to the next session".

1. **Collect State Mechanically**:
   Run commands to collect context:
   ```bash
   git branch --show-current
   git log --oneline -5
   git status --porcelain | head -20
   git stash list | head -3
   ls docs/projects/ | grep -v _archive | head
   # Also check open task list if the harness shows one
   ```

2. **Determine Handoff Path**:
   - Active project: `docs/projects/<project>/HANDOFF.md`
   - No project structure: `docs/HANDOFF.md`
   - Repo not writable or no repo: `~/.autopilot/handoff-manual/<repo-or-cwd-name>.md`

3. **Generate Document**:
   If `HANDOFF.md` already exists, REPLACE it (a handoff is a snapshot, not a log) and note the replacement in the reply. Write verbatim:

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
   - [Gotchas discovered this session that would burn the next session]
   ```

4. **Response to User**:
   Reply with the file path, the paste-ready line: `read <path> 接續`, and a reminder that the machine-snapshot hook complement exists (`handoff_inject`, see hooks/README.md) if they want auto-capture on `/clear`.

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
5. When the work later completes, delete the consumed `HANDOFF.md` file as part of closing (finish-flow's session-end hygiene).

## Proactive Offer Rule

When context pressure signals occur (a compaction just happened; or the conversation is long and the user hints at wrapping/切換), OFFER a handoff in one sentence: "需要我寫 handoff 檔案以便 clear session 後繼續嗎？" (The user should never have to ask "需要寫 handoff 嗎?" themselves).
