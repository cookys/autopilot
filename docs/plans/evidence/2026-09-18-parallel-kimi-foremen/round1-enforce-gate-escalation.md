# ESCALATION — run par-c, unit secretscan-c

## Question for depth 0

The implement hand dispatch — exact form from brief.md — is refused by the rail's Mission
enforcement gate. How should the hand be dispatched?

Observed (verbatim, rc=2):

```
/home/cookys/projects/autopilot-par/c-secretscan/scripts/dispatch-hetero.sh \
  --branch hands/par-c/secretscan-c \
  --base 4d0251777976eb87cf4fcce88592b4693adef400 \
  --ledger <run_dir>/hands.ledger --run-id secretscan-c --stage implement \
  --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m \
  --prompt-file <run_dir>/hand-secretscan-c.md
→ { "status": "precondition_failed", "runner": "unresolved", ...,
    "error": "Mission enforce mode requires a sealed campaign strict projection",
    "dispatcher_called": false }
```

## Evidence

- Gate source: `scripts/dispatch-hetero.sh:1516-1547` (`check_mission_enforcement_gate`). It fires
  because the consumed repo (my worktree `/tmp/foreman-par-c-5MSlql`) contains
  `.claude/owner-kernel-governance.json` with `mission_convergence.enforcement_mode: "enforce"`
  (line 90). That file is TRACKED in git at the run base (`git ls-files` hits; last touched by
  commit c7623f86 "fix(mission): gate execution by admitted deliverables"), so every worktree at
  base 4d025177 inherits enforce mode.
- Under enforce, the script requires a sealed campaign strict projection
  (`--strict-contract`, digest-bound `--run-id`/`--stage`; preflight at
  `dispatch-hetero.sh:1279-1346`). The brief's exact dispatch form carries no contract flags, and
  mission-policy overrides may only TIGHTEN, never loosen
  (`src/engine/mission-policy.js:115-120`) — there is no env var or flag I can add on my own
  authority to pass this gate, and fabricating or weakening a seal would be routing around a
  security boundary, which I will not do.
- The hand prompt is already written and ready:
  `<run_dir>/hand-secretscan-c.md` (Product / Tests / Verify / Allowed sections pasted verbatim
  plus the commit-rules paragraph, per brief).
- Note: `scripts/dispatch-review.sh` does NOT contain this gate, so only the implement/repair
  hand dispatches are blocked; the review step would work once a diff exists.

## What I need (any one unblocks the run)

1. A sealed campaign strict projection for this run (contract path + expected flags to append to
   the dispatch command), or
2. An amended dispatch command depth 0 authorizes (e.g. the sealed bounded-campaign path), or
3. Confirmation that the worktree's governance should be shadow/off for this run and how that is
   set by depth 0 (I must not edit `.claude/owner-kernel-governance.json` — outside my allowed
   files, and it is the repo's authority).

I am stopped per protocol pending `<run_dir>/ANSWER.md`. Nothing was dispatched; no branches,
no ledger entries, no repo mutations were made (the failed call exited before any effect:
`dispatcher_called: false`, `resources_created: 0`).
