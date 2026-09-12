# QC panel — v2.36.28 (integration ledger, loud qc-panel, bounded-campaign marker supersession)

Run 2026-09-12 at depth 0, against `git diff origin/develop..develop -- schemas scripts src hooks references platforms`
(51,078 bytes) plus a depth-0-authored trusted spec. No implementer self-report reached any seat
(`dispatch-review.sh` has no parameter through which one could).

**Why this panel ran at all**: the three campaigns were blocked by the rail after their implementers
had committed, so none of them reached the rail's own review or QC panel. The pre-push qc-gate
refused the push for exactly that reason. A `QC-Verdict` trailer was NOT hand-written to satisfy it —
that would manufacture the evidence the gate exists to check. This panel is the real thing.

## Seats

All three are cross-family with respect to the implementer (codex / gpt-5.6-sol, family `openai`).

| Seat | Runner | Family | Verdict |
|---|---|---|---|
| GLM-5.2 | cc-shim @ glm | zhipu | SHIP-AS-IS |
| MiniMax-M3 | cc-shim @ minimax | minimax | FIX-THEN-SHIP |
| Qwen3.8-Max-Preview | qoderclicn | alibaba | SHIP-AS-IS |

## Adjudication — by re-derivation, not by vote count

### 🟠 MiniMax `mirror-drift-cli-js` — **REFUTED**

Claim: `platforms/codex/plugin/src/merge/cli.js` was not mirrored, so the platform copy emits
receipts missing the now-REQUIRED fields and v2.36.28 ships a broken producer.

Re-derived on the merged tree:

```
grep -c integrationLedgerFields src/merge/cli.js platforms/codex/plugin/src/merge/cli.js
  → 4 and 4
cmp -s src/merge/cli.js platforms/codex/plugin/src/merge/cli.js   → IDENTICAL
bash scripts/sync-codex-plugin-skills.sh --check                  → rc 0
```

The mirror hunk was also present in the diff the seat was given
(`+++ b/platforms/codex/plugin/src/merge/cli.js` at line 684, the same `@@ -417,6 +417,15 @@` hunk as
the canonical file), so the seat had the evidence and read it wrong. This is the failure mode already
recorded for this exact tuple in `.claude/review-loop-config.md`
(`reviewer_limitation: minimax-false-central-claim-5-of-6`); it now stands at 6 of 7. The limitation
is calibration telemetry, not a demotion — the seat's other two findings are sound.

### Verdict

`union-on-verified-critical`: zero verified critical findings, and the single 🟠 is refuted by
re-derivation. **PASS.** The 🔵 items below are follow-ups, not blockers, and each seat's own
exclusion rationale is preserved.

## Follow-ups recorded (not blocking)

- **`record-integration.js` synthesises `mode` for non-merge methods** (GLM 🔵 and MiniMax 🔵,
  independently). The schema makes `mode` required, and `mode` has no member meaning "no merge
  strategy was used", so an `apply+fresh-commit` receipt carries a cosmetically wrong `ff-only`.
  Both seats excluded it as cosmetic; depth-0 agrees it is not a defect in this version, and notes the
  honest fix is a nullable `mode` for non-merge methods — a change to `mode` that this plan forbade.
- **No writer-side `source_sha != accepted_sha` enforcement** (MiniMax 🔵, self-excluded). Its own
  rationale is correct: `ff` legitimately preserves the same SHA, so the rule is per-method and the
  schema does not express distinctness either. The central risk is covered by the test asserting the
  real merge produces different values.
- **No regression fixture pins the model-only legacy roster** (GLM 🔵). The seat re-derived that the
  behaviour is baseline-identical by construction (`METADATA_CONFIGURED=false` yields the same silent
  `qc_panel_seats_complete=false` the old arity path produced, exit 0, stdout JSON intact) — so
  nothing is broken, but the contract is unpinned.
- **`source_sha` uses an inline pattern while `accepted_sha` delegates to `$defs/gitOid`** (Qwen 🔵).
  They would diverge if `gitOid` ever narrowed.

## What no seat raised, and depth-0 checked separately

The P5 placement risk named in the spec: the skip sits inside the `CAMPAIGN_PROJECTION_BOUND -ne 1`
branch, so `check_marker_campaign_admission_bridge` in the `else` branch is unreachable from it and
`check_mission_enforcement_gate` still runs on the same path. The predicate is consulted after
`run_campaign_contract_preflight` has re-derived the supplied digest and verified the seal.
