---
name: finish-flow
description: >
  Closing checklist for dev-flow's `finish` node at every size (XS, S, M, L, XL; bug; urgent) — guarantees
  no step in the closing sequence gets silently compressed or skipped. On invocation, creates size-keyed
  sub-tasks via TaskCreate so each step is individually trackable. MANDATORY at the finish node of every
  size (lite for XS–M, full for L/XL); for urgent work that was not high-risk it also runs the post-finish
  code-review. Use when: finishing an L/XL project, closing an urgent fix, "time to merge", "wrap this up",
  "跑完收尾", "收掉這個專案", "finish 開始". Not for: mid-phase work, starting new work
  (→ dev-flow), authoring a plan doc (→ references/plan-template.md).
---

<!-- AUTOPILOT_CODEX_LIFECYCLE_ADAPTER_V1 -->

## Codex lifecycle adapter (normative override)

This section overrides any later host-specific lifecycle or dispatch spelling in the canonical skill
body. Resolve `<plugin-root>` as the installed Autopilot plugin directory that contains this skill.

When using the packaged managed CLI, enter through the existing explicit marker command:

```text
node "<plugin-root>/scripts/session-mode.js" set --level <l3|l4|l5|l6> --entry-level <requested-level> --repo-root <git-root>
```

The production Codex package currently registers only its `PostCompact` recovery hook. It does not
ship a Codex-thread-bound `PreToolUse` direct-mutation gate, and this shell command must not be
described as receiving or exporting a `CODEX_THREAD_ID` binding. The marker is an explicit
CLI/Engine admission artifact; it is not a production hook admission proof. A marker from another
explicitly bound session is not reusable when the managed CLI validates it.

Read the emitted marker's `mission_routing` exactly as the canonical skills do (dev-flow /
ceo-agent Mission routing sections): `READY` (with `admitted: true`, `would_block: false`) is the
only enforce-mode admission — only then does managed implementation follow the existing Mission
admission, sealed campaign, and `AUTOPILOT_LEVEL=<level> node
"<plugin-root>/bin/autopilot.js" engine implement-review ...`
route. `SHADOW` (the repo's `mission-routing-config.json` has `enforcement_mode: shadow`) is
observation only: record `admitted` / `would_block` honestly in the run summary and continue
through the ordinary non-managed workflow without claiming an enforced receipt or grant, and
without calling the managed engine route (the managed CLI rejects a non-READY marker). `LEGACY`
means the project's Mission policy is off. Switching a repo from shadow to enforce is that repo
owner's policy decision, not a gate to be bypassed. Repairs attach to and resume that same engine/campaign lineage. A Codex implementer launched
inside that route receives a credentials-only isolated `CODEX_HOME`, never the controller plugin or
configuration.

Codex in this package does not provide `TaskCreate`, `TaskUpdate`, `TaskStop`, native `Agent`, or
`subagent_type`. Do not imitate them with Markdown tickets, inline managed implementation, a new
branch/session, or a replacement graph. If an exact mapping is unavailable, stop with the existing
precondition or abort receipt; do not invent another lifecycle authority.

# finish-flow — the `finish` node checklist

**Purpose**: closing is multi-step and easy to compress mentally into "one thing to do". This skill turns each
closing step that applies to the session's size into its own `TaskCreate` item, which system-reminder surfaces
until it is individually completed. Passive text cannot force behavior; active TaskCreate reminders can.

## Project Config (auto-injected)
!`cat .claude/finish-flow-config.md 2>/dev/null || true`
!`cat .claude/dispatch-config.md 2>/dev/null || true`

## Entry Protocol (MANDATORY)

```
1. Read size, urgent, bug, high_risk and base_ref from the marker:
     node scripts/session-mode.js status
   No marker or no size ⇒ ASK the user (CEO evaluates within DOA), then
     node scripts/session-mode.js set --size <XS|S|M|L|XL> [--urgent] [--bug]

2. Enter the node:  node scripts/stage-advance.js --to finish
   Exit 3 ⇒ an earlier node is still open: go to a node in legal_next and come back. Never force.

3. Select every checklist row whose "Runs for" matches this session, and TaskCreate each one,
   in table order, as its own call. Subject: "finish · <item>". Description: the row's
   description including its output clause, copied verbatim (not abbreviated).

4. Mark the parent task "finish: Invoke autopilot:finish-flow" (created by dev-flow at intent
   for L/XL) in_progress.

5. Work through the sub-tasks in order, marking each completed as its output is produced.

6. Urgent: run the post-finish code-review row last.
```

**Do not combine**. Each sub-task is its own `TaskCreate` call and its own `TaskUpdate status=completed` call.

## Checklist

"After a merge" = the work was merged from a separate branch (`fix/*`, `hotfix/*`, a feature branch); otherwise the
work was committed directly and the confirm-commit row applies instead of merge, post-merge and branch deletion.
"Incident" = production was broken (`hotfix/*` branch).

| Item | Runs for | Description + verification output |
|------|----------|-----------------------------------|
| Goal review | L, XL | Open the project README. For each success criterion, show (a) the criterion text and (b) the concrete evidence (command output, file contents, or diff) proving it's met. Verify EACH row of the dev-flow requirements ledger is DONE or explicitly deferred (named to the user in the report) — a silently dropped accepted requirement is a FAIL. Output: pass/fail list, zero unverified. |
| Incident fix check | urgent with an incident | State the root cause in one sentence and point to the specific code change that addresses it. Output: root cause + file:line of the fix. |
| qc verdict | all | The `qc-gate` node's result covers the current HEAD: zero test failures and (M–XL, or XS/S with risk flags) zero blocking `autopilot:quality-pipeline` findings, within at most 3 fix-review rounds. The `/l5` / `/l6` engine implement-review loop is governed separately by resolver `loop_max_rounds`. A commit after the gate ran ⇒ run the gate again now. _(CI-backed tests on Claude Code may be awaited with the `Monitor` tool — see quality-pipeline Tests step / [portability §7](../../references/multi-agent-portability.md).)_ Output: the gate's final result for the HEAD sha. |
| Bug commit message | bug | The commit states root cause + what was wrong + how it's fixed. Output: `git log -1 --format=%B` showing all three. |
| Ongoing-maintenance entry | bug, XS–M | Append one line to `docs/projects/ongoing-maintenance/YYYY-MM.md` (or the project-configured projects path — e.g. `docs/` plural; check the injected config first so you don't create a stray sibling tree): `\| MM-DD \| commit_hash \| fix(area): 根因 → 修法 (跨 N 模組) \|`. Output: `tail -1` of that file. |
| Merge | after a merge | Target: `develop` (or `main` per project convention); `hotfix/*` merges to `main`. For L5/L6, resolve `autopilot_root` with the package-root resolver below, set `task_status_receipt` to a new caller-owned path, then run `node "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id" --json >"$task_status_receipt"` and assert the parsed JSON has `can_merge === true` (for example, `node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(v.can_merge!==true)process.exit(1)' "$task_status_receipt"`). Only after that assertion passes run `git checkout <target> && git merge --no-ff <branch>`. The merge commit message MUST carry the qc-evidence trailer `QC-Verdict: PASS (reviewer <id>, <YYYY-MM-DD>)` once the qc verdict row passed — the `.githooks/pre-push` **qc-gate** ([`scripts/resolve-qc-gate.sh`](../../scripts/resolve-qc-gate.sh), strength per `.claude/qc-gate-config.md`) refuses to push a protected-path range without it. **Trailer parsing only reads the message's LAST paragraph** — a blank line between `QC-Verdict:` and `Co-Authored-By:` splits them into two paragraphs and `%(trailers:...)` silently returns empty (fixable with `git commit --amend` to re-join them into one trailing block; amending a merge commit does not touch its parents). Output: (L5/L6) the pre-merge receipt with `can_merge=true`, plus `git log -1 --format="%H %s%n%(trailers:key=QC-Verdict)"` showing merge commit + trailer — **checking that combined output for non-emptiness proves nothing**, since `%H %s` alone guarantees non-empty text even with zero trailers; isolate the trailer value itself with `git log -1 --format="%(trailers:key=QC-Verdict,valueonly)" \| grep -q .` and require THAT to succeed. |
| Confirm commit | no merge | `git log -1 --format="%H %s"` on the expected branch. Output: commit hash + branch name. |
| Post-merge review | M, L, XL after a merge | Re-read critical files that were changed (pick 1–3 highest-risk) to verify the merge didn't silently drop changes. **Doc-sync (conditional)**: if the change touched user-facing behavior or 3+ modules, invoke `autopilot:doc-sync` in scoped mode (base = the merge-base) to confirm docs still match the merged code; OFFER full mode for large/user-facing ships. Triage confirmed findings per doc-sync's fix policy (user docs → reality; specs → STALE-fix or mark NOT-YET-IMPLEMENTED + BACKLOG). Output: grep/diff confirming each expected change is present on the target + doc-sync drift summary (or "doc-sync skipped: no user-facing/3+ module change"). |
| Archive project | L, XL | Move `docs/projects/<project>/` → `docs/projects/_archive/<project>/` (or the project-configured projects path). Update `docs/projects/INDEX.md` (remove from 進行中, add to 已完成 with date). If `.claude/mission-routing-config.json` points inside the moved directory, update `graph_path` to the archived path in the same change and require `mission-routing-admission.test.sh` plus `session-mode.test.sh` to pass after the move. **Stale-qualifier guard**: `grep -E '^\|' docs/projects/INDEX.md \| grep -Ei '\((pending\|target\|in progress\|WIP\|TBD\|draft)\)'` MUST be empty (scan **table rows only** — the `^\|` prefilter excludes section headers like `## 進行中 (In Progress)` which would otherwise false-positive under `-i`; `-i` then catches lowercase `(wip)` in a row); on hit, emit matched lines + halt. **Plan-as-project archive** (campaign work tracked as `docs/plans/<date>-<slug>.md` instead of `docs/projects/`): run `node scripts/check-plan-graduation.js --fix` — this IS the archive step for plan-as-project; hard-fail if it still reports a blocking violation afterward (`--json`, exit 1). Output: `ls docs/projects/_archive/<project>/` + grep guard pass-confirmation. |
| Release hygiene | any size that bumped the version | Run `scripts/preflight-release.sh` — verifies CHANGELOG entry + INDEX row + version mirrors are consistent with canonical `.claude-plugin/plugin.json`; must exit 0. Output: the preflight-release pass line. |
| Post-incident learn | urgent with an incident | MANDATORY. Invoke `autopilot:learn`. Record: incident, root cause, detection method, fix, prevention. Output: knowledge entry path. |
| Session end (lite) | XS, S, M | (1) Retry check: did I retry any non-trivial operation 2+ times? If yes → invoke `autopilot:learn`. Also run `node scripts/probe-unknown.js report --ledger <ledger>`: any `learn_required` climb (ladder row at rung ≥ 1, no skip reason) makes `autopilot:learn` MANDATORY, pre-filled with the climb's `terms` + `unknown_type`. (2) Deferred items: anything postponed → one row on the resolved `backlog` (`scripts/resolve-project-paths.sh --target "$(git rev-parse --show-toplevel)" --field backlog`; **never** a literal `docs/BACKLOG.md`) per [`references/backlog-entry.md`](../../references/backlog-entry.md), then `node scripts/check-backlog-entries.js --backlog <resolved backlog>` (warn); `backlog: none` ⇒ report that this project has no backlog file and hand the items to the user; do not create one. (3) Urgent: staging reflects the change. Output: retry yes/no (+ knowledge entry path), `tail` of the backlog showing new entries (or "none") plus the gate JSON, staging line (urgent). |
| Session end (full) | L, XL | Run the [Session end (full) checklist](#session-end-full-checklist) below. Output: pass/fail summary for each gate and four-surface per-surface lines. |
| Delete merged branch | after a merge | Verify it's merged first (`git branch --merged <target>` lists it), then `git branch -d <branch>` (local) **and** `git push origin --delete <branch>` if it was ever pushed. Last on purpose: the session-end rows verify merged status first, and deleting last consumes that verification. Output: `git branch` + `git ls-remote --heads origin <branch>` both confirming the branch is gone. |
| Post-finish code-review | urgent, when `node scripts/stage-graph.js next --from finish --size <size> --urgent [--high-risk when the marker's high_risk is true]` lists `code-review` | Invoke `autopilot:hetero-review` (code loop) on the full diff, `--phase full --phase-base <base_ref>`; its rail records the stage. Nothing loops back to implement: each finding opens a new `S` task — one backlog row per [`references/backlog-entry.md`](../../references/backlog-entry.md) with `**Effort**: S`. Output: the review receipt path + the new backlog rows (or "no findings"). |

The Session end (full) resolver is executable shell so its fail-closed behavior stays fixture-tested:

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

### Session end (full) checklist

1. **Verify completion**: the user's last request is done (or the user said pause/stop); no background work
   pending; on a feature branch, check it is merged — if not, flag to the user before proceeding.
2. **Project docs**: progress table and last-updated date updated; project index synced; 100% complete + merged ⇒
   the archive row ran.
3. **Knowledge extraction** via `autopilot:learn` when warranted — non-obvious landmine → `.claude/knowledge/`;
   architecture decision → project docs; process gap → the relevant skill; cross-session lesson → persistent
   memory; none → skip, do not force it. MANDATORY when `node scripts/probe-unknown.js report --ledger
   <project>/ledger/decisions.jsonl` lists any `learn_required` climb (a ladder row at rung ≥ 1 with no skip reason:
   the session consumed an outside source to resolve an unknown; pre-fill the learn entry with that climb's `terms`
   and `unknown_type` so the next S4 lookup hits; rows with `budget-exhausted` / `not-heterogeneous` / `knob-off` /
   `rail-failed` never trigger it). The learn summary covers errors resolved (root cause + fix), key decisions
   (rationale), surprises.
4. **Episodic-distill evaluation**: did this project produce a transferable methodology or a rework-tempered
   procedure? yes → suggest `autopilot:distill` episodic mode (learn records lesson-FACTS, distill produces
   executable PROCEDURES).
5. **Deferred items**: one backlog row each per [`references/backlog-entry.md`](../../references/backlog-entry.md),
   evidence at the pointer. Backlog safety: an item that affects the final goal is never deferred.
6. **Triggered BACKLOG pickup**: items whose trigger condition this session's work met, scoped by
   `git log --oneline $(cat .claude/session-start-sha 2>/dev/null || echo "HEAD~10")..HEAD`. Normal mode: present
   to the user. CEO mode: decide autonomously and record in the CEO Report.
7. **Staging verify** (skip mid-implementation, docs-only, or no staging environment).
8. **Escalation events** exist for every triggered quality-floor emission point (or none fired).
9. **Four-surface sweep (skill/doc/memory/knowledge)** — for EACH surface output either "updated: <what>" or "not
   needed: <reason>"; the user must never have to ask 該補的都處理了嗎.
10. **Dispatch-branch gate**: derive `integration_target` from project config; otherwise resolve the `origin/HEAD`
    symbolic ref and normalize only `refs/remotes/origin/<name>` or `origin/<name>` to the local `<name>`; if
    `origin/HEAD` is unavailable, use the unique local `develop`/`main`. In every case require `refs/heads/<name>`
    to exist (ambiguity, malformed remote target, or missing local ref ⇒ halt). Assign `autopilot_root` from the
    package-root resolver above and halt on nonzero. When `CLAUDE_PLUGIN_ROOT` or `PLUGIN_ROOT` is set, call
    `autopilot_root="$(resolve_finish_flow_package_root)"`; otherwise set `active_finish_flow_skill` to the one exact
    absolute active `finish-flow/SKILL.md` path shown by the harness catalog and call
    `autopilot_root="$(resolve_finish_flow_package_root "$active_finish_flow_skill")"`. Never substitute the consumer git root or a newest-cache search. Then run
    `bash "$autopilot_root/scripts/reap-dispatch-branches.sh" check --repo "$(git rev-parse --show-toplevel)" --into "$integration_target"`.
    Exit 1 blocks clean exit until every ahead candidate is integrated or preserved with exact-tip `--ack` + handoff
    rationale. Deliberate discard is manual human/depth-0 action only after verified preservation; the reaper never
    deletes an uncontained branch. Re-run until exit 0.
11. **LSM status gates (L5/L6 only)**: after merge and again immediately before marker clear, run `node
    "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id" --json >"$task_status_receipt"`;
    preserve the final JSON receipt. Report `product_merged`, `consumer_updated`, `pushed`, and `zero_residue`
    independently. Never say “merged and clean” unless `can_close=true`.
12. **Session-mode marker**: L5/L6 must run `node "$autopilot_root/scripts/session-mode.js" clear
    --task-status-receipt "$task_status_receipt" --root-run-id "$root_run_id"`; the command fails closed unless
    the fresh digest-valid receipt has the same root and `can_close=true`. L4 keeps `node
    "$autopilot_root/scripts/session-mode.js" clear`. The lite session end has no marker-clear step.
13. **Checklist summary**: pass/fail for each gate; include it in the PR description.

## Enforcement Rules

1. **Parent task exists from intent** (L, XL): dev-flow creates `finish: Invoke autopilot:finish-flow` at the
   intent node. Missing ⇒ the intent gate failed — STOP and create it retroactively before continuing.
2. **Sub-tasks are discrete**: one TaskCreate per row; never batch rows into one call.
3. **Verification output is concrete**: every row names the output that proves it. "I did it" is not acceptable —
   paste the actual output or file path.
4. **Sequential completion**: rows complete in table order — merge never precedes the qc verdict, archive never
   precedes merge, branch deletion follows session end, the post-finish code-review is last.
5. **CEO mode**: every row is within CEO DOA (tactical, reversible, local). The CEO does not pause between rows —
   execute all, then report in the CEO Final Report.

## Anti-patterns

| Wrong | Right |
|-------|-------|
| Compress the checklist into a single "finish up" TaskCreate | Each row is its own TaskCreate |
| Merge before the qc verdict row | Order matters — the qc verdict comes first |
| Archive before merge | Never reverse them |
| Skip `autopilot:learn` because "nothing to learn" | After an incident, learn is MANDATORY; for L/XL, walk the knowledge questions and skip only if all are "no" |
| Urgent-low findings fixed in place after finish | Each finding opens a new `S` task; the finished work does not loop back |
| Mark the parent completed while rows are still pending | The parent completes only after every row reaches completed |
| "I know what I need to do, skip the TaskCreates" | The forcing function is the TaskCreates themselves — there is no shortcut |

## Relationship to Other Skills

- **dev-flow**: runs the nodes up to `finish`; creates the parent closing task at `intent` (L, XL).
- **quality-pipeline**: the `qc-gate` node; this checklist re-runs it only when HEAD moved after the gate.
- **hetero-review**: the post-finish code-review on the urgent-low path.
- **learn**: mandatory after an incident and on a `learn_required` climb; optional otherwise.
- **project-lifecycle**: the archive procedure.
- **ceo-agent**: CEO mode invokes finish-flow at the `finish` node; all rows are within DOA, no Board escalation
  unless a row reveals a goal miss or an irreversible surprise.

## Exit Condition

Done when every selected row is `completed`, the parent task (L, XL) is completed, and a final summary lists which
rows ran and what evidence each produced. Only then may the session move on or end.
