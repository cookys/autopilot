# Official qualification defaults — ship the administrations, ask the consumer once

Target version: **v2.34.36** · Plan: [`docs/plans/2026-08-23-official-qualification-defaults.md`](../../../plans/2026-08-23-official-qualification-defaults.md)
Contract: [`references/qualification-defaults.md`](../../../../references/qualification-defaults.md)

## Project Goal

The autopilot roster has been officially administered — 17 administrations across three roles, 11
QUALIFIED and 6 honest FAILED — and every one of them was trapped in the maintainer's user-local
store. A consuming repo enabling a heterogeneous role therefore had two bad options: re-run the
whole roster, or route unqualified.

Ship those administrations **as defaults**, with the administration environment fully disclosed,
and ask the consuming repo once: adopt, or self-qualify here.

Board-fixed design points (not re-debated in this project):
1. Defaults carry full administration-environment disclosure — official environment ≠ user
   environment; disclose, never hide.
2. Downgrade is accumulated mechanical no-confidence only; `expires` stays advisory.
3. ADR-0001: 「簽署」ships as DISCLOSURE (provenance + evidence pointers), never attestation.
4. Package what the store holds for the in-scope rows — FAILED rows included, they are routing
   information.

## Scope completeness audit (dev-flow L-1.5)

| Board deliverable | Where it landed |
|---|---|
| Versioned, schema-validated defaults artifact, script-generated | `references/official-qualification-defaults.json` + `.recipe.json`, `schemas/official-qualification-defaults.schema.json`, `scripts/build-qualification-defaults.js` |
| Consumer adoption flow (one-time question + mechanical adoption) | `scripts/adopt-qualification-defaults.js`; `skills/onboard/SKILL.md` §5.6; `skills/engine-onboarding/SKILL.md` Stage 0.5 |
| Strike interplay (seat-scoped, remedy on requalify_required) | `scripts/engine-scorecard.js` (`remedy` on the seat projection); `references/strike-decay.md` § "Adopted official defaults are ordinary strike targets" |
| Sweep-script formalization | `scripts/qualification-sweep.sh` (`--plan` deterministic/free, `--execute` spends) |
| Tests incl. planted negatives | `hooks/tests/qualification-defaults.test.sh`, `hooks/tests/qualification-defaults-adoption.test.sh`, `hooks/tests/qualification-sweep.test.sh` |
| Docs | this file, the plan, `references/qualification-defaults.md`, CHANGELOG, BACKLOG, INDEX |

Out of scope (per the run brief): administering any new qualification; planner/explorer suites;
trust machinery of any kind; changing strike-decay semantics.

## Phases

1. **Artifact + generator** — recipe (selection + recorded exclusions), `build-qualification-defaults.js`,
   determinism contract (no wall-clock), `--check` anti-hand-edit gate, JSON Schema.
2. **Adoption** — `adopt-qualification-defaults.js` (`list` with disclosure, `adopt` through
   `engine-scorecard.js record`), provenance object, seat-collision refusal, skill wiring.
3. **Strike interplay** — seat_hash parity proven by test, advisory `remedy` on an adopted
   default's `requalify_required` verdict, strike-decay cross-ref.
4. **Sweep formalization** — durable parts of the five session-local `sweep*.sh` lifted into
   `scripts/qualification-sweep.sh`.
5. **Docs, wiring, gates** — all four CLAUDE.md touchpoints per new script, BACKLOG, CHANGELOG,
   PATCH bump, full suite + preflight.

## Progress log

- **2026-08-23** — depth-1 foreman run `official-defaults-l4` (ledger
  `/tmp/autopilot-dispatch-runs/official-defaults-l4.ledger.jsonl`). All five phases implemented.
- **Two findings recorded rather than silently absorbed** (both filed as BACKLOG rows):
  - A scorecard row cannot travel alone. `engine-scorecard.js record` refuses any `internal_eval`
    row whose `evidence_store` triple does not resolve in the destination **capability** store
    (`verifyEvidenceStoreAnchor`). The first adoption attempt failed on exactly this. The artifact
    now ships the qualifier-store anchor wrapper alongside each row, and adoption renumbers it into
    a free local slot with the scorecard row's `evidence_store.event_id` renumbered to match. This
    is the difference between "the artifact exists" and "the flow works"
    (`references/evidence-discipline.md` §1) — it was caught by running the round-trip, not by
    reading the code.
  - **Pre-existing, NOT introduced here**: `nowArgToMs` truncates to UTC midnight, so an evidence
    receipt issued later on the same UTC day reads as not-yet-valid. Events 153/154/155 project
    `no_record` on the real store today and `qualified` with `--now 2026-08-24`. Out of scope
    (admission semantics); filed with the measured reproduction.
