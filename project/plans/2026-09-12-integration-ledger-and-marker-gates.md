# Plan — Integration ledger, input containment, and the two silent gates

> Status: **R0 — DRAFT** (authored depth-0, 2026-09-12) · Owner: depth-0 session under CEO delegation ·
> Branch: develop (units via managed campaign worktrees) · Frame: two peer reports, re-derived locally

## 0. Context / thesis

Two cross-session reports arrived on 2026-09-12. Both were re-derived on this host before this plan was
written, and **both reports are partly wrong in ways that change the work**. This plan records the
corrections as first-class content, because implementing the reports as written would ship the wrong fix
twice.

- `308-db` reported that acceptance records no machine-readable accepted SHA, so containment cannot be
  checked mechanically. They lost two days measuring a build whose inputs were never verified present.
- `openclaw` reported that an active `l5` session-mode marker deadlocks the bounded campaign that the
  same `/l5` launched, and proposed skipping `check_session_mode_gate` for bounded contracts.

The thesis: **a mechanical check aimed at the wrong object carries authority it has not earned.** Every
phase below either supplies the object a check needs (P1), points an existing check at it (P2, P3), or
makes a check that currently says nothing say what it rejected (P4, P5).

## 1. Problem, as measured on this host

### 1.1 P1 — the accepted SHA exists for merges and only for merges

The peer's claim is "neither receipt records which commit was accepted". That is **too strong**.
`schemas/merge-execution-receipt.schema.json` `$defs.edgeReceipt` already requires
`source_validation.actual_sha` (what the lane produced), `after_sha` and `merge_commit` (what is in the
tree). For a git-merge edge the pair the peer asks for is **already recorded**.

What is actually missing is narrower and sharper:

1. **`mode` is a two-value enum: `no-ff` / `ff-only`.** There is no vocabulary for the integration the
   peer actually used — `git diff --binary <base>..<hands> | git apply --index` followed by a fresh
   commit. An apply-style integration cannot be written into this receipt at all, so it is not that the
   field is missing, it is that the **receipt refuses the event**.
2. **No unit / lane identity.** `source_ref` is a ref name. A ref is reused, renamed and deleted; it does
   not answer "which deliverable produced this".
3. **Coverage.** Only `src/merge/cli.js` writes this receipt. Integration performed by a foreman or by
   hand — which is how all six of the peer's lanes landed — produces no receipt of any kind.

The consequence is exactly their incident: they asked `merge-base --is-ancestor` about six hands-branch
SHAs, got six NOT-LANDED, and concluded the work was never merged. Each lane had a different, freshly
authored accepted commit, all ancestors of HEAD. `is-ancestor` was the wrong question for an
apply-style integration, and nothing in the record said which question to ask.

### 1.2 P2 / P3 — containment has no operand, and the assertion is method-dependent

There is a campaign contract and a pinned base SHA, but nothing asserts that a phase's declared inputs
are ancestors of the integration target before the phase spends. P3 is the same assertion on the other
side of the merge-back.

Both depend on P1 and on one semantic that must be stated in the acceptance rather than discovered by
the implementer: **the containment assertion is selected by `integration_method`.**

| `integration_method` | Required post-condition |
|---|---|
| `merge`, `ff` | `git merge-base --is-ancestor <source_sha> <target>` MUST succeed |
| `cherry-pick`, `rebase`, `squash`, `apply+fresh-commit` | that command MUST fail, and that is **correct**; containment is instead asserted on `accepted_sha` being an ancestor of the target |

A check that asserts ancestry unconditionally reproduces the peer's false negative with a gate's
authority behind it. This is the single most important line in this plan.

### 1.3 P4 — the qc-panel seat validation is silent, in four places not three

`scripts/resolve-review-loop.sh:729-750`. `QC_PANEL_SEATS_COMPLETE="false"` is set at **four** sites — an
arity mismatch between the model/runner/effort/endpoint arrays, then per-seat runner, effort, and
endpoint validation — and **none of them emits anything**. `qc_panel_seats` then serialises as `[]`,
`cross_family_satisfied` goes false, and `--enforce` BLOCKs naming none of it. Thirty lines below, the
same class of input on `reviewer_runner` echoes the offending value with the full allowlist and exits 3.

The peer's own instance (`kimi` / `opencode` rejected) is already fixed here — both are on the allowlist
at line 739; they were reading the 2.34.5 plugin cache. The **structural** complaint is live.

### 1.4 P5 — two deliberate rules, one population, opposite outcomes

`check_session_mode_gate` (`scripts/dispatch-hetero.sh:891`) refuses any dispatch while an `l5`/`l6`
marker is live for the repo unless `CAMPAIGN_PROJECTION_BOUND` is 1. A bounded campaign contract with no
`mission_runtime` never passes `--strict-contract`, so `run_campaign_projection_preflight` returns early
(`:1191`) and the gate fires.

Reproduced here in both halves. **Bare dispatch**: invoked directly under this session's own live `l5`
marker, returns `precondition_failed`, `dispatcher_called:false`, with that exact string. **Bounded
sealed campaign**: `hooks/tests/dispatch-hetero.test.sh:966-979` builds a v1 contract, seals it with
`implementation-campaign-check.js seal --mission-mode off`, plants a live `l6` marker, and asserts exit
2 plus the same string plus no runner spawned — and the file passes 232 assertions on `develop` today,
which means the refusal is occurring, now, on this host.

This is **not** an un-updated dispatcher. It is asserted as correct by
`hooks/tests/dispatch-hetero.test.sh:975` — *"sealed v1 campaign cannot bypass active L6 strict
projection"* — from `8d7e61c2` (2026-07-28). That file is 232 assertions and green today.

The contradiction is with `scripts/session-mode.js:291` `campaignCarriesMissionProjection`, which carved
**the same population** out of the admission side because the bounded contract schema has nowhere to put
a projection, making it *"a deny that no fixture and no caller could ever satisfy"*. Its own comment
states that dispatch-hetero "already draws that line … and routes everything else to the session-mode
gate" — describing the routing correctly while not noticing that the destination is a permanent deny.

The discriminating fact: `node scripts/session-mode.js set --level l5 --repo-root <sbx>` returns
`ok: true` in a sandbox repo with **no Mission configuration at all**. So the deadlocked state is
reachable through the shipped front door — `/l5` in mission-off mode writes a marker, and that marker
then refuses every bounded campaign the same `/l5` can launch.

The reversal does **not** rest on whether a marker can be retired. It rests on the same fact the
admission side already acted on: the 2026-07-28 rule assumed a bounded campaign could become
strict-projected, and the closed bounded-contract schema gives it **nowhere to put a projection**. The
condition the gate demands is unsatisfiable by construction for this population — the identical
permanent deny `session-mode.js:291` identified and corrected on the admission side.

**Depth-0 ruling under CEO delegation, 2026-09-12, reversible until it ships**: the 2026-07-28 rule is
reversed for bounded sealed campaigns. Recorded as a supersession, not a bug fix.

## 2. Non-goals

- The repo-level residue sweep (`308`'s item (a)). Different shape, own plan.
- A `session-mode.js retire` verb. Different mechanism, already its own BACKLOG row; P5 does not need it
  and must not be conflated with it.
- The `admission_release.status=released` vs durable `live_lease` inconsistency the peer saw. Logged,
  out of scope here.
- Any change to `check_marker_campaign_admission_bridge`. It is a **second, independent** gate (strict
  campaign + stale marker from a previous graph); P5 does not clear it and must not claim to.

## 3. Acceptance IDs

| ID | Statement |
|---|---|
| `p1-receipt-records-source-accepted-and-method` | An integration receipt carries `source_sha`, `accepted_sha`, `integration_method`, and a unit id; neither SHA is derivable from the other. |
| `p1-method-enum-admits-apply-style` | `integration_method` is a closed enum including `apply+fresh-commit`; an apply-style integration can be recorded without schema violation. |
| `p2-inputs-landed-gate-refuses-per-entry` | A phase declaring inputs exits non-zero and names **each** failing entry before any spend. |
| `p3-containment-assertion-is-method-selected` | The post-merge-back assertion is selected by `integration_method`; an `apply+fresh-commit` row with a non-ancestor `source_sha` PASSES, and the same row with a non-ancestor `accepted_sha` FAILS. |
| `p4-panel-seat-rejection-names-the-value` | Each of the four `QC_PANEL_SEATS_COMPLETE="false"` sites emits a message naming the rejected value and the allowlist on stderr. |
| `p4-panel-incomplete-exits-3` | An incomplete panel exits 3 at validation time, unconditionally, rather than resolving to an empty panel. |
| `p5-bounded-sealed-campaign-dispatches-under-live-marker` | Contract + sha256 + seal present and the contract carries no `mission_runtime`/`campaign_projection` ⇒ the session-mode gate is skipped and the dispatcher is called, with a live `l5` marker for the repo. |
| `p5-bare-dispatch-still-gated` | The same live marker, no `--campaign-contract` ⇒ `precondition_failed`, `dispatcher_called:false`, unchanged string. |
| `p5-strict-campaign-stale-marker-still-refused` | A strict projected campaign with a marker carrying a different `mission_graph_digest` is still refused by the bridge. The reversal does not reach it. |

## 4. Phases

Each phase is one deliverable node. P2 and P3 depend on P1; P1, P4 and P5 are mutually independent.

### P1 — `integration-receipt-sha-ledger`  *(no dependencies)*

Extend `schemas/merge-execution-receipt.schema.json` `$defs.edgeReceipt` with `source_sha`,
`accepted_sha`, `integration_method` (closed enum: `merge`, `ff`, `cherry-pick`, `rebase`, `squash`,
`apply+fresh-commit`) and `unit_id`.

**`mode` is left alone.** It is the merge *strategy input* — `src/merge/cli.js:665-667` turns it directly
into `git merge --no-ff` vs `--ff-only` — while `integration_method` is the *outcome*. Different axes;
adding the second does not widen or replace the first, and no existing consumer of `mode` is touched.
`mode` remains meaningful only for the `merge` / `ff` methods.

Update the writer in `src/merge/cli.js` to populate the new fields from what it already knows
(`source_validation.actual_sha` → `source_sha`; `merge_commit` or `after_sha` → `accepted_sha`).

**Acceptance** — `p1-receipt-records-source-accepted-and-method`, `p1-method-enum-admits-apply-style`:

```
node scripts/validate-json-schema.js --schema schemas/merge-execution-receipt.schema.json \
  --instance <fixture with integration_method "apply+fresh-commit">   # exit 0
node scripts/validate-json-schema.js --schema schemas/merge-execution-receipt.schema.json \
  --instance <fixture with integration_method "hand-wave">            # non-zero
```
plus a red case proving a receipt **without** `source_sha` is rejected, so the field cannot be omitted.

### P2 — `inputs-landed-gate`  *(depends on P1)*

A pre-phase gate eating `{"inputs":[{"id","sha"}]}` and asserting each is an ancestor of the integration
target. Exits non-zero and **names every failing entry**, not the first.

**Acceptance** — `p2-inputs-landed-gate-refuses-per-entry`: a fixture with three inputs, two absent,
produces two named entries in one run and a non-zero exit; a fixture with three present exits 0.

### P3 — `containment-assertion`  *(depends on P1)*

Post-merge-back assertion, **selected by `integration_method`** per the table in §1.2.

**Acceptance** — `p3-containment-assertion-is-method-selected`: the two-row matrix in §1.2 as literal
test cases. An unconditional `is-ancestor` implementation MUST fail this phase.

### P4 — `qc-panel-loud-rejection`  *(no dependencies)*

All four sites in `scripts/resolve-review-loop.sh:729-750` emit on stderr, naming the rejected value and
the allowlist, in the shape line 768 already uses. **Behaviour decision, stated here rather than left to
the implementer**: an incomplete panel exits 3 **unconditionally**, not only under `--enforce`.
Measured basis — every sibling config validation in this file (`plan_review` at 433, `hetero_review`,
`plan_reviewer_runner`, `plan_reviewer_effort` at 441-452, `reviewer_runner` at 768) exits 3 with no
`ENFORCE` guard, because `--enforce` governs the *policy verdict* (BLOCK), not *input validity*. The
panel seats are input validity. Resolving to an empty panel and letting a downstream
`cross_family_satisfied=false` produce the block reports the consequence instead of the cause.

**Acceptance** — `p4-panel-seat-rejection-names-the-value`, `p4-panel-incomplete-exits-3`.

### P5 — `bounded-campaign-marker-gate-reversal`  *(no dependencies)*

`scripts/dispatch-hetero.sh`: when `--campaign-contract`, `--campaign-contract-sha256` and
`--campaign-seal` are all present **and** the contract carries no `mission_runtime` /
`campaign_projection`, skip `check_session_mode_gate`. Use the same predicate as
`campaignCarriesMissionProjection`; do not re-implement it in shell inline. Bare dispatch stays gated.
Mirror into `platforms/codex/plugin/scripts/dispatch-hetero.sh`.

`hooks/tests/dispatch-hetero.test.sh:975` is **rewritten, not deleted**, with a name recording the new
rule, and the commit message states that it reverses the rule asserted by `8d7e61c2` on 2026-07-28.

**Acceptance** — `p5-bounded-sealed-campaign-dispatches-under-live-marker`,
`p5-bare-dispatch-still-gated`, `p5-strict-campaign-stale-marker-still-refused`.

## 5. Evidence discipline notes binding on every phase

- `references/evidence-discipline.md` §33 (an assertion that cannot fail) and §34 (a check that prints
  only its verdict) apply. Every new gate emits its operands, not only its verdict.
- Every red case must hand the checker the **same input shape** the green path consumes. The D4 admission
  bypass survived a green suite for one reason: every red fixture omitted the flag the GO path reads.
- Mirror parity: `scripts/sync-codex-plugin-skills.sh --check` for any touched script.
