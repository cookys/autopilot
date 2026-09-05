# statusline → hook live context feed (v2.36.1)

> Plan: [`docs/plans/2026-09-05-statusline-live-context-feed.md`](../../plans/2026-09-05-statusline-live-context-feed.md) · Branch: `feat/v2.36.1-statusline-live-context-feed` · Plan loop: frozen 2026-09-05 (g2 terminal, checker exit 0 — [`ledger/plan-review/README.md`](ledger/plan-review/README.md))

## Project Goal

> **Final goal**: autopilot's context gates act on the real model window and real per-subagent usage that Claude Code already publishes to the status line, instead of inference; depth-0 self-research is nudged toward delegation; every per-tick/per-call state file lands in RAM when a tmpfs exists.
> **Success criteria**: KR1–KR5 of the plan — (1) 1M session at 150k gets no T2, 200K session still does, red-before-green test; (2) foreman at `tokenCount ≥ T2` denied by `foreman-guard.js`, one real l4 run in the ledger; (3) depth-0 ≥ 8 consecutive read-class calls gets the delegate nudge, block only on guarded live model in `block` mode; (4) fake-`findmnt` ext4 test proves the SSD fallback + one warning; (5) full suite green per deliverable.
> **Scope boundary**: IN — codeforge live-file writer (two files, one writer each), `scripts/lib/live-state-dir.js`, `context-budget.js`, `foreman-guard.js`, new `depth0-delegate-gate.js`, hook-classes + catalog sha repin, docs/inventory/CHANGELOG, PATCH bump 2.36.1. OUT — depth-0 deny tier, status-line rendering changes, fleet rollout, Windows, non-codeforge status lines (BACKLOG candidate), `check-context-window.js`.

## Scope completeness audit (L-1.5)

| Dimension | Covered by |
|---|---|
| Source + tests | P1 (codeforge), P2, P3 |
| User-facing docs | P4.1 hooks/README, settings.example, codeforge README |
| Config templates | P4.1 settings.example.json (`subagentStatusLine`, new knobs) |
| CHANGELOG / version bump / grep sync | P4.3 (`sync-version.js` 2.36.1, hook count 29) |
| Dependent repo | codeforge P1 ships first, own commit + one hetero seat review |
| Credit | none absorbed |
| Dogfood target | this host (aimax395) is the P0 spike host and the P2 real-l4-run host |

User-stated requirements ledger: RAM not SSD → KR4/§2.5; probe mount type never assume → §2.5; fake-findmnt fallback test → KR4/P1.1/P2.1; plan through hetero loop → done; gate depth-0 self-research → KR3/P3.

## Deliverables (Mission admission READY, deliverable_count 1; phases are coverage inside it)

| Phase | Size | Status | Evidence |
|---|---|---|---|
| P0 spike: real payloads + id mapping | S | pending (needs owner OK to wrap `~/.claude/settings.json` statusLine for one tick) | `ledger/p0/` |
| P1 codeforge live writer | L (codeforge repo) | pending | codeforge commit + `ledger/p1/` |
| P2 autopilot consumers | L | pending | `ledger/p2/` |
| P3 depth-0 delegate gate | L | pending | `ledger/p3/` |
| P4 docs / inventory / version | S | pending | `ledger/p4/` |

## Progress

| Date | Event |
|---|---|
| 2026-09-05 | L gates passed (admission READY), plan written, plan loop g1 (9 blockers) + g2 (4 residual) folded, freeze checker exit 0, branch created |

## Decisions

- Two live files, one writer each (g1 R4/R5): no read-modify-write anywhere.
- Delegate gate warns without a live file by design (g2 R12 repair refuted): the owner's requirement is a gate in plain sessions.
- Freeze ran against the reviewed bytes with the post-terminal fold recorded as a delta (plan-review README).
