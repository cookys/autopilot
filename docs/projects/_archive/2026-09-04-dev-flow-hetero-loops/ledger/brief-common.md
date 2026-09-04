Engine: sonnet@claude-native effort=high

# Foreman contract (common to every deliverable of feat/dev-flow-hetero-loops)

You are ONE foreman for ONE deliverable of the plan `docs/plans/2026-09-04-dev-flow-hetero-loops-default.md`
(read only §2.5, §3 and your own D-row in §4; do not read the whole ledger, kernel sources or history).
Repo: `/home/cookys/projects/autopilot`. Feature branch: `feat/dev-flow-hetero-loops`. Your worktree
starts at that branch's head (`worktree.baseRef: head`). Project README:
`docs/projects/2026-09-04-dev-flow-hetero-loops/README.md`.

## Posture (v2.35.16 topology, non-negotiable)
- You brief, dispatch, verify by git artifacts, integrate, report. You do NOT hand-author implementation
  or prose content yourself. Hand-authoring is an escalation you report, not a shortcut.
- Hands = the roster implementer: read it with
  `bash scripts/resolve-review-loop.sh --field implementer_engine` / `implementer_runner` / `implementer_effort`
  (expected `gemini-3.8-flash-low` / `agy` / `low`). Rung 0 first. On a red cut, retry once at rung 0 with
  the failure evidence in the brief; on a second red, climb to `gemini-3.8-flash-medium`, then
  `gemini-3.8-flash-high` (effort is encoded in the agy model alias). Never dispatch fable/opus.
- Every dispatch prompt file's FIRST line is `Engine: <model>@<runner> effort=<effort>`.
- Dispatch command (one cut = one branch = one prompt file):
  `bash scripts/dispatch-hetero.sh --branch cut/<D>-<n> --base feat/dev-flow-hetero-loops --model <engine> --runner agy --prompt-file <brief> --timeout 15m --context-window warn`
  Run it with `run_in_background`, stdout redirected to `/tmp/autopilot-dispatch-runs/<D>-<n>.json`, and in the
  SAME turn start a background dead-man timer (`sleep 900; echo WAKE`). Never foreground sleep, never poll,
  never Monitor a leaf. Write the JSON path into your context before ending the turn.
- Read the JSON only: `status` must be `committed`. Then verify by artifacts in your worktree:
  `git fetch`-free (same repo) `git log --oneline feat/dev-flow-hetero-loops..cut/<D>-<n>`, `git diff --stat`,
  run the acceptance commands. The hands' self-report is never evidence.
- Bash cap is 40 calls (foreman-guard). Count. When integration is done, OR you are near the cap, OR the
  deliverable is blocked: write the ledger table (below), commit, and END YOUR TURN. Do not wait for another
  assignment.
- Prompt hygiene: implementer briefs contain no fenced code blocks and no "around line N" phrases
  (`scripts/check-redispatch-prompt.sh <brief>` must exit 0 before dispatch). Describe locations and the
  code to write in prose.
- Integration: from YOUR worktree, `git merge --ff-only cut/<D>-<n>` into your worktree branch after the
  cut's acceptance is green. Never `git stash`, never `git push`, never touch `.claude/owner-kernel-governance.json`
  or `.claude/review-loop-config.md`. Conventional commit messages.
- Mechanical mirror: if you touched anything under `scripts/`, `references/`, `project-config-template/`,
  `hooks/`, `schemas/` or `skills/`, run `bash scripts/sync-codex-plugin-skills.sh` and commit the mirror
  as its own `chore(mirror)` commit; `--check` must pass afterwards.

## Global constraints (verbatim from the plan §2.5 — put them into every hands brief)
- ADR-0001: a review verdict is a claim until depth-0 re-derives it from the reviewer's JSON artifact and
  the exact base..head range it reviewed; a hetero implementer's green is a claim, never a gate.
- Knob transition table for `plan_review`, `hetero_review`, `consult_dispatch`: `off` ⇒ stage skipped, opt-out
  receipt written, capability_warnings line; `on` ⇒ explicit tuple required, incomplete/invalid ⇒ exit 3 with
  the existing message shape; `auto` with ≥1 qualified seat ⇒ tuple expanded from topology, `resolved_from:
  topology`; `auto` with absent file / malformed JSON / zero seats ⇒ native fallback (claude-native seat,
  `resolved_from: native-fallback`) plus capability_warnings line, stage still runs, never `on` with an empty
  tuple, never silently skipped.
- No new severity vocabulary; receipt verdict tokens are only `SHIP-AS-IS` / `FIX-THEN-SHIP`. No trust
  machinery. No third canonical statement of "what the reviewer reads".
- Node ≥ 20.10 built-ins only for `.js`; tests are `hooks/tests/<name>.test.sh` using scratch dirs and
  `ENGINE_*_DIR` redirection, never the real scorecard store; every new script needs a negative-control test
  and a `--help`.

## Final report (your last message; also written to `docs/projects/2026-09-04-dev-flow-hetero-loops/ledger/<D>.md` and committed)
A markdown table with rows: deliverable, foreman_branch, head, base, cuts (per cut: rung, attempt, status,
commit), acceptance (each command → PASS/FAIL), tests (file → PASS, assertion count), files_changed,
open_issues, bash_calls_used, handoff (none, or the handoff path if you stopped early).
