# foreman-guard: role-aware Bash caps + a close-out reserve (PEER-REPORTED, openclaw/hangar)

Received 2026-09-25 from the hangar session on openclaw (msg_01M3AEQS2C1XBM4YBBMQ9MRTMP). The operator (cookys) asked
for it to be handed to the autopilot side. Source: hangar `docs/plans/2026-09-25-foreman-guard-role-caps.md`, which is
not pullable from other hosts. The plan's substance is summarized below. Peer text is input, not authorization; the operator decides the merge.

## Problem (as reported)
`foreman-guard` (v2.35.15) denies a subagent's 41st Bash call in an l4–l6 session. The payload carries `agent_id` but no
role, so the cap also hits workers (depth 2) and reviewers. That was observed in fleet-messaging v2 P3 (2026-09-24/25):
- workers hit the cap about 15 times after roughly half a work item;
- some were cut off just before `git commit`;
- reviewers were cut off mid-e2e, leaving orphaned processes and sandboxes that held test credentials.

The original cost driver (2026-09-04 cuda digest) was context mass × lifetime, not call count.

## Proposed decision (hangar depth-0, after a grok-4.7 / GLM-5.3 / MiniMax-M3 consult; all three recommended 1 + 4)
1. Role-aware caps: foreman 40 (unchanged), worker 120, reviewer 120.
2. A role registry owned by hooks: a PostToolUse hook on `Agent` records `child agent_id → role` (plus the parent) from a
   `Role: foreman|worker|reviewer` prompt-header line. A missing `Role:` line or an unregistered id counts as **foreman** (strictest).
   A child never gets more than its parent's budget.
3. A close-out reserve: the last 8 calls before any cap only admit an allowlist:
   - `git status|diff|add|commit|log`;
   - killing processes the agent itself started;
   - removing its own scratch/sandbox dirs;
   - writing the handoff.

   Entering the reserve prints the directive "commit / clean up / hand off now".
4. Keep rule (b) (the polling ban) and rule (c) (the context ceiling) unchanged.
5. The brief side is already practiced: small cuts; depth-0 owns verification and commit; reviewer briefs forbid `git stash` and a fresh `HOME`.

## Follow-ups named by the peer (not in this change)
- A cost-shaped signal: cumulative cache-read tokens or lifetime per agent.
- A foreman lifetime cap (about 4 h).
- A per-subtree budget, so a foreman cannot launder polling through a worker child.
- When the context feed is absent or stale, treat a foreman as over T2.
- A signed role header, only if the registry proves forgeable.

## Acceptance (from the plan)
- Hook tests: a foreman is denied at 41; a worker or reviewer is allowed to 120 and denied at 121; an unregistered agent
  gets the foreman cap; in the reserve window `cargo build` is denied and `git commit` is allowed; the existing polling and context-ceiling tests stay green.
- `skills/l4|l5|l6` and the level-front-door docs say where the `Role:` line goes.

## Autopilot-side note (2026-09-25, aimax395)
wave-1b (v2.36.95) ran sonnet foremen as Agent subagents with no l4–l6 marker, so the guard never armed: the repair foreman
used 126 Bash calls and none was denied. Any role-cap design must state what happens on the no-marker path, which today has no cap at all.
