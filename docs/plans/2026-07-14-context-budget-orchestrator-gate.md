# Context-Budget Hook (A2) + Orchestrator-Edit Gate (A1)

**Date**: 2026-07-14
**Status**: ✅ Shipped in v2.32.26 — merged as 17ec44b (3-family hetero panel: Gemini 3.5 Flash High + GPT-OSS 120B + MiniMax-M3, all FIX-THEN-SHIP, findings folded in; SPIKE-1 resolved empirically)
**Origin**: 6-researcher transcript study of TWGameProject + PEACE (2026-07-14): 96%+ of all tokens are cache_read on ever-growing depth-0 sessions (max 1.12B tokens / 94.7h single session); orchestration:implementation ≈ 30:1; nominal /l5 depth-0 did 48–54 inline Edits. The economic model of /l4-/l6 leaks at depth-0; these two hooks are the forcing functions the "pure orchestration" prose never had.

## Principle

Context cost ≈ context length × remaining messages (quadratic in session length). A2 caps the N² curve by forcing session splits at measured context thresholds; A1 keeps the Δ (work products) off the long-lived depth-0 context by denying inline edits in orchestrator mode. Memory-hierarchy discipline, mechanically enforced.

## SPIKE-1 (resolved, 2026-07-14, CC 2.1.208)

Empirical hook-payload probe (headless `claude -p` + capture hook; main Bash vs subagent Bash):

| Field | main fire | subagent fire |
|---|---|---|
| `session_id` | X | SAME X |
| `transcript_path` | main jsonl | SAME main jsonl (not sidechain) |
| `agent_id` / `agent_type` | **absent** | **present** (`a326…` / `general-purpose`) |
| env | identical | identical (env cannot discriminate) |

Consequences: (1) A1 identity = `agent_id` **absence** ⇒ depth-0; (2) A2's budget signal structurally reads depth-0's transcript even on subagent fires; (3) session-id-keyed marker WOULD have denied foreman edits without the agent_id check. Caveat: empirical fields, not documented contract — canary test pins the schema; failure direction is fail-open (E1 backstop).

## A2 — `hooks/context-budget.js` (+ `context-budget-lib.js`)

**Signal**: PostToolUse stdin `transcript_path` → bounded BACKWARD line-scan (start 64KB, grow to 5MB cap; cap-hit ⇒ fail-open + log) for the last assistant `message.usage`; context ≈ `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Raw total, NOT cost-weighted (cache_read is in-context; cheap ≠ absent). Attribution: reads ONLY the depth-0 transcript — worker CLIs never write there; Claude-subagent usage lands in sidechains.

**Tiers** (config: `~/.autopilot/config.json` `context_budget: {t1,t2,mode}`; defaults t1=100k, t2=150k, mode=warn):
- **T1 advisory** (≥t1): stderr nudge "context Xk — plan a milestone checkpoint/handoff". Throttle: once per 20 calls. Below T1 the transcript parse runs at most every 5 calls; at/after T1, every call.
- **T2 escalated advisory** (≥t2): (a) direct the model: write `autopilot:handoff` doc NOW, stop taking new work; (b) user-visible line: "/clear or restart after handoff lands". PostToolUse cannot deny and /clear is a USER action — no pretend enforcement. Repeat every 10 calls.
- **T3 block** — DEFERRED to a follow-up release (see Backlog note). v1 ships warn-only tiers; deny semantics (handoff structural check, anti-spiral give-up, new-dispatch refusal) land only after warn-mode + synthetic-adversary calibration data exists.

**State**: `~/.autopilot/context-budget/<session-id>.json` (cursor + last-fire counters), atomic tmp+rename writes (corruption-free; no flock — subagent fires are skipped via `agent_id`, so concurrent same-session writers are not a practical path; a lost counter update would only delay a throttle window), corrupt ⇒ reset-and-continue. Host-stable path (NOT TMPDIR — docker-exec visibility).

**Protocol prose** (level-front-door.md): /l4-/l6 depth-0 MUST handoff at phase boundaries once T1 has fired; dispatch outputs land in files, depth-0 reads only emitted JSON summaries.

## A1 — `hooks/orchestrator-edit-gate.js` (+ `orchestrator-edit-gate-lib.js`)

**Marker**: `scripts/session-mode.js set|clear|status --level lN` writes `~/.autopilot/session-mode/<session-id>.json` `{level, repo_root, started_at, expires_at}` (TTL 24h). /l4 /l5 /l6 entry prose runs `set`; `--solo` and /l3 run `set --level l3` (gate-off record, overwrites stale l5 marker in same session); finish-flow closing runs `clear`. No marker or expired ⇒ hook no-op.

**Gate** (PreToolUse `Edit|Write|NotebookEdit`): deny (exit 2) iff ALL:
1. marker live for THIS session_id, level ∈ {l4,l5,l6};
2. payload has NO `agent_id` (= depth-0 itself; subagents/foremen pass — SPIKE-1);
3. target inside marker's `repo_root` OR inside any registered dispatch worktree (realpath containment, symlink-safe);
4. target not allowlisted: `docs/projects/**`, `.claude/**`, `.autopilot/**`, scratchpad/TMPDIR, `docs/plans/**`.

Deny message: dispatch instead (dispatch-hetero / Agent tool); escape = `--solo` re-entry or user config toggle. Modes: `warn` (log only, default at launch) / `block` / `off`.

**Declared limits + backstops**: Bash-mediated writes not caught (write-regex is a losing game — rejected 3-for-3 by panel); backstop = E1 post-hoc dispatch-manifest merge gate (separate BACKLOG item). Handoff QUALITY not provable at hook level. Warn-mode calibration is a false-positive FLOOR — add ≥1 synthetic-adversary session before promoting to block.

## Panel adjudications (recorded)

- Thresholds ABSOLUTE + config-resolvable (not % of model window): window-relative budgets institutionalize the pathology. (vs GPT-OSS/MiniMax)
- Raw context total as signal (not `input − cache_read`): cache_read IS in-context on Anthropic semantics. (vs MiniMax)
- T3/Bash: no write-regex ever; "refuse NEW dispatch at T3" accepted in principle, deferred with T3.
- Anti-spiral (Gemini): any future deny tier gives up LOUDLY after 3 unheeded denies — a gate that argues with the model burns the tokens it exists to save.
- A1/A2 stay separate scripts + separate state; shared pure-function lib only (single-crash isolation).

## Phases

| # | Deliverable |
|---|---|
| P0 | `scripts/session-mode.js` (set/clear/status, TTL, atomic tmp+rename) + black-box CLI tests |
| P1 | A2: `context-budget-lib.js` (pure: backward-scan parser, tier decision, throttle) + `context-budget.js` wrapper + tests (incl. >64KB-line fixture, corrupt-state reset, SPIKE-1 canary) |
| P2 | A1: `orchestrator-edit-gate-lib.js` (pure: marker validity, identity, containment, allowlist) + `orchestrator-edit-gate.js` wrapper + tests (foreman-passes case, WHERE-not-WHO case, stale-marker case) |
| P3 | Wiring: hooks.json (PostToolUse `*` + PreToolUse Edit|Write|NotebookEdit), opt-in-manifest (+2), hooks/README tier table, marker write-points in l4/l5/l6/ceo-agent prose + finish-flow clear |
| P4 | Docs/release: CHANGELOG (opt-in paragraph), version 2.32.25→2.32.26, sync-version --hook-count, check-hook-inventory --check, README badges parity, preflight |

## Success criteria

- `node --test hooks/context-budget.test.js hooks/orchestrator-edit-gate.test.js` green; red-green provable (tests fail against absent libs).
- `bash hooks/tests/all-hooks-fail-open.test.sh` still green (both hooks fail-open on garbage stdin).
- `node scripts/check-hook-inventory.js --check` + `scripts/preflight-release.sh` pass.
- Live probe: with hook enabled + marker set to l5 in a scratch session, depth-0 Edit denied in block mode / warned in warn mode; subagent Edit passes (SPIKE-1 replay).

## Out of scope (BACKLOG'd)

- T3 deny tier + handoff structural checks + new-dispatch refusal (trigger: warn-mode calibration data from ≥3 real /l5 runs).
- E1 dispatch-manifest merge gate (protocol-compliance verification).
- B1/B2 review-path fixes (diff-only enforcement, delta re-review) — separate plan.
- Per-repo `.claude/context-budget-config.md` resolver ladder (v1: user-global config + env only).
