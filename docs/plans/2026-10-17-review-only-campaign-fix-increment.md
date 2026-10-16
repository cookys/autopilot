# Plan — BL-0146 a returned review-only campaign reviews the fix, not the whole range again

> Status: draft for owner (2026-10-17), plan only, no code. Backlog: BL-0146 (follow-up of BL-0090 / `docs/backlog/review-candidate-follow-ups.md`). Operator doc: `docs/review-candidate.md`.
> Placement: INDEX row `active`. Per the backlog entry the plan comes first: new reuse key, touched-files re-check, cumulative context packet.

## 0. Problem

An external author fixes what a review parked on and comes back with a new head (`return`). Every seat then re-reviews all of `base..new_head`, so each return pays a full panel round. Correctness is fine; cost is the complaint (reporter: cuda).

Reproduction path, with the code that causes it:

1. `return` is admitted by `defaultAdoptionAdmission` (`src/engine/campaign-intake.js:1955`): the branch tip must be a strict descendant of the reviewed head (refusals at `:1986`, `:1992`) and that tip becomes the adopted head (`:1996`). The scope check runs on `base..head` (`:2023`), cumulative.
2. The engine adopts the tip (`src/engine/autopilot-engine.js:7778`, `returnedHead`), so the candidate is a new commit and tree.
3. Review input is rebuilt for the whole range: `prepareReview` produces `diff_digest` over `base..head` and the payload is `review_input_mode: 'full_diff_generation'` (`src/engine/campaign-composition.js:2037-2042`; the barrier is `ensureFullDiffBarrier`, `:2029`).
4. The panel seat store keys a stored verdict by `digest(candidate_tree_sha, base_sha, diff_digest, spec_digest, review_input_digest)` (`autopilot-engine.js:5889-5895`, file path in `src/engine/final-panel-seat-store.js:46`). A new head changes the tree and the diff, so every seat misses and is dispatched again. The gate journal key (`campaign-composition.js:2084-2108`) also contains `candidate_ref`, `candidate_tree_sha`, `diff_digest`; it misses for the same reason.
5. A seat sees only a packet and a spec: `blind_discovery: true`, `prior_findings_included: false` (`autopilot-engine.js:5272-5273`, `:5635-5636`; `final-panel-seat-store.js:130-131`). Nothing about the earlier round reaches it, by design (blind evidence, `scripts/check-blind-evidence.sh`).
6. The in-loop `focusedReview` supplement exists (`campaign-composition.js:2565`, `focused_delta_round`) but it is an optional adapter that never replaces the barrier, and the engine does not wire it for review-candidate (RO13 in the archived plan states this).

Ruling being changed: BL-0090 plan §10 Q3 ruled (c) 2026-10-14, "re-review the whole range, reuse a seat outcome only on identical binding", and listed option (a) as the future: delta review needs a new reuse key, a re-check of files the delta touches, and a read-only context packet.

## 1. Goal and non-goals of the goal

Goal: on `return`, the cost of a round scales with the size of the fix and of what it can affect, not with the size of the range, while no reviewed-clean claim is made about a file whose review does not bind to its current bytes.

Non-goals (section 5 lists what is deliberately left alone).

## 2. Design

### 2.1 Shape: carry forward per file, review the delta plus what it can affect, fail closed to today

A seat verdict today is for the whole range. Make the unit of reuse the **file's cumulative diff**: for each path P in `base..head`, `file_digest(P) = sha256(cumulative diff of P from base to head)`. A path whose digest is identical between the reviewed head H0 and the new head H1 is **unchanged**; a path whose digest differs, or that exists on one side only, is **changed**.

A returned round reviews:

- the **delta packet**: the diff `H0..H1` (what the author just changed);
- the **re-check set** R: the cumulative diffs (`base..H1`) of every changed path, so a seat judges a changed file in full, not as a hunk;
- the **carried set**: unchanged paths, whose prior verdict is carried forward and not re-dispatched.

### 2.2 Incremental review is allowed only when every eligibility test passes; otherwise the round is today's full round

Eligibility is computed by a pure module (new `src/engine/review-increment.js`) from Git and the stored prior round. Any failing test returns `{ mode: 'full', reason }` and the engine runs exactly today's path, with the reason recorded. Tests:

1. Contract opt-in (section 2.7).
2. The prior round exists and each seat to be carried has a stored `reviewed` artifact for the prior binding that **re-derives** (same rule as `final-panel-seat-store.js`: artifact type, binding, tuple, findings re-normalize, `review_digest` re-derives). A seat with no such artifact (`no_verdict`, `transport_failed`, tuple changed) is reviewed on the **full** range, not carried.
3. Same `base_sha`, same sealed roster digest, same spec digest, same `verify_cmd`. (A changed spec or roster means the question changed.)
4. Verification at H1 is green (already required before review).
5. Size guard: changed paths are at most `increment_max_changed_ratio` of the cumulative file count (default 0.5) and the delta packet is under the packet ceiling. A large rewrite is just a full review.
6. Shared-surface guard: if the delta touches a path matching the shared-surface list (package and lock manifests, the sealed `verify_cmd` target and its scripts, schemas, CI config, files named in `vertical_acceptance`), the whole range is re-reviewed. These are the places where a small edit changes the meaning of unchanged files.

### 2.3 Touched-files re-check (the central correctness risk)

A fix in file A can break a conclusion about unchanged file B. Defence, in order of strength, all deterministic and none relying on the model:

1. **Re-check set grows by reference.** R = changed paths, plus unchanged paths that carry an open finding from the prior round (a fix must be judged against its finding's file even if the author did not touch it: a finding with no matching change is **not resolved by silence**), plus unchanged paths that textually reference a changed path's basename or an exported symbol removed or renamed in the delta (bounded grep over the cumulative file list, cap `increment_reference_cap` files; hitting the cap falls back to full).
2. **Deleted and renamed paths** are changed on both sides and force their references into R.
3. **Receipt discloses the cut.** The terminal receipt carries `review_scope: "incremental"`, the carried path list with their `file_digest`, the re-check set and why each path is in it. Disclosure, not attestation (ADR-0001): a reader can re-derive the sets from the two heads.
4. The delta-only claim stays honest by the opt-in and by section 6 R1 (planted cross-file regression).

### 2.4 Reuse key (new)

Today one binding per round (section 0, step 4). Add an incremental binding, stored under its own station name (`final-panel-incremental`) so a full-round artifact can never satisfy it and the reverse:

```
incremental_binding = digest({
  mode: 'incremental',
  base_sha,
  prior_head, prior_tree_sha, prior_binding,          // the round being carried from
  new_head, new_tree_sha,
  delta_diff_digest,                                  // H0..H1
  recheck_set: [{ path, file_digest }...],            // sorted
  carried_set: [{ path, file_digest }...],            // sorted
  carry_packet_digest,                                // section 2.5
  spec_digest, review_input_digest,
})
```

A stored incremental seat artifact is reused only on identical binding and the existing re-derivation rule. A carried verdict is valid for path P only while `file_digest(P)` at the new head equals the digest recorded in the prior artifact; that equality is re-computed from Git at use time, never read from a flag. Resume after an interrupted incremental round therefore reuses per seat exactly as full rounds do. The gate-journal key (`campaign-composition.js:2084`) gains `review_input_mode: 'incremental_return'` and the incremental binding, so it cannot collide with a full-diff gate.

### 2.5 Cumulative context packet (how the previous round reaches a seat that has no context channel)

A seat has only a diff file and a spec file. So the earlier round is **written into the spec file**, as a generated addendum the engine builds (never a message from the author, never free text from the parked disposition):

```
== Prior round (machine generated from the stored seat artifacts of round N-1) ==
Reviewed head: H0   New head: H1   Delta: H0..H1 (diff file 2)
Open findings from round N-1 (id, severity, path:line, claim, one line). Treat each as an unverified
claim: decide from the code at H1 whether it is resolved, still present, or invalid.
Carried paths (reviewed clean at H0, byte-identical at H1): <list, no verdict text>.
Required output for each open finding: {id, status: resolved|still_present|invalid, evidence: path:line}.
```

Rules:

- **Findings only, no verdicts and no rationale from the previous round.** The anchoring risk is a seat deferring to "the earlier reviewer said fine". The addendum carries claims to test, not conclusions to trust. Carried paths are named but their verdicts are not quoted.
- **Delta review stays blind to everything except that.** Nothing from the implementer: no commit messages, no author notes, no disposition prose. The addendum is built only from stored seat findings (re-normalized by `normalizeProductReviewFindings`) and Git. `check-blind-evidence.sh` runs on the assembled spec exactly as today; the new content has a fixed shape so the scanner's implementer-narrative classes still apply to the author's repo text and the addendum is whitelisted by structure, not by suppression. The two `prior_findings_included: false` markers become `true` only on the incremental path, with the shape above, and a test pins that the full path still reports `false`.
- **Closure is explicit.** A prior finding is closed only by a seat's explicit `resolved` entry with evidence `path:line` at H1; absence never closes it (same principle as the BL-0032 rule in `scripts/lib/review-chain-derive.js:29`, "only an explicit `resolutions` entry closes an earlier verified finding"). A finding no seat addresses stays open and parks again. The seat output schema gains a `resolutions[]` array; the normalizer rejects an entry with an unknown id, and a `resolved` without evidence counts as not addressed.
- **Disagreement among seats** about one finding (`resolved` vs `still_present`) keeps it open (the conservative side); the final panel judges it as it judges any contested finding today.

### 2.6 Engine wiring

- `defaultAdoptionAdmission` is unchanged: scope and file cap stay cumulative (`campaign-intake.js:2023`).
- On `returnedHead`, before the review station, call the eligibility module. `incremental` builds the delta diff file, the re-check cumulative diff file and the spec addendum, and runs the existing `prepareReview` with `review_input_mode: 'incremental_return'`; `full` runs today's code untouched.
- The final panel is the same panel and roster. Seats with a re-derivable prior artifact get the incremental packet; the others get the full packet. Quorum and family rules are unchanged and are evaluated on the union.
- The result is still a `base..head` verdict for the receipt: carried clean paths from the prior artifacts, re-checked paths from this round, findings from both. `review_scope` and the carried/re-check sets are written into the receipt (additive fields).

### 2.7 Contract surface

`adoption.return_review` in the sealed contract: `"full"` (default, today) or `"incremental"`. Sealed, so the operator opts in per campaign and the seal pins the choice (schema `schemas/implementation-campaign-contract.schema.json`, checker `scripts/implementation-campaign-check.js`, `docs/review-candidate.md` section 2.1 table). Default stays `full` until the A/B in D5 passes; flipping the default is an owner decision and a separate commit.

## 3. Deliverables

| # | Deliverable | Files (new or touched) | Exit |
|---|---|---|---|
| D1 | Eligibility and sets: per-file digests, changed/carried/re-check sets, size guard, shared-surface guard, reference expansion with cap, `full` fallback with reason | new `src/engine/review-increment.js`; new test under `hooks/tests/` | unit cases incl. every fallback reason; negative controls (section 4) |
| D2 | Incremental binding and seat store station: per-seat reuse with re-derivation, tuple and digest checks, gate-journal key | `src/engine/final-panel-seat-store.js`, `src/engine/campaign-composition.js:2084` region | reuse hit on identical binding; miss on each changed component |
| D3 | Context packet and explicit closure: spec addendum generator, `resolutions[]` in the seat schema and normalizer, blind-evidence check | `src/engine/autopilot-engine.js` (packet build near `:5846`), `src/engine/product-review-normalizer.js`, `scripts/check-blind-evidence.sh` tests | silence never closes; addendum contains no verdict or author text |
| D4 | Wiring and contract field: `returnedHead` branch, receipt disclosure, schema and checker, operator doc | `src/engine/autopilot-engine.js:7778` region, `src/engine/campaign-intake.js`, schema, checker, `docs/review-candidate.md` | end-to-end return in a temp repo with stub dispatcher, both modes |
| D5 | Evidence: A/B on planted returns, cost measurement, default decision input; BACKLOG BL-0146 removed with its sidecar line, CHANGELOG `Unreleased` line | `docs/plans/evidence/2026-10-17-review-only-increment/`, `docs/BACKLOG.md`, `docs/backlog/review-candidate-follow-ups.md` | table of cost and misses; owner reads it before any default flip |

Order: D1 then D2 and D3 in parallel (disjoint files except `autopilot-engine.js`; serialize those two edits) then D4 then D5. D1-D4 are mechanism for an opt-in mode, no change to the default requirement list.

## 4. Acceptance, with negative controls

Each check ships red before green (the repo rule). Fixtures use a temp repo and the stub dispatcher seams of `hooks/tests/autopilot-engine*.test.sh`; nothing writes to a real `~/.autopilot` or common-dir ledger.

| ID | Behaviour | Negative control (must go red when the check is removed) |
|---|---|---|
| A1 | A return that changes 1 of N files dispatches each seat once with a packet of the re-check set only; the carried N-1 files are not in any seat input | Disable the carry: seat inputs contain all N files and the test fails |
| A2 | A prior open finding on an unchanged file keeps that file in the re-check set; the finding stays open when the seat is silent | Drop the open-finding rule: the finding closes by silence and the test fails |
| A3 | Silence never closes: a seat that omits a finding id leaves it open and the campaign parks again | Treat omission as resolved: test fails |
| A4 | A planted cross-file regression (delta edits A, breaks caller B unchanged) is caught: B is pulled in by reference expansion | Remove reference expansion: the planted break is missed and the test fails |
| A5 | Each fallback gives `mode: full` plus its reason and the full path runs: shared-surface file touched, ratio over limit, reference cap hit, spec/roster/base changed, seat without a re-derivable artifact, `return_review: full` | For each, force `incremental`: test fails |
| A6 | A stored incremental artifact is reused only on identical binding; a changed delta digest, carried digest, prior head, spec or seat tuple is a miss. A stored full-round artifact never satisfies an incremental lookup and the reverse | Key on tree only: stale reuse and the test fails |
| A7 | A carried verdict is rejected when the path's cumulative digest at the new head differs from the digest in the prior artifact (author touched it after the review) | Skip the digest recheck: test fails |
| A8 | Addendum contains finding id, severity, path:line, claim only; no verdict text, no commit message, no disposition prose; `check-blind-evidence.sh` passes on it and still fails on a planted implementer-narrative line in the author's text | Put a commit message in the addendum: the scanner test fails |
| A9 | The full path is byte-identical to today: the existing review-candidate suites stay green and `prior_findings_included` stays `false` there | Flip the flag on the full path: pinned test fails |
| A10 | Receipt discloses `review_scope`, carried and re-check sets; a reader recomputes the sets from the two heads and they match | Corrupt one carried digest: re-derivation disagrees and the test fails |
| A11 | Contract: `adoption.return_review` accepts `full` and `incremental`, rejects other values and a review-only contract without the field behaves as `full`; the seal pins it | Accept an unknown value: checker test fails |

Cost evidence (D5, not a gate): per return, count seat model calls and fresh input bytes for full vs incremental on the same planted returns (single-file fix, ten-file fix, cross-file regression, rename). Report the median saved and every miss.

## 5. Not doing

- **No delta-only claim for the first round.** Round one stays a full review of `base..head`.
- **No dropping the cumulative scope and file-cap admission** (`campaign-intake.js:2023`): admission stays on the whole range.
- **No trust machinery:** no signed carry records, no hash-chained rounds (ADR-0001). The carry is re-derived from stored seat artifacts and Git on every read.
- **No semantic dependency analysis** (no call graph, no language server). Reference expansion is bounded textual matching, with fallback to full when it cannot decide.
- **No reuse across campaigns or across different seat tuples**, as before.
- **No change to the seat output for a first or full round** beyond an optional `resolutions[]` that a full round does not emit.
- **No default flip** in this plan. The default stays `full` until D5 evidence and an owner ruling.
- **Not BL-0155** (repair branch numbering) and not the `implement-review` repair path (`focused_delta_round` there is separate).

## 6. Risks

- **R1 Cross-file regression missed.** The whole value is the carry, and the carry is a bet that unchanged files stay fine. Controls: reference expansion, shared-surface guard, size guard, opt-in, disclosure, A4. Residual: a behavioural dependency with no textual reference (config read by string, dynamic dispatch) is missed. That residual is why the default stays `full` and why the final line of the receipt says `incremental`.
- **R2 Anchoring on listed findings.** Seats given the prior list may stop looking elsewhere. Controls: claims only, no verdicts, delta is still reviewed fresh, A8. Residual accepted; measured in D5 by planting a new bug next to a listed finding.
- **R3 The addendum becomes a laundering channel** if it grows free text. Controls: fixed shape, built only from re-normalized stored findings and Git, scanner kept on.
- **R4 Receipt readers assume `ready` means whole-range reviewed.** Control: `review_scope` field and doc text in `docs/review-candidate.md` (what `incremental` does and does not claim).
- **R5 Resume complexity:** two modes share one seat store. Control: distinct station name and binding, A6.
- **R6 Reference cap tuning** may fall back to full so often the feature rarely pays. Measured in D5.

## 7. Effort

About 3 working days for D1-D4 (D1 0.5, D2 0.5, D3 1, D4 0.5-1) plus 0.5-1 day for D5. This replaces the backlog entry's "M".

## 8. Owner decisions needed

1. **May a `ready` receipt rest on an incremental round?** Recommended yes, labelled `review_scope: incremental` and opt-in per campaign. The stricter alternative is that incremental rounds can find findings and park, but the round that would issue `ready` must be a full pass; that keeps most of the saving on parked rounds and none on the last round, which the reporter may find too weak.
2. **Findings text in the seat addendum (anchoring vs. cost).** Recommended: claims only, no verdicts. Alternative: no prior findings in the prompt at all (fully blind delta); then resolution of old findings must be re-derived by depth-0 from the delta and cannot be seat-judged, and fewer old findings get closed.
3. **Default.** Recommended: stays `full` until D5 shows no missed planted regression over the agreed cases; flipping it is the owner's call.
