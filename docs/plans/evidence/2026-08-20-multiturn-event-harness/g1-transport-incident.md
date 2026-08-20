# Dispatch-1 transport incident + recovered G1 semantics (2026-08-20)

Policy stop `required_seat_transport_exhausted`; the tool recorded ZERO semantic content.
Root cause: depth-0 omitted `--timeout` → dispatch-plan-review DEFAULT **5m** killed both
high-effort seats. (Known lesson "effort=max needs 15-20m" was in memory and not applied.)

| Seat | Attempts | Classification | Actual cause |
|---|---|---|---|
| sol (codex, max, required) | 2 | `raw_binding_mismatch` | 5m kill before ANY stdout: scratch `stdout` 0 B, stderr = prompt echo only → empty raw → null reference → misclassified as binding mismatch (secondary infra wart, BACKLOG) |
| minimax (cc-shim, high, required) | 1 | success | Finished in ~3 min. Full verdict recovered: `g1-minimax-raw-recovered.log` |
| grok (grok, xhigh, optional) | 2 | `exit_failure` | 5m kill mid-exploration (narration shows it reading cited evidence docs) |

Contributing: seats tried to READ the plan's cited evidence paths (empty review workspace)
— burned clock hunting. R1 adds the §2.5 self-containment clause.

## Recovered G1 semantics (minimax): verdict STOP, 6 blocking + 1 non-blocking

Depth-0 adjudication — ALL ACCEPTED and folded into R1:

| # | Ruling folded into R1 |
|---|---|
| MH1 | Turn-2 → scope-expansion event; primary differencing FULL@3 vs OFF@3 (same prompts); FULL@1 comparison demoted to descriptive |
| MH2 | P1 smoke: per-turn event-count assertion BEFORE marker scoring; hooked-vs-unhooked reactivity diff; hooks-fire-without-behavior fixture |
| MH3 | Per-session hook-liveness replaces cross-fixture F2 dependency; outcome-table ordering fixed; both-arms-fire cell explicitly inadmissible |
| MH4 | Fixture paths + sha256 sealed in pre-registration.md before P1; OQ1/OQ2 resolved NOW (sonnet-only; k=3 fixed); red floor 2 hard |
| MH5 | F2 demoted to observational; rerunnable production guard = separate single-call probe outside this plan |
| MH6 | (non-blocking) survivor-threshold justification line + Board pre-route note added |
| MH7 | P1.5 signal pilot (≤6 calls) gates the 2×2; zero-fire → fall back to pre-2026-08-16 opus-5 production-transcript archaeology |

## Accounting

Tool-recorded semantic generations: 0. Out-of-band consumption: minimax's review (above) —
folded as EXTRA input to R1, not counted as a tool generation. State surgery per the
zero-consumption policy-stop precedent (claims cleared, clock restarted, policy artifact
renamed `policy-stop-transport-01.json`); re-dispatch is generation 1 carrying R1 at
`--timeout 20m`. The two-generation semantic cap then applies normally from there.

BACKLOG candidates filed by this incident: (a) timeout misclassified as raw_binding_mismatch
when raw is empty (classify exit/timeout FIRST, binding only when raw non-empty); (b)
dispatch-plan-review's 5m default is a footgun for max/xhigh seats — derive per-seat default
from effort tier.
