# BL-0146 D5: incremental versus full return review, measured with real seats

Date 2026-10-17. Plan: `docs/plans/2026-10-17-review-only-campaign-fix-increment.md` (D5, section 4 Cost evidence, R2, R6).
Pre-registration: [`PREREG.md`](PREREG.md), committed before the first model call; amendments A1 to A4 are in its section 9, each with
its reason. Harness and scorer: [`harness/`](harness/). One JSON record per cell: [`cells/`](cells/).
**This document changes no default.** `adoption.return_review` stays `full`.

## 1. What was run

- 40 cells, each a throwaway repository and a real campaign through `AutopilotEngine.runImplementationReviewLoop`, with real seats
  through the real `dispatch-review.sh`: main grid 20 cells (5 scenarios x 2 arms x 2 repetitions), raw-spec condition 6 cells (A1),
  spec-wording condition 10 cells (A2), large-range scenario 4 cells (A4). 201 seat calls, estimated spend USD 17.40 of the 40 cap.
- Arms. `inc`: sealed at H0 with `return_review: incremental`, round 1 reviews `base..H0`, then the branch advances to H1 and the run
  resumes with `continuation: return`. `full`: the same H1 range reviewed as a first round (what a return under `full` does: same diff
  bytes, same spec, no addendum). Limitation: the `full` arm is not a literal return round.
- Scenarios (5 pre-registered plus `s6`): s1 single-file fix, s2 ten-file fix (26-file range, 11 planted defects, 10 fixed), s3 cross-file
  regression (a fix to `coupon.js` that breaks the unchanged `checkout.js`), s4 rename (`tax.js` to `vat.js`, the unchanged `invoice.js`
  still requires `./tax`), s5 R2 (each fix lands next to a new defect), s6 a one-file fix in a 26-file range. Every planted defect is one
  line against a contract in the spec. Definitions of a miss and of every metric: `PREREG.md` sections 5 and 6.
- Panel actually run: claude-fable-5-1 (claude-native), GLM-5.3 (cc-shim, endpoint glm), Qwen3.8-Max (qoderclicn). The fourth seat of
  the repository's `qc_panel`, opencode-go/muse-spark-1.3-contributor (runner opencode), is refused by the engine in a managed blind review
  before any call ("runner is not in the enforceable no-tools set ... pins and overrides do not bypass containment"), so the shipped
  `qc_panel` cannot run a review-only campaign as configured.
- What is measured and what is not. Seat calls and input bytes are measured. **Cost is an estimate**: no runner reports token usage
  (`usage` is null for every seat call; `dispatch-status.js --usage-only` also returns null on the raw logs), so cost is the byte-derived
  model of `PREREG.md` section 5 with list price for fable and assumed prices for GLM and Qwen (`harness/prices.json`). It tracks bytes;
  it is not a bill. Ranges are small (9 to 26 files, 12 to 29 KB of packet per seat), which matters for the savings (section 3).

## 2. Headline numbers

| question | measured |
|---|---|
| Seat model calls saved | 0 percent. Every cell dispatched the same 3 seats, incremental or full (3 against 3 in every paired cell); the panel has no seat that an incremental round can skip. |
| Fresh input bytes saved, median | main grid (spec asks for `path:line`): -2 percent over the 9 cells that sent incremental packets; with the spec-wording sentence (A2) plus s6: 6 percent over 12 cells. Range -9 percent (s2) to 49 percent (s6). |
| Estimated cost saved, median | 0 percent (main grid), 1 percent (A2 plus A4 cells). Largest single saving 15 percent (s6). Estimate, see section 1. |
| Where it pays | only a small fix inside a large range: s6 (one file of 26) saved 49 percent of bytes. s2 (10 of 26 files fixed, 11 prior findings) cost 8 to 9 percent more bytes than full, because the prior-round block (24 to 26 KB over three seats) is larger than the carried files. |
| Missed defects (pre-registered rule: finding cites the defect's file within 3 lines) | 0 of 25 defect instances in the incremental cells (11 main grid, 14 A2 and A4); 0 of 14 in the `full` cells. |
| Missed defects (stricter A3 rule: located and also described) | 1 panel-level miss: `s4-incj-r1`, the stale `require('./tax')` in an unchanged file after a rename; 3 of 3 seats cited the right line and described a defect that does not exist. Seat level: full 42 of 42, main-grid incremental 29 of 32, A2/A4 incremental 36 of 40; all 7 seat-level misses are in s4. Details in section 4. |
| R2 (new defect planted beside a listed old finding, s5) | no anchoring miss: N1 and N2 were found by 3 of 3 seats in all 4 incremental cells and in all `full` cells. |
| Prior-finding closure | no seat closed a finding that H1 left in place (0 dangerous closures in 21 cells with a prior-round block). Benign: in s4 the seats left the renamed file's finding open in every cell. |
| Fallback to full (R6) | with the shipped protocol, 5 of 5 cells fell back (`finding_unmapped`: real seats write no `path:line`); with a spec asking for `path:line`, 1 of 10 (one claim that named a file without a line). No other reason code occurred: no `changed_ratio`, `reference_cap`, `recheck_content_size`, `addendum_malformed`. |
| The engine could not use the incremental answers | main grid: 9 of 9 incremental rounds ended `blocked` (7 `final_panel_families_below_minimum`, 2 `final_panel_seat_parser_failed`). With one extra spec sentence (A2 and A4): 8 of 12 parked as the fixture requires, 4 of 12 blocked. Section 5. |
| Duplicated findings (review finding 0ad19dc1) | the same planted defect arrives as 3 rows (one per seat) and every seat receives all rows: 3.0 rows per defect in the main grid for s1, s3, s5 (6, 3, 6 rows for 2, 1, 2 defects), 3.1 in s2 (34 rows for 11). The block is 17 to 27 percent of an incremental packet (about a quarter in s1, s2, s3, s5, s6). |
| Verdict-word filter (review finding 5b2be4ec) | 0 fallbacks. 0 of 338 real round-1 finding lines match the filter. Not part of the question but seen: 28 of 338 lines exceed the 400-character cap and are cut silently. |

## 3. Savings

The saving is the carried files minus the prior-round block. In this panel the packet of a seat is the diff, the files, the spec and
(incremental) `delta.diff` plus the block. Small ranges make the carried files small (12 KB per seat in s1, 29 KB in s2), the block
is 2.6 KB (s1) to 8.6 KB (s2) per seat, so the saving lies between -9 and 32 percent. s6 is the case the feature is for: 26 files, one fixed,
and it saves 49 percent of the bytes (29 KB to 15 KB per seat) and about 15 percent of the estimated cost (the estimate holds the output
at a constant 3000 tokens per seat, so it understates what a larger saving on input would be and says nothing on the reasoning tokens).
No call is saved in either mode. Larger real ranges were not measured; the arithmetic is carried bytes minus the block, nothing else.


## 4. The misses, in detail

Pre-registered rule: none. Stricter rule (A3): s4, the rename.

- What happened. H1 renames `src/tax.js` to `src/vat.js` (fixing the old divisor defect there), updates `checkout.js`, and forgets the
  unchanged `invoice.js`, which still requires `./tax`. The engine did its job: `invoice.js` entered the re-check set with the reason
  `references_removed_symbol:taxCents@src/tax.js`, and the packet held `invoice.js`, `checkout.js`, `vat.js` and `delta.diff` (which shows
  `tax.js` deleted). The prior-round block listed three rows on `src/tax.js:4`. The seats answered those rows `still_present` and wrote
  findings such as "src/tax.js:4 is untouched by this delta, so taxCents still divides by 1000", which is false (the file is gone), and
  they did not say that `invoice.js` requires a module that no longer exists. The `full` arm, blind, said it in 6 of 6 seat answers
  ("src/invoice.js:3 requires './tax' but the diff deletes src/tax.js ... MODULE_NOT_FOUND").
- Counts. `s4-inc-r1` 1 of 2 seats described the real defect, `s4-inc-r2` 1 of 3, `s4-incj-r1` 0 of 3 (panel-level miss), `s4-incj-r2` 1 of 2;
  `full` 3 of 3 and 3 of 3. The seats' wrong statements also reach the author as findings.
- Reading. This is the anchoring risk of R2 in its sharpest form, not on a new bug beside a listed one (s5 showed none) but on a listed
  finding whose file the fix deleted: the row points at a path that no longer exists, and the seats answered the row instead of reading
  the delta. The re-check set was correct; the block is what misled. Whether the stricter rule is the right one is the owner's reading;
  under the pre-registered rule the miss count is 0.
- Other defect kinds: s3 (a fix whose new behaviour breaks an unchanged caller, found through the call reference) 3 of 3 seats in every cell,
  incremental and full; s1, s2, s6 (a prior finding on an untouched file stays open) 3 of 3 seats in every cell.
- The textual-reference limit of R1 (a dependency with no textual reference) was not planted and is not covered by these numbers.

## 5. Why the engine could not use most incremental answers

The incremental seat is asked for "one JSON object" in FINDINGS (the prior-round block) while the review protocol of
`dispatch-review.sh` asks for finding lines. In the main grid the real seats did both: they wrote the lines and then the object. The engine
reads only the object, so a seat's answer failed normalization and the panel fell below its minimum
(`final_panel_families_below_minimum` 7, `final_panel_seat_parser_failed` 2, all 9 incremental cells of the main grid). Adding one sentence
to the operator's spec ("put the whole answer in FINDINGS as the single JSON object ... do not also write the findings as separate lines",
condition A2) fixed that for most seats, and the remaining 4 blocks of 12 were: GLM-5.3 dropped the `prior:` prefix of every finding id
in 2 cells (unknown ids are rejected by the normalizer), and 2 transport failures (one GLM no-verdict, one fable framing failure, both also
possible in a full round). The shipped protocol never asks for `path:line` either (`dispatch-review.sh` has no such text), which is why
the raw condition fell back 5 of 5 times: `findingPathFromClaim` finds no path in "[id] MUST-FIX bulkCents uses `qty > 10` ...".
Both are compliance gaps between the engine's contract and what real seats write; neither is a correctness gap of the carry itself.

## 6. Decision basis for the default (stated before the data, `PREREG.md` section 8)

| condition for moving the default to `incremental` | result |
|---|---|
| no incremental-only miss of a regression or new defect | pre-registered rule: met (0). Stricter rule: not met (s4, 1 panel-level miss in 4 incremental cells of that scenario, 7 seat-level) |
| no dangerous closure | met (0 in 21 cells) |
| median saving of at least 30 percent on cost and bytes | not met: bytes -2 percent (main grid) and 6 percent (A2 and A4), cost 0 and 1 percent; met only for the one large-range scenario (49 percent bytes, 15 percent estimated cost) |
| at most 40 percent of incremental cells fall back to full | not met with the shipped protocol (5 of 5), met once the spec asks for `path:line` (1 of 10) |

Beyond the pre-registered table: with the shipped protocol and panel the engine cannot consume incremental answers (section 5).
The numbers do not support changing the default now. They would support offering `incremental` as an opt-in for a large range with few fixed
files, once the two compliance gaps (section 5) are closed and the deleted or renamed file case (section 4) is handled. The owner decides.

## 7. Follow-ups written to BACKLOG

BL-0201 (seat output format and `path:line` do not match the engine's contract; incremental is unusable on real seats), BL-0202 (the
same old finding is listed once per seat; cross-seat deduplication), BL-0203 (a prior finding on a file the delta deleted or renamed
anchors the seats). BL-0146 itself is removed with its sidecar line.

## 8. Reproduce

```
bash docs/plans/evidence/2026-10-17-review-only-increment/harness/launch-cell.sh <s1..s6> <inc|full> <rep> [raw|locjson]   # real seat calls
node docs/plans/evidence/2026-10-17-review-only-increment/harness/report.js docs/plans/evidence/2026-10-17-review-only-increment/cells
```
`harness/stub-review.sh` replaces the dispatcher with a stand-in that makes no model call (used to check the harness before the first
real call, see `PREREG.md`). `cells/*.json` hold the per-seat findings, usage (null), packet sizes and the receipt disclosure.

## 9. Tables (generated by `harness/report.js`)

### T1. Per cell (return round only)

| cell | arm / condition | engine status | scope (fallback) | seat calls | input bytes | est. cost USD | addendum rows | addendum bytes | wall s |
|---|---|---|---|---|---|---|---|---|---|
| s1-full-r1 | full | awaiting_disposition | full | 3 | 37644 | 0.25 | - | - | 61 |
| s1-full-r2 | full | awaiting_disposition | full | 3 | 37644 | 0.25 | - | - | 60 |
| s1-fullraw-r1 | full raw spec | awaiting_disposition | full | 3 | 37170 | 0.25 | - | - | 41 |
| s1-inc-r1 | inc | blocked | - | 3 | 30207 | 0.24 | 18 | 7917 | 41 |
| s1-inc-r2 | inc | awaiting_disposition | full (finding_unmapped) | 3 | 37644 | 0.25 | 0 | 0 | 81 |
| s1-incj-r1 | inc, spec wording | awaiting_disposition | incremental | 3 | 39498 | 0.25 | 24 | 10071 | 101 |
| s1-incj-r2 | inc, spec wording | blocked | - | 3 | 38385 | 0.25 | 24 | 9642 | 41 |
| s1-incraw-r1 | inc raw spec | awaiting_disposition | full (finding_unmapped) | 3 | 37170 | 0.25 | 0 | 0 | 61 |
| s2-full-r1 | full | awaiting_disposition | full | 3 | 87186 | 0.30 | - | - | 61 |
| s2-full-r2 | full | awaiting_disposition | full | 3 | 87186 | 0.30 | - | - | 81 |
| s2-inc-r1 | inc | blocked | - | 3 | 94401 | 0.31 | 102 | 24831 | 121 |
| s2-inc-r2 | inc | blocked | - | 3 | 95358 | 0.31 | 105 | 25788 | 121 |
| s2-incj-r1 | inc, spec wording | awaiting_disposition | incremental | 3 | 94137 | 0.31 | 102 | 23985 | 161 |
| s2-incj-r2 | inc, spec wording | blocked | - | 3 | 95064 | 0.31 | 102 | 25272 | 101 |
| s2-incraw-r1 | inc raw spec | awaiting_disposition | full (finding_unmapped) | 3 | 86712 | 0.30 | 0 | 0 | 81 |
| s3-full-r1 | full | awaiting_disposition | full | 3 | 37542 | 0.25 | - | - | 141 |
| s3-full-r2 | full | awaiting_disposition | full | 3 | 37542 | 0.25 | - | - | 101 |
| s3-inc-r1 | inc | blocked | - | 3 | 25716 | 0.23 | 9 | 6207 | 61 |
| s3-inc-r2 | inc | blocked | - | 3 | 25890 | 0.24 | 9 | 6381 | 61 |
| s3-incj-r1 | inc, spec wording | awaiting_disposition | incremental | 3 | 30894 | 0.24 | 12 | 7611 | 121 |
| s3-incj-r2 | inc, spec wording | awaiting_disposition | incremental | 3 | 34329 | 0.24 | 15 | 8532 | 81 |
| s3-incraw-r1 | inc raw spec | awaiting_disposition | full (finding_unmapped) | 3 | 37068 | 0.25 | 0 | 0 | 101 |
| s4-full-r1 | full | awaiting_disposition | full | 3 | 38721 | 0.25 | - | - | 40 |
| s4-full-r2 | full | awaiting_disposition | full | 3 | 38721 | 0.25 | - | - | 40 |
| s4-inc-r1 | inc | blocked | - | 3 | 39696 | 0.25 | 12 | 6729 | 101 |
| s4-inc-r2 | inc | blocked | - | 3 | 39570 | 0.25 | 12 | 7443 | 1064 |
| s4-incj-r1 | inc, spec wording | awaiting_disposition | incremental | 3 | 36144 | 0.25 | 9 | 5952 | 101 |
| s4-incj-r2 | inc, spec wording | blocked | - | 3 | 36921 | 0.25 | 12 | 6729 | 81 |
| s4-incraw-r1 | inc raw spec | awaiting_disposition | full (finding_unmapped) | 3 | 38247 | 0.25 | 0 | 0 | 81 |
| s5-full-r1 | full | awaiting_disposition | full | 3 | 37644 | 0.25 | - | - | 61 |
| s5-full-r2 | full | awaiting_disposition | full | 3 | 37644 | 0.25 | - | - | 101 |
| s5-inc-r1 | inc | blocked | - | 3 | 40635 | 0.25 | 24 | 10320 | 61 |
| s5-inc-r2 | inc | blocked | - | 3 | 33210 | 0.24 | 18 | 8766 | 61 |
| s5-incj-r1 | inc, spec wording | awaiting_disposition | incremental | 3 | 37113 | 0.25 | 21 | 9573 | 81 |
| s5-incj-r2 | inc, spec wording | awaiting_disposition | incremental | 3 | 33147 | 0.24 | 18 | 8121 | 61 |
| s5-incraw-r1 | inc raw spec | awaiting_disposition | full (finding_unmapped) | 3 | 37170 | 0.25 | 0 | 0 | 61 |
| s6-full-r1 | full | awaiting_disposition | full | 3 | 87186 | 0.30 | - | - | 61 |
| s6-full-r2 | full | awaiting_disposition | full | 3 | 87186 | 0.30 | - | - | 121 |
| s6-incj-r1 | inc, spec wording | blocked | - | 3 | 44862 | 0.25 | 27 | 10275 | 41 |
| s6-incj-r2 | inc, spec wording | awaiting_disposition | incremental | 3 | 44382 | 0.25 | 24 | 9795 | 81 |

### T2. Incremental versus full on the same returned head (main grid; packet level, whether or not the engine could consume the answers)

| scenario | rep | full bytes | inc bytes | bytes saved | full est. USD | inc est. USD | cost saved | calls full / inc | inc scope |
|---|---|---|---|---|---|---|---|---|---|
| s1 | 1 | 37644 | 30207 | 20% | 0.25 | 0.24 | 3% | 3 / 3 | incremental |
| s1 | 2 | 37644 | 37644 | 0% | 0.25 | 0.25 | 0% | 3 / 3 | full (finding_unmapped) |
| s2 | 1 | 87186 | 94401 | -8% | 0.30 | 0.31 | -3% | 3 / 3 | incremental |
| s2 | 2 | 87186 | 95358 | -9% | 0.30 | 0.31 | -3% | 3 / 3 | incremental |
| s3 | 1 | 37542 | 25716 | 32% | 0.25 | 0.23 | 5% | 3 / 3 | incremental |
| s3 | 2 | 37542 | 25890 | 31% | 0.25 | 0.24 | 5% | 3 / 3 | incremental |
| s4 | 1 | 38721 | 39696 | -3% | 0.25 | 0.25 | 0% | 3 / 3 | incremental |
| s4 | 2 | 38721 | 39570 | -2% | 0.25 | 0.25 | 0% | 3 / 3 | incremental |
| s5 | 1 | 37644 | 40635 | -8% | 0.25 | 0.25 | -1% | 3 / 3 | incremental |
| s5 | 2 | 37644 | 33210 | 12% | 0.25 | 0.24 | 2% | 3 / 3 | incremental |

Median saved over the 9 cells where the incremental packet was sent: bytes -2%, estimated cost 0%. Seat calls: identical (every seat is dispatched in both modes).

### T2b. Same, spec-wording condition (A2)

| scenario | rep | full bytes | inc bytes | bytes saved | full est. USD | inc est. USD | cost saved | calls full / inc | inc scope |
|---|---|---|---|---|---|---|---|---|---|
| s1 | 1 | 37644 | 39498 | -5% | 0.25 | 0.25 | -1% | 3 / 3 | incremental |
| s1 | 2 | 37644 | 38385 | -2% | 0.25 | 0.25 | 0% | 3 / 3 | incremental |
| s2 | 1 | 87186 | 94137 | -8% | 0.30 | 0.31 | -2% | 3 / 3 | incremental |
| s2 | 2 | 87186 | 95064 | -9% | 0.30 | 0.31 | -3% | 3 / 3 | incremental |
| s3 | 1 | 37542 | 30894 | 18% | 0.25 | 0.24 | 3% | 3 / 3 | incremental |
| s3 | 2 | 37542 | 34329 | 9% | 0.25 | 0.24 | 1% | 3 / 3 | incremental |
| s4 | 1 | 38721 | 36144 | 7% | 0.25 | 0.25 | 1% | 3 / 3 | incremental |
| s4 | 2 | 38721 | 36921 | 5% | 0.25 | 0.25 | 1% | 3 / 3 | incremental |
| s5 | 1 | 37644 | 37113 | 1% | 0.25 | 0.25 | 0% | 3 / 3 | incremental |
| s5 | 2 | 37644 | 33147 | 12% | 0.25 | 0.24 | 2% | 3 / 3 | incremental |
| s6 | 1 | 87186 | 44862 | 49% | 0.30 | 0.25 | 15% | 3 / 3 | incremental |
| s6 | 2 | 87186 | 44382 | 49% | 0.30 | 0.25 | 15% | 3 / 3 | incremental |

Median saved over the 12 cells where the incremental packet was sent: bytes 6%, estimated cost 1%. Seat calls: identical (every seat is dispatched in both modes).

### T3. Must-surface defects, main grid (full arm and inc arm)

| cell | defect (kind) | seats that located it (pre-registered rule) | seats that located AND described it (A3) | panel (A3) |
|---|---|---|---|---|
| s1-full-r1 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s1-full-r2 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s1-inc-r1 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s1-inc-r2 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s2-full-r1 | O11 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s2-full-r2 | O11 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s2-inc-r1 | O11 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s2-inc-r2 | O11 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s3-full-r1 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s3-full-r2 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s3-inc-r1 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s3-inc-r2 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s4-full-r1 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s4-full-r2 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s4-inc-r1 | R1 (regression) | 2 of 2 | 1 of 2 | surfaced |
| s4-inc-r2 | R1 (regression) | 3 of 3 | 1 of 3 | surfaced |
| s5-full-r1 | N1 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-full-r1 | N2 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-full-r2 | N1 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-full-r2 | N2 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-inc-r1 | N1 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-inc-r1 | N2 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-inc-r2 | N1 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-inc-r2 | N2 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s6-full-r1 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s6-full-r2 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |

### T3b. Must-surface defects, spec-wording condition (A2)

| cell | defect (kind) | seats that located it (pre-registered rule) | seats that located AND described it (A3) | panel (A3) |
|---|---|---|---|---|
| s1-incj-r1 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s1-incj-r2 | O3 (old_unfixed) | 2 of 2 | 2 of 2 | surfaced |
| s2-incj-r1 | O11 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s2-incj-r2 | O11 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s3-incj-r1 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s3-incj-r2 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s4-incj-r1 | R1 (regression) | 3 of 3 | 0 of 3 | **MISSED** |
| s4-incj-r2 | R1 (regression) | 2 of 2 | 1 of 2 | surfaced |
| s5-incj-r1 | N1 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-incj-r1 | N2 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-incj-r2 | N1 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s5-incj-r2 | N2 (new_next_to_old) | 3 of 3 | 3 of 3 | surfaced |
| s6-incj-r1 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |
| s6-incj-r2 | O3 (old_unfixed) | 3 of 3 | 3 of 3 | surfaced |

### T3c. Must-surface defects, raw-spec cells (they fell back to full)

| cell | defect (kind) | seats that located it (pre-registered rule) | seats that located AND described it (A3) | panel (A3) |
|---|---|---|---|---|
| s1-fullraw-r1 | O3 (old_unfixed) | 2 of 3 | 2 of 3 | surfaced |
| s1-incraw-r1 | O3 (old_unfixed) | 2 of 3 | 2 of 3 | surfaced |
| s2-incraw-r1 | O11 (old_unfixed) | 1 of 3 | 1 of 3 | surfaced |
| s3-incraw-r1 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s4-incraw-r1 | R1 (regression) | 3 of 3 | 3 of 3 | surfaced |
| s5-incraw-r1 | N1 (new_next_to_old) | 1 of 3 | 1 of 3 | surfaced |
| s5-incraw-r1 | N2 (new_next_to_old) | 1 of 3 | 1 of 3 | surfaced |

### T4. Prior-finding answers by the seats (main grid, inc cells whose seats received the addendum)

| cell | rows listed per packet | of which about a planted defect | distinct planted defects among them | answered closed where H1 fixed it | left open where H1 fixed it (benign) | silent | closed where H1 left the defect (DANGEROUS) |
|---|---|---|---|---|---|---|---|
| s1-inc-r1 | 6 | 6 | 2 | 9 | 0 | 0 | 0 |
| s1-incj-r1 | 8 | 6 | 2 | 9 | 0 | 0 | 0 |
| s1-incj-r2 | 8 | 6 | 2 | 6 | 0 | 8 | 0 |
| s2-inc-r1 | 34 | 33 | 11 | 60 | 0 | 34 | 0 |
| s2-inc-r2 | 35 | 33 | 11 | 90 | 0 | 0 | 0 |
| s2-incj-r1 | 34 | 33 | 11 | 90 | 0 | 0 | 0 |
| s2-incj-r2 | 34 | 33 | 11 | 60 | 0 | 34 | 0 |
| s3-inc-r1 | 3 | 3 | 1 | 9 | 0 | 0 | 0 |
| s3-inc-r2 | 3 | 3 | 1 | 9 | 0 | 0 | 0 |
| s3-incj-r1 | 4 | 3 | 1 | 9 | 0 | 0 | 0 |
| s3-incj-r2 | 5 | 3 | 1 | 9 | 0 | 0 | 0 |
| s4-inc-r1 | 4 | 3 | 1 | 0 | 6 | 4 | 0 |
| s4-inc-r2 | 4 | 3 | 1 | 0 | 9 | 0 | 0 |
| s4-incj-r1 | 3 | 3 | 1 | 0 | 9 | 0 | 0 |
| s4-incj-r2 | 4 | 3 | 1 | 0 | 6 | 4 | 0 |
| s5-inc-r1 | 8 | 6 | 2 | 18 | 0 | 0 | 0 |
| s5-inc-r2 | 6 | 6 | 2 | 18 | 0 | 0 | 0 |
| s5-incj-r1 | 7 | 6 | 2 | 18 | 0 | 0 | 0 |
| s5-incj-r2 | 6 | 6 | 2 | 18 | 0 | 0 | 0 |
| s6-incj-r1 | 9 | 6 | 2 | 6 | 0 | 9 | 0 |
| s6-incj-r2 | 8 | 6 | 2 | 9 | 0 | 0 | 0 |

Dangerous closures in all cells above: 0.

### T5. Fallback to full, by reason (every inc cell)

- incremental packets sent: 21 (s1-inc-r1, s1-incj-r1, s1-incj-r2, s2-inc-r1, s2-inc-r2, s2-incj-r1, s2-incj-r2, s3-inc-r1, s3-inc-r2, s3-incj-r1, s3-incj-r2, s4-inc-r1, s4-inc-r2, s4-incj-r1, s4-incj-r2, s5-inc-r1, s5-inc-r2, s5-incj-r1, s5-incj-r2, s6-incj-r1, s6-incj-r2)
- full: finding_unmapped: 6 (s1-inc-r2, s1-incraw-r1, s2-incraw-r1, s3-incraw-r1, s4-incraw-r1, s5-incraw-r1)

### T6. Engine outcome of the cells that stayed incremental

- main: blocked / final_panel_seat_parser_failed: 2 (s1-inc-r1 [object,object,lines+object-or-lines]; s3-inc-r2 [object,lines+object-or-lines,object])
- spec wording: awaiting_disposition / acceptance-bound policy requires explicit depth-0 authority for every non-exact finding: 8 (s1-incj-r1 [object,object,object]; s2-incj-r1 [object,object,object]; s3-incj-r1 [object,object,object]; s3-incj-r2 [object,object,object]; s4-incj-r1 [object,object,object]; s5-incj-r1 [object,object,object]; s5-incj-r2 [object,object,object]; s6-incj-r2 [object,object,object])
- spec wording: blocked / final_panel_seat_transport_failed: 2 (s1-incj-r2 [object,other,object]; s4-incj-r2 [no_verdict,object,object])
- main: blocked / final_panel_families_below_minimum: 7 (s2-inc-r1 [object,lines+object-or-lines,lines+object-or-lines]; s2-inc-r2 [object,lines+object-or-lines,lines+object-or-lines]; s3-inc-r1 [object,lines+object-or-lines,lines+object-or-lines]; s4-inc-r1 [no_verdict,lines+object-or-lines,lines+object-or-lines]; s4-inc-r2 [lines+object-or-lines,lines+object-or-lines,lines+object-or-lines]; s5-inc-r1 [object,lines+object-or-lines,lines+object-or-lines]; s5-inc-r2 [object,lines+object-or-lines,lines+object-or-lines])
- spec wording: blocked / final_panel_seat_parser_failed: 2 (s2-incj-r2 [object,object,object]; s6-incj-r1 [object,object,object])

### T7. Verdict-word filter and claim length over the real round-1 claims

Round-1 finding lines scanned: 362. Matching the verdict-word filter (/VERDICT|SHIP-AS-IS|FIX-THEN-SHIP|NO-FINDING-PROOF/i): 0. Longer than the 400-character addendum cap: 29. Without any path:line: 63.
Cells whose fallback reason was the verdict-word filter (`addendum_malformed`): 0.

Total estimated spend: USD 17.40 over 201 seat calls (cap USD 40).
