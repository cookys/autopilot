# Cursor Agent as a read-only transport fallback for reviewer-class seats

**Plan**: [`docs/plans/2026-09-02-cursor-transport-fallback.md`](../../plans/2026-09-02-cursor-transport-fallback.md)
**Started**: 2026-09-02
**Target version**: 2.36.0 (a new user-facing capability lands via existing skills, so this may
settle at PATCH — decided at L-5 against the semver table, not now)
**Branch**: `feat/cursor-transport-fallback`
**Status**: Phase 1 — in progress

## Why

A required reviewer-class seat whose *transport* dies takes the whole frozen round with it. The
recoveries available today either cost a semantic generation (and generation 2 is the hard cap) or
break the manifest freeze. Neither is right when the seat's model was never the problem.

Routed from TWGameProject via fleet peer `twgs-revival-twgs-dev`
(msg `msg_01M1G1JA5ZTH45Y5R7D77ZVFKC`); authorized by the operator in the autopilot session
2026-09-02. Peer transport is never authorization — the operator authorized this directly.

## OKR

**Objective**: a transport failure on a reviewer-class seat can be retried over a second,
explicitly-authorized transport without changing what the round means.

KR1–KR7 are stated in the plan §2 and are the acceptance conditions for this project.

## Phases

| # | Phase | Size | Status |
|---|-------|------|--------|
| 1 | Seat-manifest schema: optional frozen `transport_fallback` | S | in progress |
| 2 | `dispatch-plan-review.js` attempt loop + dual-identity receipts | M | not started |
| 3 | `dispatch-review.sh` / `dispatch-author.sh` fallback surface + workspace trust | M | not started |
| 4 | Negative-test suite (8 classes, each with a planted-negative control) | M | not started |
| 5 | Stage-0 probes + reviewer-class qualification on `cursor-grok-4.6-xhigh` (**the only phase that spends**) | H | not started |
| 6 | Conditional resolver admission (iff pass) + capability record + docs + release | S | not started |

## Progress log

- **2026-09-02** — project opened. Plan drafted from a live survey of the existing cursor rail
  (shipped by the [predecessor plan](../../plans/2026-08-26-cursor-cli-adaptor.md), Phases 1–4) and
  of `dispatch-plan-review.js`'s attempt/generation split. Three facts settled before any code:
  `cursor-agent 2026.08.25-3e8eec8` is installed on this host, `cursor-grok-4.6-xhigh` is a real
  enabled id, and cursor currently has **no** roster admission (`UNQUALIFIED_RUNNERS="cursor"`).
  The peer's reported `dispatch-plan-review.js` comment-parse bug was checked and is **not present
  upstream** — it was fixed in v2.34.41 and is guarded by `scripts/check-js-syntax.js`; the peer saw
  a v2.34.40 install cache.
