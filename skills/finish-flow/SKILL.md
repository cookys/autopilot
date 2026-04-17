---
name: finish-flow
description: >
  Closing sequence forcing function — use at the END of any dev-flow workflow (L, H, Fix, S) to
  guarantee no step in the closing sequence gets silently compressed or skipped. On invocation,
  creates size-appropriate sub-tasks via TaskCreate so each step is individually trackable.
  MANDATORY for L-size (invoked at L-5) and H-size (invoked at step 9); optional for Fix/S.
  Use when: finishing L-size project, closing hotfix, "time to merge", "wrap this up",
  "跑完收尾", "收掉這個專案", "L-5 開始". Not for: mid-phase work, starting new work
  (→ dev-flow), writing plans (→ writing-plans).
---

# finish-flow — Closing Sequence Forcing Function

**Purpose**: Dev-flow's closing sequences (L-5, H step 9, Fix wrap-up, S session-end) are
multi-step and easy to compress mentally into "one thing to do". This skill guarantees each
step becomes an independent, verifiable `TaskCreate` item that system-reminder surfaces until
it's individually completed.

**Why this exists**: On 2026-03-17 and 2026-04-11, the same L-5 completion sequence was
silently skipped twice — despite the dev-flow SKILL.md being patched with bolder markdown and
anti-patterns. Passive text cannot force behavior. Active TaskCreate reminders can.

## Project Config (auto-injected)
!`cat .claude/finish-flow-config.md 2>/dev/null || true`

## Entry Protocol (MANDATORY)

Before doing anything else:

```
1. Identify the current workflow size from the active project / branch:
   - Look at TaskList for phase task prefix (P0/P1/... ⇒ L-size)
   - Check branch name: fix/* ⇒ Fix, hotfix/* ⇒ H, otherwise infer
   - If unclear, ASK the user (or CEO evaluates within DOA)

2. Look up the size in the size → sub-tasks table below.

3. TaskCreate every sub-task listed for that size, in order.
   - Each sub-task must have the listed subject AND description
     (not abbreviated — copy the verification output clause verbatim).

4. Mark the parent closing task (L-5 / H-9 / etc.) as in_progress.

5. Begin working through the sub-tasks in order, marking each completed
   as its verification output is produced.
```

**Do not combine**. Each sub-task must be its own `TaskCreate` call and its own `TaskUpdate
status=completed` call. Combining steps into one tool call defeats the forcing function.

## Size → Sub-tasks

### L-size — `L-5` Completion (6 sub-tasks)

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| L-5.1 | Final Goal Review | Open the project README. For each success criterion, show (a) the criterion text and (b) the concrete evidence (command output, file contents, or diff) proving it's met. Output: pass/fail list, zero unverified. |
| L-5.2 | Pre-Merge Review (max 3 rounds) | Invoke `autopilot:quality-pipeline` (project config will select per-size flags). Up to 3 fix-review rounds allowed. Output: final review result = zero blocking issues. |
| L-5.3 | Merge to develop (or main per project convention) | `git checkout develop && git merge --no-ff <feature-branch>`. Verify merge commit landed. Output: `git log -1 --format="%H %s"` showing merge commit. |
| L-5.4 | Post-Merge Review | Re-read critical files that were changed (pick 1–3 highest-risk) to verify merge didn't silently drop changes. Output: grep/diff confirming each expected change is present on develop. |
| L-5.5 | Archive project | Move `doc/projects/<project>/` → `doc/projects/_archive/<project>/`. Update `doc/projects/INDEX.md` (remove from 進行中, add to 已完成 with date). Output: `ls doc/projects/_archive/<project>/` showing the moved directory. |
| L-5.6 | L Session End (full checklist) | Run the dev-flow "Session End L-Full" checklist (verify completion, update project docs, knowledge extraction via `autopilot:learn` if warranted, deferred items to BACKLOG, triggered BACKLOG pickup, staging verify). Output: pass/fail summary for each gate. |

After all 6 completed → mark the parent L-5 task (from L-1) completed.

### H-size — Hotfix Closing (6 sub-tasks)

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| H-9.1 | Verify fix addresses the incident | State the root cause in one sentence and point to the specific code change that addresses it. Output: root cause + file:line of the fix. |
| H-9.2 | Quality gate | Invoke `autopilot:quality-pipeline`. Output: zero test failures, zero blocking review findings. |
| H-9.3 | Merge to main (--no-ff) | `git checkout main && git merge --no-ff hotfix/<name>`. Output: merge commit hash. |
| H-9.4 | Post-incident learn (MANDATORY) | Invoke `autopilot:learn`. Record: incident, root cause, detection method, fix, prevention. Output: knowledge entry path. |
| H-9.5 | Delete hotfix branch | `git branch -d hotfix/<name>` (or remote cleanup if pushed). Output: `git branch` confirming deletion. |
| H-9.6 | Session end | Verify completion, staging reflects the hotfix, any follow-ups recorded in BACKLOG. Output: pass/fail summary. |

### Fix-size — Bug Fix Wrap-up (5 sub-tasks)

> **Optional** — Fix workflow may invoke finish-flow for rigor, but is not forced to.

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| F.1 | Quality gate | Invoke `autopilot:quality-pipeline --size S`. Output: zero failures. |
| F.2 | Commit with detailed message | Commit must state root cause + what was wrong + how it's fixed. Output: `git log -1 --format=%B` showing all three. |
| F.3 | Ongoing-maintenance entry | Append one line to `doc/projects/ongoing-maintenance/YYYY-MM.md`: `| MM-DD | commit_hash | fix(area): 根因 → 修法 |`. Output: `tail -1` of that file. |
| F.4 | Merge to develop | `git checkout develop && git merge --no-ff fix/<name>`. Output: merge commit hash. |
| F.5 | Delete fix branch | `git branch -d fix/<name>`. Output: `git branch` confirming deletion. |

### S-size — S-Lite Session End (3 sub-tasks)

> **Optional** — S workflow may invoke finish-flow for rigor, but is not forced to.

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| S.1 | Retry check | Did I retry any non-trivial operation 2+ times? If yes → invoke `autopilot:learn`. Output: yes/no, and if yes, knowledge entry path. |
| S.2 | Deferred items | Anything postponed → append to `doc/BACKLOG.md` with context + trigger condition. Output: `tail` of BACKLOG showing the new entry (or "none" if none). |
| S.3 | Confirm commit on correct branch | `git log -1 --format="%H %s"` on the expected branch. Output: commit hash + branch name. |

## Enforcement Rules

1. **Parent task exists from workflow start**: For L and H, `dev-flow` MUST have created a
   parent closing task (`L-5: Invoke autopilot:finish-flow` / `H-9: Invoke autopilot:finish-flow`)
   during L-1 / H-1. If that task is missing, the CEO has failed the L-1/H-1 gate —
   STOP and create it retroactively before continuing.

2. **Sub-tasks are discrete**: Each sub-task above is its own TaskCreate call. Do not batch
   "L-5.1 through L-5.3" into one call; the forcing function relies on each being individually
   surfaced by system-reminder.

3. **Verification output is concrete**: Every sub-task description specifies exactly what
   output proves the step is done. Saying "I did it" is NOT acceptable — paste the actual
   output or file path.

4. **Sequential completion**: For L-size, the order matters — Merge cannot precede Pre-Merge
   Review; Archive cannot precede Merge; Session End is always last. Do not mark sub-tasks
   completed out of order.

5. **CEO mode**: All finish-flow sub-tasks are within CEO DOA (tactical, reversible, local).
   CEO does NOT pause to ask the user between sub-tasks. Execute all, then report in the
   CEO Final Report.

## Anti-patterns

| Wrong | Right |
|-------|-------|
| Compress L-5 into a single "finish up" TaskCreate | Each sub-task is its own TaskCreate |
| Merge before Pre-Merge Review | Order matters — pre-merge gates first |
| Archive before Merge | Archive is L-5.5, Merge is L-5.3 — never reverse |
| Skip `autopilot:learn` because "nothing to learn" | For H, learn is MANDATORY post-incident; for L, evaluate the 5 trigger questions and skip only if all are "no" |
| Finish flow without the parent task existing | dev-flow L-1/H-1 must create the parent; if missing, stop and fix it retroactively |
| Mark parent L-5 completed while sub-tasks still pending | Parent only completes after all sub-tasks reach completed |
| "I know what I need to do, skip the TaskCreates" | The forcing function is the TaskCreates themselves — there is no shortcut |

## Relationship to Other Skills

- **dev-flow**: Opens the workflow (L-1 / H-1). Creates phase tasks + parent closing task.
- **finish-flow** (this skill): Closes the workflow. Expands the parent closing task into
  discrete sub-tasks.
- **quality-pipeline**: Invoked from within finish-flow sub-tasks L-5.2 / H-9.2 / F.1.
- **learn**: Invoked from within H-9.4 (mandatory) and optionally from L-5.6 / S.1.
- **project-lifecycle**: Referenced from L-5.5 (archive procedure).
- **ceo-agent**: CEO mode invokes finish-flow at the natural end of a workflow. All sub-tasks
  are within CEO DOA; no Board escalation unless a sub-task reveals a goal miss or irreversible
  surprise.

## Exit Condition

This skill is "done" when:

1. All size-appropriate sub-tasks have status `completed`.
2. The parent closing task (from dev-flow) is marked completed.
3. A final summary is output: which sub-tasks ran, what evidence each produced.

Only then may the session move on to the next task or end.
