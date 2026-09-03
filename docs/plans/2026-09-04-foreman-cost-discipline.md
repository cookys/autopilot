# Foreman cost discipline — enforce the ironlaws that only existed as prose

**Date**: 2026-09-04 · **Target**: v2.35.15 · **Size**: L (hooks defaults + new hook + skill prose + docs)
**狀態**: ✅ Shipped in v2.35.15 — merged as `72dfa052`
**Trigger**: cuda quota digest 2026-09-04 (`cuda:~/projects/QUOTA-DIGEST-2026-09-04.md`, relayed over
hangar-bridge; operator-confirmed scope on aimax395 2026-09-04): ≈$2,200 API-equivalent in 36 h, 79 % from
four resident Sonnet foremen (13–33 h alive, 1,900–7,400 Bash calls each, 34–97 万 cache-read per call,
output ≈0). Burn shapes: (1) foreground polling (`true`×450, `while ! grep …; do sleep 10`, `tail -c
8000 …output; ps -p`×40, `sleep 15; pgrep agy`×13); (2) waking after cache TTL and re-writing the whole
context (413 × cache_creation>100K, $455); (3) takeover reads (brief 301 lines + rulings 170 + ledger
14,648 lines + 26K lines of kernel source ≈300K to start). Multiplier: `model=…[1m]` inherited by
subagents → foremen auto-compact only at 967K.

Audit (verified on this checkout 2026-09-04): the canonical rules exist as prose (`skills/l4|l5|l6/SKILL.md`
foreman clause: no Monitor, no sleep polling, Bash ≤40) but the only enforcer, `check-foreman-polling.js`,
runs post-hoc at depth-0 harvest; `context-budget`, `cost-tracker`, `dispatch-model-guard` are all opt-in
(`hooks/opt-in-manifest.json`), unlisted in `settings.example.json`'s how-to, and never enabled on cuda;
no skill states a foreman lifetime, context ceiling or exit rule.

## Board decision (2026-09-04, aimax395 operator)

All six digest proposals, no fleet-wide broadcast (report back to cuda only).

## Design

### D1 — `hooks/foreman-guard.js` (NEW, default-on, PreToolUse `Bash|Monitor`)
Runtime enforcement of ironlaw #6 for the actor it names. Scope: the session-mode marker is active
with level l4/l5/l6 (`scripts/session-mode.js readMarker`) AND the payload carries `agent_id`
(SPIKE-1: subagent identity) — depth-0 and every non-orchestrator session are untouched.
- Bash cap: per (session, agent_id) counter in `~/.autopilot/foreman-guard/`; call 41+ is DENIED with a
  directive: write the handoff, end the turn (一刀一命 — the lifetime rule of D3 made mechanical).
- Polling deny (foreground Bash only; `run_in_background: true` is the sanctioned wait):
  `^\s*(true|:)\s*$`, `\bsleep\s+\d`, `\bwhile\b.*\b(sleep|grep|test|\[)\b`, `\b(pgrep|ps\s+-p|kill\s+-0)\b`,
  `\b(cat|tail|head|sed\s+-n)\b[^|;&]*\/tasks\/[^ ]*\.output`. Each deny names the rule and the
  sanctioned alternative.
- `Monitor` from a foreman/worker: DENIED (ironlaw #6; depth-0 keeps Monitor).
- Modes: `foreman_guard.mode` in `~/.autopilot/config.json` or `AUTOPILOT_FOREMAN_GUARD_MODE` =
  `block` (default) | `warn` | `off`; `foreman_guard.bash_cap` (default 40). Fail-open on any error.
- `docs/ironlaw-to-gate-map.md` row 6 moves from "post-hoc only" to this hook + the post-hoc checker.

### D2 — three opt-in hooks become default-on
`context-budget` (PostToolUse `.*`), `dispatch-model-guard` (PreToolUse `Task|Agent`), `cost-tracker`
(Stop) leave `opt-in-manifest.json` and the multiplexer table, and are wired directly in `hooks.json`.
Each keeps an opt-OUT: `context_budget.mode: off` / `AUTOPILOT_CONTEXT_BUDGET_MODE=off`;
`dispatch-model-guard` mode `off` via `.claude/dispatch-guard-config.md` or new
`AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off`; `AUTOPILOT_COST_TRACKER=false`. Hook counts: 27 total, 14
default-on, 13 opt-in (`sync-version.js --hook-count 27 --opt-in-count 13`).
Honest limit: `context-budget` deliberately exits on `agent_id` (it can only read the PARENT transcript),
so it cannot measure a foreman's own context; foreman budget is enforced through D1's Bash cap →
mandatory handoff exit, and D3's rule. BACKLOG: measure subagent context once CC exposes the subagent
transcript in the hook payload.

### D3 — foreman lifecycle rule (prose; l4/l5/l6 SKILL.md + level-front-door.md)
一刀一命: a foreman owns exactly ONE admitted deliverable; it writes its handoff and ends its turn when
that deliverable is integrated, when the Bash cap is reached, or when its own tool-call count passes the
soft ceiling — never "resident", never waiting for the next assignment. Depth-0 spawns the next foreman
per deliverable. Takeover read-list cap (digest #5): the brief for THIS cut only; ledgers split per lane;
no "read the whole file first" chains; a takeover brief may not exceed the cap the front-door states.
Profiles hash chain re-pinned (`profiles-hash-repin` procedure).

### D4 — `cost-tracker` cumulative cache-read report (digest #6)
At Stop, after appending rows, sum `cache_read_tokens` for the session from `costs.jsonl`; when it
crosses `cost_tracker.cache_read_warn_tokens` (default 50,000,000) and each doubling after, print one
stderr line naming the total and the session — user-visible at depth-0, which is where the money is.

### D5 — docs
`hooks/README.md` tiers, `settings.example.json`, `docs/ironlaw-to-gate-map.md`, CHANGELOG v2.35.15
(opt-in→default-on transition is a behaviour change: say so), BACKLOG rows, reply to cuda.

## Acceptance
- `hooks/tests/foreman-guard.test.sh`: no marker → allow; marker+no agent_id → allow; marker+agent_id →
  41st Bash denied, each polling pattern denied, background sleep allowed, Monitor denied, mode warn/off.
- Existing tests for the three hooks updated for default-on (the "disabled by default" cases become
  "opt-out" cases); `check-hook-inventory.test.sh` counts updated; full suite green; preflight 8/8.
- Dogfood: on this box, `/l4`-style marker + a fake agent_id payload through the real hook.

## Out of scope
- Measuring subagent context (needs CC payload support) — BACKLOG.
- Changing `model=[1m]` in users' settings — documented in the front-door as an operator setting, not
  enforced (dispatch-model-guard's `on_missing_model: ask` is the enforcement for inheritance).
