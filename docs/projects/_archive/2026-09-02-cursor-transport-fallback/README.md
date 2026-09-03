# Cursor Agent as a read-only transport fallback for reviewer-class seats

**Plan**: [`docs/plans/2026-09-02-cursor-transport-fallback.md`](../../plans/2026-09-02-cursor-transport-fallback.md)
**Started**: 2026-09-02
**Version**: 2.35.8 — PATCH. The semver table reserves MINOR for a new **skill** or **agent**; this
adds a manifest field, rail behavior and tests to existing surfaces, so it is a PATCH even though it
is a new capability.
**Branch**: `feat/cursor-transport-fallback`
**Status**: Phases 1-4 + 6 shipped; **Phase 5 BLOCKED** (cursor is not admitted)

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
| 1 | Seat-manifest schema: optional frozen `transport_fallback` | S | ✅ done |
| 2 | `dispatch-plan-review.js` attempt loop + dual-identity receipts | M | ✅ done |
| 3 | `dispatch-review.sh` / `dispatch-author.sh` fallback surface + workspace trust | M | ✅ **already existed** — the cursor rail's `-p --trust --mode ask` + scratch cwd + separate stderr is shipped and pinned by `dispatch-review-author-cursor.test.sh`. Nothing to build; the finding is that its read-only posture is *cooperative*, not enforced (see below) |
| 4 | Negative-test suite | M | ✅ done — `hooks/tests/plan-review-transport-fallback.test.sh`, 56 assertions, 2 planted-negative controls |
| 5 | Reviewer-class qualification on `cursor-grok-4.6-xhigh` | H | 🔴 **BLOCKED — cannot run.** Not money, not authorization |
| 6 | Resolver admission + capability record + docs + release | S | ✅ docs + release shipped; **admission NOT added** (Phase 5 did not pass, so per the conditional rule it must not be) |

## Progress log

- **2026-09-02** — project opened. Plan drafted from a live survey of the existing cursor rail
  (shipped by the [predecessor plan](../../plans/2026-08-26-cursor-cli-adaptor.md), Phases 1–4) and
  of `dispatch-plan-review.js`'s attempt/generation split. Three facts settled before any code:
  `cursor-agent 2026.08.25-3e8eec8` is installed on this host, `cursor-grok-4.6-xhigh` is a real
  enabled id, and cursor currently has **no** roster admission (`UNQUALIFIED_RUNNERS="cursor"`).
  The peer's reported `dispatch-plan-review.js` comment-parse bug was checked and is **not present
  upstream** — it was fixed in v2.34.41 and is guarded by `scripts/check-js-syntax.js`; the peer saw
  a v2.34.40 install cache.
- **2026-09-02 — Phase 5 blocked, on evidence that already existed.**
  `scripts/qualification-review-provider.js` refuses `kind === 'cursor'` unconditionally, before
  building argv, because an exam transport must be able to force a tool-deny and cursor-agent has
  none. That refusal rests on an 18-probe live adversarial run
  (`docs/plans/evidence/2026-08-29-cursor-containment-probe/`) against **2026.08.25-3e8eec8, the
  exact build installed here**: `permissions.deny: ["*"]` silently no-ops, enumerated deny is
  allow-by-omission (TodoWrite and WebSearch ran uncontained, WebSearch making a real outbound
  call), `--sandbox` is AppArmor-gated, and `--mode ask` is cooperative and overridden by the
  `--force`/`--trust` that headless `-p` requires. An exam prompt is adversarial by construction and
  a reviewer seat reads an untrusted diff, so the refusal is correct and was not re-litigated.
  **Consequence**: `UNQUALIFIED_RUNNERS="cursor"` is unchanged and cursor gains no admission here.
- **2026-09-02 — a caveat this surfaced about the shipped rail.** `dispatch-author.sh`'s cursor
  branch runs `-p --trust --mode ask` in a scratch cwd. Per the same probe, `--mode ask` is
  cooperative and `--trust` is itself bypass-class, so that posture is **cooperative, not
  enforced**. Now recorded in `references/hetero-dispatch.md`. Not a regression — but it was easy to
  read as stronger than it is.
