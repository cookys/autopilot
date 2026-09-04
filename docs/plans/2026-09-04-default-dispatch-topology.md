# Default dispatch topology — brain up, hands down

Status: **design + rollout proposal, awaiting owner decisions (§8)**. Requested 2026-09-04 by the
owner via the revival.3d CEO on cuda (fleet msg `msg_01M1MZ55SZFJYA5A68EW9PF8QW`). No code in this
commit.

## 0. Context / thesis

revival.3d evidence (cuda memories `quota-opus-foreman-cost`, `standing-foremen-burn-quota`,
`foreman-cost-is-the-polling-loop`; autopilot `docs/plans/2026-09-04-foreman-cost-discipline.md`):
a dozen implementation cuts in one day ran on sonnet while standing foremen burned ≈$1,180 in a day
and a half. v2.35.15 put the *polling* burn behind gates (`foreman-guard`, cost hooks default-on).
This plan is the second half: **where implementation labor lands by default**.

Thesis: the topology is a fixed shape, derived per host from what is installed and qualified —
not a per-project hand-written roster.

| Tier | Who | May do | May not do |
|---|---|---|---|
| **T0 brain** | depth-0 session model (fable/opus) | brief, decompose, adjudicate, merge | edit code, run the test loop, poll |
| **T1 hands** | cheapest qualified hetero rung → next rung; if no hetero: haiku → sonnet | implement, run verify-cmd, repair on red | pick its own model, escalate itself |
| **T2 judge** | cross-family qualified reviewer (existing qc) | verdict | anything else |

What already exists (do not rebuild): `implementer_ladder` in `review-loop-config.md` (rungs
`engine/effort@runner`, climb one rung on red); `dispatch-model-guard` (default-on, guards `fable`,
asks on missing `model:`); `foreman-guard` (Bash cap 40, polling deny); `cost-tracker`
(`~/.claude/metrics/costs.jsonl`, per-turn `model` + `cost_usd`); `engine-scorecard seat-status`
(qualified seats, strike-decayed); `lib/runner-binary.js` (which runners are installed); ceo-agent
already states "Fable is NEVER dispatched; implementers are sonnet-class or hetero flash-class".

## 1. Problem

Three gaps make the stated policy a wish rather than a default:

1. **The ladder is opt-in and hand-written.** A fresh project's template has one rung
   (`gpt-5.3-codex-spark`) and `unit_class: judgment` starts at rung **1**, so "low first" only
   happens if someone writes it. Nothing derives the ladder from the host.
2. **All-Claude default is brain-does-hands.** `scripts/resolve-dispatch.sh` `DEFAULTS[implementer]`
   is **opus**; `references/model-routing.md` says the same. dev-flow L-size dispatches inherit it.
   `dispatch-model-guard` guards only `fable`, so an opus implementer passes silently.
3. **No cost fuse.** `costs.jsonl` has the numbers but nothing sums a day or blocks anything.
   The $1,180 was visible only after a human grepped the ledger.

## 2. KRs

- KR1: on a host with ≥1 qualified hetero implementer seat, a fresh `/l5` run's first cut lands on
  the cheapest qualified rung with **zero** project config edits (topology auto-derived).
- KR2: on a host with no hetero engine, no `Agent` dispatch with `mode: default` lands on
  opus/fable without an explicit operator ask (guard: `ask` interactive, refusal headless).
- KR3: every dispatch prompt's first line names the engine (`Engine: <model>@<runner> effort=<e>`),
  and mismatch with the `model:` parameter is a deny.
- KR4: a per-host daily high-tier spend threshold exists, is visible (`cost-digest`), and past it
  the high-tier session cannot run implementation-shaped tool calls (Edit/Write/Bash-with-side-effects).
- KR5: rollout leaves every host's `costs.jsonl` digest showing brain-tier spend as brief+verdict
  turns only, for one full week.

## 2.5 Global Constraints (verbatim into every dispatch)

- ADR-0001: topology facts are re-derived from installed binaries + scorecard, never trusted from a
  feed or a prior receipt.
- A missing/garbage config value fails **closed toward the cheaper tier**, never toward the brain.
- Opt-out knobs exist for every new gate (env + `~/.autopilot/config.json`), and every opt-out is
  logged (evidence-discipline: a gate that can be silently off is a gate that is off).
- No new severity vocabulary; no trust machinery.

## 3. File-structure map

| File | Change |
|---|---|
| `scripts/resolve-dispatch-topology.js` (new) | derive host topology JSON: installed runners × qualified implementer seats (seat-status, `admission_status=qualified`) × endpoints.env → ordered `implementer_ladder` cheapest-first; claude fallback ladder `haiku/…@claude-native, sonnet/…`; judge seat from qc config. Writes `~/.autopilot/topology.json`; `--check` diffs against the cached file |
| `scripts/resolve-review-loop.sh` | `implementer_ladder: auto` (new default in template) expands to the host topology; explicit list still wins. Rung-0 start becomes the default for both `unit_class` values (§8 Q2) |
| `project-config-template/review-loop-config.md` | `implementer_ladder: auto`; doc rows |
| `scripts/resolve-dispatch.sh`, `references/model-routing.md` | `implementer` → **sonnet**; new role `hands` → haiku (mechanical cuts); `sub-orchestrator` stays opus but is the *only* opus default |
| `hooks/dispatch-model-guard.js` + template | `guarded_models` default `fable,opus` **when `mode` ≠ `plan`** (implementation-shaped); plan-mode opus (reviewer/debugger) unaffected. New `require_engine_header: on` — deny when prompt line 1 is not `Engine: <model>…` matching `tool_input.model` |
| `hooks/cost-fuse.js` (new, PreToolUse `Bash\|Edit\|Write\|MultiEdit`) | sum today's `cost_usd` from `costs.jsonl` by tier; if the *current session model* is high-tier and high-tier spend ≥ threshold → deny with reason "brief and dispatch to hands"; read-only Bash allowed (reuse foreman-guard's lexical classifier). Default `warn` for one week, then `block` |
| `scripts/cost-digest.js` (new) | per-day × model × session table over `costs.jsonl`; `--fleet` reads sibling hosts' digests over the relay (later) |
| `skills/{dev-flow,ceo-agent,l3,l4,l5,l6}/SKILL.md`, `skills/ceo-agent/references/level-front-door.md` | one canonical "topology" paragraph in front-door; the others link. Brief header rule. l3: brain writes the brief and dispatches a sonnet hands-agent inline instead of editing itself (§8 Q3) |
| `profiles/hook-classes.json`, catalog hashes | classify `cost-fuse` |
| `docs/scripts-inventory.md`, `CLAUDE.md` group list, `hooks/hooks.json` | wiring (all four, per CLAUDE.md rule) |

## 4. Phases

| # | Phase | Size | Acceptance |
|---|---|---|---|
| P0 | **Measure first**: `cost-digest.js` over existing `costs.jsonl` on aimax395 + cuda; publish the day-by-tier table in this plan's evidence dir | S | the $1,180 shape is reproduced from the ledger, not from memory; threshold in P3 is chosen from this table |
| P1 | **Topology resolver** + `implementer_ladder: auto` + rung-0 default | L | KR1 on aimax395 (18 qualified seats: expect ladder `gemini-3.8-flash low → medium → high`, `muse-spark`, `qwen3.8-flash-next`, `grok…`); on a scratch host with no runners → claude fallback ladder; unit tests for both; `--check` in `sync-all.sh` |
| P2 | **Routing flip + guard tightening + brief header** | S | KR2/KR3; `dispatch-model-guard.test.sh` gains mode-aware and header cases; `resolve-dispatch.test` pinned to sonnet |
| P3 | **Cost fuse** warn-mode default-on; block after calibration week | S + 1 week | KR4; fuse fires on a synthetic ledger in tests; real-ledger warn lines observed on ≥2 hosts |
| P4 | **Skill text + front-door canonical paragraph**; l3 posture per Q3 | S | prose↓ engine↑ ratchet holds; slash-entry probes green |
| P5 | **Fleet rollout**: `dev-update.sh` on each host → `resolve-dispatch-topology.js` → commit `.claude/review-loop-config.md` only where the host differs from `auto` | S per host | each host's `topology.json` attached to evidence; KR5 after one week |

## 5. Test / validation

Script-gated: resolver unit tests (installed-runner fixtures, seat fixtures via `ENGINE_*_DIR`
redirection — never the real store, `run.sh` sha guard already enforces); guard tests; fuse tests on
a synthetic `costs.jsonl`. Human-gated: the one-week KR5 digest per host, read by the owner.

Negative controls (evidence-discipline): delete the fuse's threshold → test must go red; point the
resolver at an empty store → ladder must be the claude fallback, never empty; a hand-written
`implementer_ladder` with an unqualified rung → resolver refuses (exit 3), not warns.

## 6. Risks + inversion

- **Hands too weak, brain re-enters.** Guaranteed if the fuse denies without a path: the deny reason
  must name the exact next action (dispatch `hands` with the brief). Climb-on-red already exists.
- **Ladder derived from provisional seats.** Disk view projects qualified→provisional by design; the
  resolver must use `seat-status` (admission projection), not `ladder`/`report`.
- **Headless `ask` = refusal** (verified 2026-09-04): fine for the guard; the fuse must never `ask`.
- **Fleet drift.** Hosts on old plugin versions keep opus implementers; P5 is per-host and logged.
- **Threshold theater.** A threshold nobody trips is decoration; P0's table sets it at the p75 of
  *observed* good days, not a round number.

## 7. Out of scope

Tuning which hetero engine is "best"; new qualification exams; per-project custom tiers beyond the
existing override files; cross-host quota pooling.

## 8. Open questions (owner)

1. **Daily high-tier threshold**: proposed default USD 150/host/day for opus+fable combined, chosen
   after P0; override in `~/.autopilot/config.json`.
2. **Rung-0 for `judgment` units too?** Owner said "low 先試"; proposal: yes, rung 0 always, climb on
   red. Cost: one extra cheap failed attempt on hard units.
3. **/l3 fate**: keep as the explicit "brain works inline" escape (fuse still applies) or convert to
   "brain briefs, sonnet hands inline"? Proposal: convert; keep `--solo` as the only inline escape.
4. **Unqualified hetero engines as rungs?** Proposal: no — installed-but-unqualified engines appear
   in the topology as `candidates_to_qualify`, never in the ladder.

## Review log

R0 author: autopilot session on aimax395, 2026-09-04. No review yet — this is a proposal for the
owner; plan review (rubric-frozen, ≤2 generations) runs after §8 answers.
