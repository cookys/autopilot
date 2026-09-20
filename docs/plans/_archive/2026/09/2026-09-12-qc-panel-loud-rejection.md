# Plan — The qc-panel seat validation says what it rejected

> Status: **R0 — DRAFT** (depth-0, 2026-09-12) · Deliverable node: `p4-qc-panel-loud-rejection` ·
> Shared context: [`2026-09-12-integration-ledger-and-marker-gates.md`](2026-09-12-integration-ledger-and-marker-gates.md)

## 1. Problem

`scripts/resolve-review-loop.sh:729-750` sets `QC_PANEL_SEATS_COMPLETE="false"` at **four** sites —

1. an arity mismatch between the `QC_PANEL`, `QC_PANEL_RUNNERS`, `QC_PANEL_EFFORTS` and
   `QC_PANEL_ENDPOINTS` arrays;
2. per-seat runner not in the allowlist;
3. per-seat effort not in `low|medium|high|xhigh|max`;
4. per-seat endpoint neither `@none` nor `^[A-Za-z0-9_]+$`

— and **none of them emits anything**. `QC_PANEL_SEATS_JSON` then stays `[]`,
`cross_family_satisfied` goes false, and a downstream `--enforce` BLOCKs naming none of it. Thirty lines
below, `reviewer_runner` (`:768`) echoes the offending value with the full allowlist and exits 3 for the
same class of input.

The peer's own instance is already fixed here — `kimi` and `opencode` ARE on the panel allowlist at
`:739`; they were reading the 2.34.5 plugin cache. The **structural** complaint is live, and the peer
counted three sites where there are four.

## 2. Decision, stated here rather than left to the implementer

An incomplete panel exits **3 unconditionally**, not only under `--enforce`.

Measured basis: every sibling config validation in this file — `plan_review` (`:433`), `hetero_review`,
`plan_reviewer_runner`, `plan_deep_reviewer_runner`, `plan_reviewer_effort` (`:441-452`),
`reviewer_runner` (`:768`), `implementer_runner` (`:779`) — exits 3 with no `ENFORCE` guard, because
`--enforce` governs the *policy verdict* (BLOCK, `:1362-1365`), not *input validity*. Panel seats are
input validity. Two policies for one class of input is the defect, not a feature.

## 3. Scope

`scripts/resolve-review-loop.sh` only, plus its codex mirror and
`hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh`.

## 4. Out of scope

The panel allowlist membership itself. No runner is added or removed by this deliverable.

## 5. Phase

Each of the four sites emits to stderr in the shape `:768` already uses — the offending value **and**
the accepted set — then the incomplete panel exits 3. The arity site names which array disagrees and
both lengths; a message that says only "panel incomplete" fails this plan, because that is the same
verdict-without-operands the current code already gives.

## 6. Acceptance

```
scripts/resolve-review-loop.sh --config <fixture: qc_panel runner "nope">    # exit 3, stderr contains
                                                                             #   "nope" AND the allowlist
scripts/resolve-review-loop.sh --config <fixture: qc_panel effort "turbo">   # exit 3, stderr contains "turbo"
scripts/resolve-review-loop.sh --config <fixture: endpoint "bad endpoint!">  # exit 3, names the endpoint
scripts/resolve-review-loop.sh --config <fixture: 3 models, 2 runners>       # exit 3, names both lengths
scripts/resolve-review-loop.sh --config <fixture: valid 3-seat panel>        # exit 0, qc_panel_seats
                                                                             #   has 3 entries
bash hooks/tests/resolve-review-loop.test.sh                                 # unchanged, still green
bash scripts/sync-codex-plugin-skills.sh --check
```

The last two matter most: the green case proves the change did not turn a working panel into an exit-3,
and the existing suite proves no sibling validation was disturbed.

## 7. Acceptance IDs

- `p4-panel-seat-rejection-names-the-value`
- `p4-panel-arity-mismatch-names-both-lengths`
- `p4-panel-incomplete-exits-3`
