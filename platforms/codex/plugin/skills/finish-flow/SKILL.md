---
name: finish-flow
description: >
  Closing sequence forcing function — use at the END of any dev-flow workflow (L, H, Fix, S) to
  guarantee no step in the closing sequence gets silently compressed or skipped. On invocation,
  creates size-appropriate sub-tasks via TaskCreate so each step is individually trackable.
  MANDATORY for L-size (invoked at L-5) and H-size (invoked at step 9); optional for Fix/S.
  Use when: finishing L-size project, closing hotfix, "time to merge", "wrap this up",
  "跑完收尾", "收掉這個專案", "L-5 開始". Not for: mid-phase work, starting new work
  (→ dev-flow), authoring a plan doc (→ references/plan-template.md).
---

<!-- AUTOPILOT_CODEX_LIFECYCLE_ADAPTER_V1 -->

## Codex lifecycle adapter (normative override)

This section overrides any later host-specific lifecycle or dispatch spelling in the canonical skill
body. Resolve `<plugin-root>` as the installed Autopilot plugin directory that contains this skill.

Before any write, branch, worktree, runner, provider, or model effect, enter through:

```text
node "<plugin-root>/scripts/session-mode.js" set --level <l3|l4|l5|l6> --entry-level <requested-level> --repo-root <git-root>
```

Codex supplies `CODEX_THREAD_ID` to that shell process. `session-mode.js` records the normalized host
thread ID in both the marker filename and `session_id`; do not replace it with a caller-chosen stable
ID. A marker from another Codex thread is not reusable.

Continue only when the emitted marker contains `mission_routing.status: "READY"`, `admitted: true`, and
`would_block: false`. Managed implementation then follows the existing Mission admission, sealed
campaign, and `AUTOPILOT_LEVEL=<level> node
"<plugin-root>/bin/autopilot.js" engine implement-review ...`
route. Repairs attach to and resume that same engine/campaign lineage. A Codex implementer launched
inside that route receives a credentials-only isolated `CODEX_HOME`, never the controller plugin or
configuration.

Codex in this package does not provide `TaskCreate`, `TaskUpdate`, `TaskStop`, native `Agent`, or
`subagent_type`. Do not imitate them with Markdown tickets, inline managed implementation, a new
branch/session, or a replacement graph. If an exact mapping is unavailable, stop with the existing
precondition or abort receipt; do not invent another lifecycle authority.

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
!`cat .claude/dispatch-config.md 2>/dev/null || true`

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

### L-size — `L-5` Completion (7 sub-tasks)

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| L-5.1 | Final Goal Review | Open the project README. For each success criterion, show (a) the criterion text and (b) the concrete evidence (command output, file contents, or diff) proving it's met. Verify EACH row of the dev-flow requirements ledger is DONE or explicitly deferred (named to the user in the report) — a silently dropped accepted requirement is a FAIL. Output: pass/fail list, zero unverified. |
| L-5.2 | Pre-Merge Review (max 3 rounds) | Invoke `autopilot:quality-pipeline` (project config will select per-size flags). Up to 3 fix-review rounds allowed. This is the homogeneous quality-pipeline repair loop; in `/l5` / `/l6` contexts the engine implement-review loop is governed separately by resolver `loop_max_rounds`. _(If the gate's tests are CI-backed and you're on Claude Code, the test step may wait on CI via the `Monitor` tool instead of busy-polling — see quality-pipeline Tests step / [portability §7](../../references/multi-agent-portability.md). Degrades to manual `gh run watch` elsewhere.)_ Output: final review result = zero blocking issues. |
| L-5.3 | Merge to develop (or main per project convention) | For L5/L6, resolve `autopilot_root` with the package-root resolver below, set `task_status_receipt` to a new caller-owned path, then run `node "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id" --json >"$task_status_receipt"` and assert the parsed JSON has `can_merge === true` (for example, `node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(v.can_merge!==true)process.exit(1)' "$task_status_receipt"`). Only after that assertion passes run `git checkout develop && git merge --no-ff <feature-branch>`. The merge commit message MUST carry the qc-evidence trailer `QC-Verdict: PASS (reviewer <id>, <YYYY-MM-DD>)` once L-5.2 passed — the `.githooks/pre-push` **qc-gate** ([`scripts/resolve-qc-gate.sh`](../../scripts/resolve-qc-gate.sh), strength per `.claude/qc-gate-config.md`) refuses to push a protected-path range without it. Same trailer requirement applies to **F.4** and **H-9.3**. Verify merge commit landed. Output: the pre-merge receipt with `can_merge=true`, plus `git log -1 --format="%H %s%n%(trailers:key=QC-Verdict)"` showing merge commit + trailer. |
| L-5.4 | Post-Merge Review | Re-read critical files that were changed (pick 1–3 highest-risk) to verify merge didn't silently drop changes. **Doc-sync (conditional)**: if the change touched user-facing behavior or 3+ modules, invoke `autopilot:doc-sync` in scoped mode (base = the merge-base) to confirm docs still match the merged code; OFFER full mode for large/user-facing ships. Triage confirmed findings per doc-sync's fix policy (user docs → reality; specs → STALE-fix or mark NOT-YET-IMPLEMENTED + BACKLOG). Output: grep/diff confirming each expected change is present on develop + doc-sync drift summary (or "doc-sync skipped: no user-facing/3+ module change"). |
| L-5.5 | Archive project | Move `docs/projects/<project>/` → `docs/projects/_archive/<project>/` (or the project-configured projects path). Update `docs/projects/INDEX.md` (remove from 進行中, add to 已完成 with date). If `.claude/mission-routing-config.json` points inside the moved directory, update `graph_path` to the archived path in the same change and require `mission-routing-admission.test.sh` plus `session-mode.test.sh` to pass after the move. **Stale-qualifier guard**: `grep -E '^\|' docs/projects/INDEX.md \| grep -Ei '\((pending\|target\|in progress\|WIP\|TBD\|draft)\)'` MUST be empty (scan **table rows only** — the `^\|` prefilter excludes section headers like `## 進行中 (In Progress)` which would otherwise false-positive under `-i`; `-i` then catches lowercase `(wip)` in a row); on hit, emit matched lines + halt. **Release-hygiene gate** (if this ship bumped the version): run `scripts/preflight-release.sh` — verifies CHANGELOG entry + INDEX row + version mirrors are consistent with canonical `.claude-plugin/plugin.json`; must exit 0. Output: `ls docs/projects/_archive/<project>/` + grep guard pass-confirmation + preflight-release pass line. |
| L-5.6 | L Session End (full checklist) | Run the dev-flow "Session End L-Full" checklist (verify completion, update project docs, knowledge extraction via autopilot:learn if warranted, episodic-distill evaluation (did this project produce a transferable methodology or a rework-tempered procedure? yes → suggest `autopilot:distill` episodic mode — learn records lesson-FACTS, distill produces executable PROCEDURES), deferred items to BACKLOG, triggered BACKLOG pickup, staging verify, escalation events exist for every triggered quality-floor emission point (or none fired), **four-surface sweep (skill/doc/memory/knowledge)** — for EACH of the four surfaces output either "updated: <what>" or "not needed: <reason>"; the user must never have to ask 該補的都處理了嗎). **Dispatch-branch gate**: derive `integration_target` from project config; otherwise resolve the `origin/HEAD` symbolic ref and normalize only `refs/remotes/origin/<name>` or `origin/<name>` to the local `<name>`; if `origin/HEAD` is unavailable, use the unique local `develop`/`main`. In every case require `refs/heads/<name>` to exist (ambiguity, malformed remote target, or missing local ref ⇒ halt). Assign `autopilot_root` from the package-root resolver below and halt on nonzero. When `CLAUDE_PLUGIN_ROOT` or `PLUGIN_ROOT` is set, call `autopilot_root="$(resolve_finish_flow_package_root)"`; otherwise set `active_finish_flow_skill` to the one exact absolute active `finish-flow/SKILL.md` path shown by the harness catalog and call `autopilot_root="$(resolve_finish_flow_package_root "$active_finish_flow_skill")"`. Never substitute the consumer git root or a newest-cache search. Then run `bash "$autopilot_root/scripts/reap-dispatch-branches.sh" check --repo "$(git rev-parse --show-toplevel)" --into "$integration_target"`. Exit 1 blocks clean exit until every ahead candidate is integrated or preserved with exact-tip `--ack` + handoff rationale. Deliberate discard is manual human/depth-0 action only after verified preservation; the reaper never deletes an uncontained branch. Re-run until exit 0. **LSM status gates (L5/L6 only)**: after merge and again immediately before marker clear, run `node "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id" --json >"$task_status_receipt"`; preserve the final JSON receipt. Report `product_merged`, `consumer_updated`, `pushed`, and `zero_residue` independently. Never say “merged and clean” unless `can_close=true`. **Session-mode marker**: L5/L6 must run `node "$autopilot_root/scripts/session-mode.js" clear --task-status-receipt "$task_status_receipt" --root-run-id "$root_run_id"`; the command fails closed unless the fresh digest-valid receipt has the same root and `can_close=true`. L4 keeps `node "$autopilot_root/scripts/session-mode.js" clear`. S/Fix/H workflows retain their existing closing behavior. Output: pass/fail summary for each gate and four-surface per-surface lines. |
| L-5.7 | Delete merged branch (local + remote) | The ship is merged + archived — delete the feature branch so it doesn't accumulate. **This step exists because L-5 historically had no branch-cleanup sub-task** (unlike `F.5`/`H-9.5`), so every L-ship left its `feat/*` branch behind (local AND on `origin`). Verify it's merged first (`git branch --merged develop` lists it), then: `git branch -d <feature-branch>` (local) **and** `git push origin --delete <feature-branch>` if it was ever pushed. Skip remote delete only if the branch was never pushed. (Placed AFTER L-5.6 — unlike H's `H-9.5`-before-`H-9.6` order — intentionally: L-5.6 Session End's first check verifies merged-status, so deleting last consumes that verification. Don't "fix" the asymmetry.) Output: `git branch` + `git ls-remote --heads origin <branch>` both confirming the branch is gone. |

The L-5.6 resolver is executable shell so its fail-closed behavior stays fixture-tested:

<!-- finish-flow-root-resolver:start -->
```bash
resolve_finish_flow_package_root() {
  local catalog_skill="${1:-}" root="" canonical_skill=""
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -n "${PLUGIN_ROOT:-}" ] \
     && [ "$CLAUDE_PLUGIN_ROOT" != "$PLUGIN_ROOT" ]; then
    printf '%s\n' 'error: ambiguous plugin roots' >&2; return 2
  fi
  root="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-}}"
  if [ -z "$root" ]; then
    [ "$#" -eq 1 ] && [[ "$catalog_skill" = /*/skills/finish-flow/SKILL.md ]] \
      && [ -f "$catalog_skill" ] \
      || { printf '%s\n' 'error: require one exact absolute active finish-flow/SKILL.md catalog path' >&2; return 2; }
    canonical_skill="$(cd "$(dirname "$catalog_skill")" 2>/dev/null && pwd -P)/SKILL.md" \
      || { printf '%s\n' 'error: cannot canonicalize active finish-flow skill path' >&2; return 2; }
    root="$(cd "$(dirname "$canonical_skill")/../.." 2>/dev/null && pwd -P)" \
      || { printf '%s\n' 'error: cannot derive package root from active finish-flow skill' >&2; return 2; }
  else
    root="$(cd "$root" 2>/dev/null && pwd -P)" \
      || { printf '%s\n' 'error: plugin root is not a readable directory' >&2; return 2; }
  fi
  [ -f "$root/skills/finish-flow/SKILL.md" ] \
    && [ -f "$root/scripts/reap-dispatch-branches.sh" ] \
    && [ -x "$root/scripts/reap-dispatch-branches.sh" ] \
    || { printf '%s\n' 'error: package root is incomplete or reaper is not executable' >&2; return 2; }
  printf '%s\n' "$root"
}
```
<!-- finish-flow-root-resolver:end -->

After all 7 completed → mark the parent L-5 task (from L-1) completed.

### H-size — Hotfix Closing (6 sub-tasks)

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| H-9.1 | Verify fix addresses the incident | State the root cause in one sentence and point to the specific code change that addresses it. Output: root cause + file:line of the fix. |
| H-9.2 | Quality gate | Invoke `autopilot:quality-pipeline`. Output: zero test failures, zero blocking review findings. |
| H-9.3 | Merge to main (--no-ff) | `git checkout main && git merge --no-ff hotfix/<name>`. Merge commit MUST carry the `QC-Verdict: PASS (reviewer <id>, <date>)` trailer (see L-5.3 — the `pre-push` qc-gate enforces it). Output: merge commit hash + trailer. |
| H-9.4 | Post-incident learn (MANDATORY) | Invoke `autopilot:learn`. Record: incident, root cause, detection method, fix, prevention. Output: knowledge entry path. |
| H-9.5 | Delete hotfix branch (local + remote) | `git branch -d hotfix/<name>` (local) **and** `git push origin --delete hotfix/<name>` if it was pushed. Output: `git branch` + `git ls-remote --heads origin hotfix/<name>` confirming both gone. |
| H-9.6 | Session end | Verify completion, staging reflects the hotfix, any follow-ups recorded in BACKLOG. Output: pass/fail summary. |

### Fix-size — Bug Fix Wrap-up (5 sub-tasks)

> **Optional** — Fix workflow may invoke finish-flow for rigor, but is not forced to.

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| F.1 | Quality gate | Invoke `autopilot:quality-pipeline --size S`. Output: zero failures. |
| F.2 | Commit with detailed message | Commit must state root cause + what was wrong + how it's fixed. Output: `git log -1 --format=%B` showing all three. |
| F.3 | Ongoing-maintenance entry | Append one line to `docs/projects/ongoing-maintenance/YYYY-MM.md` (or the project-configured projects path — e.g. `docs/` plural; check the injected config first so you don't create a stray sibling tree): `| MM-DD | commit_hash | fix(area): 根因 → 修法 |`. Output: `tail -1` of that file. |
| F.4 | Merge to develop | `git checkout develop && git merge --no-ff fix/<name>`. Merge commit MUST carry the `QC-Verdict: PASS (reviewer <id>, <date>)` trailer (see L-5.3 — the `pre-push` qc-gate enforces it). Output: merge commit hash + trailer. |
| F.5 | Delete fix branch (local + remote) | `git branch -d fix/<name>` (local) **and** `git push origin --delete fix/<name>` if it was pushed. Output: `git branch` + `git ls-remote --heads origin fix/<name>` confirming both gone. |

### S-size — S-Lite Session End (3 sub-tasks)

> **Optional** — S workflow may invoke finish-flow for rigor, but is not forced to.

| # | Subject | Description + verification output |
|---|---------|-----------------------------------|
| S.1 | Retry check | Did I retry any non-trivial operation 2+ times? If yes → invoke `autopilot:learn`. Output: yes/no, and if yes, knowledge entry path. |
| S.2 | Deferred items | Anything postponed → append to `docs/BACKLOG.md` with context + trigger condition. Output: `tail` of BACKLOG showing the new entry (or "none" if none). |
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
