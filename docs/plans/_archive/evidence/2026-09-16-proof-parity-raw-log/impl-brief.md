# Implementation brief — proof-parity-raw-log-2026-09-16

You are the implementer of ONE managed deliverable. The harness commits your work; you never push,
never `git stash`, never touch files outside `output_paths`, never run a real reviewer binary or hit
an endpoint — suites use PATH stubs and fixtures only. Grant base: `b6a5e42e`. The rubric pins RED
evidence and byte-identity against `0e3ea3cc`; every product file is byte-identical between the two
(docs-only commits in between) — cite `0e3ea3cc` in headers.

## Read first (in this order)
1. `docs/plans/_archive/2026-09-16-proof-parity-raw-log.md` — §0 measured facts, §1 ruling (four points —
   the normalized-emptiness precedence and the single `outcome.raw_log` seam are normative), §2 per-file
   changes and the test list, §2.5 exact output_paths, §4 acceptance incl. `scope-integrity`.
2. `docs/plans/_archive/2026-09-16-proof-parity-raw-log.rubric.md` — R1–R10.
3. `src/runners/review.js`: `isValidNoFindingProof` :51 + `NO_FINDING_TAUTOLOGIES` :31,
   `parseReviewOutput` :150 (the two throw sites for the proof), `dispatchReviewJson` :228-290.
4. `scripts/dispatch-review.sh` ~545-600 (battery: proof line extraction, the label regex ~575, the
   blacklist `case` ~583; two `BATTERY_FAIL_REASON` strings).
5. `src/engine/autopilot-engine.js`: `reviewResultBlocked` :562, the blocked review record ~3363-3395,
   `performReview` ~4728-4990 (the non-reviewed return `{ reviewed:false, reason, raw }` ~4849),
   `finalPanelSeatReceipt` ~4986-5015, `performFinalPanel` ~5017-5100.
6. `src/engine/campaign-composition.js` `FINAL_PANEL_SEAT_KEYS` ~318 and the seat validation just
   below; `schemas/implementation-campaign-receipt.schema.json` ~212-236 (seat definition).
7. Suites you extend: `hooks/tests/review-runner.test.sh` (:140-250 fixtures), `hooks/tests/
   dispatch-review.test.sh` (:100-150 proof fixtures, stub runner idiom), `hooks/tests/
   implementation-campaign-routing.test.sh` (engine blocks with `reviewDispatcher` stubs :1140, :2056,
   :2539 and the final-panel wiring), `hooks/tests/implementation-campaign-receipt.test.sh`
   (`finalPanelReceipt` :26).

## Product changes (plan §1/§2 are normative)
1. Grammar parity: bash `^checked=(.+)[[:space:];,.]+evidence=(.+)[[:space:];,.]+conclusion=(.+)$`,
   Node `/^checked=(.+)[\s;,.]+evidence=(.+)[\s;,.]+conclusion=(.+)$/u`. On BOTH sides, after the
   match, normalize each capture exactly as the blacklist does (lowercase; strip leading/trailing
   whitespace and punctuation); normalized-empty → SHAPE failure; else blacklist → SEMANTIC failure.
   Node throws two distinct messages (plan §1.1 text); bash keeps its two existing
   `BATTERY_FAIL_REASON` strings (the empty case must land on the "must contain non-empty …" one).
   Blacklist contents unchanged. `isValidNoFindingProof` may become a classifier returning
   `'ok' | 'shape' | 'tautology'`; keep its export.
2. Salvage in `dispatchReviewJson` (plan §1.2): on `parseReviewOutput` throw, `JSON.parse(stdout.trim())`
   in a try; if object with non-empty string `raw_log` → `salvaged: { runner, model, raw_log }` with
   runner/model from the `--runner`/`--model` args (`argValue`), nothing else copied; otherwise no
   `salvaged` key. `result` stays null, `parseError` stays.
3. Propagation (plan §1.3): blocked review record gets top-level `raw_log` (salvaged path or null);
   the `dispatch_review blocked` ledger entry gets `raw_log`; `performReview`'s non-reviewed return
   gets top-level `raw_log` (from `reviewed.raw_log` when present, else null). `finalPanelSeatReceipt`
   adds `raw_log` ONLY when the outcome's top-level `raw_log` is a non-empty string and the seat is
   not reviewed; the key is absent otherwise; it is part of the digested body.
4. `campaign-composition.js`: seat validation = exact `FINAL_PANEL_SEAT_KEYS`, with `raw_log`
   optional (non-empty string when present); unknown keys still rejected. Schema: add optional
   `raw_log` (`string`, `minLength: 1`), keep `additionalProperties: false`, `required` unchanged.
Mirrors: `bash scripts/sync-codex-plugin-skills.sh` then `--check` (scripts, src, schemas, skills).

## Tests (plan §2 test list is normative; header comments with RED at base 0e3ea3cc + observed message)
- `review-runner.test.sh`: ONE shared vector table (heredoc `proof|expected` rows, expected ∈
  `ok|shape|tautology`) run through (a) the bash battery — invoke `dispatch-review.sh` with a PATH stub
  runner that prints the wrapped VERDICT block with that proof, read the envelope's status/error —
  and (b) `parseReviewOutput` on a synthetic envelope carrying the proof. Rows: `;`/`.`/`,`/space/
  mixed separators (ok), `;` inside a field (ok), missing label, reordered labels, `|` separator,
  empty checked/evidence/conclusion (shape), each blacklist entry in each field (tautology). Assert
  per row both sides agree and Node's message class matches. Salvage cases per plan (exact
  `raw_log`, runner/model from args when the envelope lies, malformed JSON → none, `""`/non-string →
  none, SHIP-AS-IS in the rejected envelope leaves no verdict/status/findings anywhere in the result).
- `dispatch-review.test.sh`: battery accepts `.`/`,`/space/mixed and a doubled separator; rejects
  `|` (shape message) and a blacklist value (tautology message); pin the observed base state.
- `implementation-campaign-routing.test.sh`: engine block — reviewDispatcher stub emitting a
  shell-shaped envelope with a `.`-separated proof → `reviewed` (RED at base: blocked with the
  tautology message); stub emitting a genuinely tautological conclusion → blocked with the tautology
  message, blocked record + ledger entry + performReview outcome (capture via the composition adapter
  seam or the returned reviewChain) carry `raw_log` (RED at base); final panel with one seat's stub
  emitting a rejected envelope → that seat's receipt `status` no_verdict/parser_failed, verdict and
  review_digest null, `raw_log` = the path, excluded from `final_panel_count`, panel blocks (RED at
  base: no key); other seats' receipts have no `raw_log` and identical digests to base (preservation).
- `implementation-campaign-receipt.test.sh`: v1 receipt without `raw_log` valid (preservation); failed
  seat with `raw_log` valid, tampering the path breaks the digest (RED at base: schema rejects the
  key); `raw_log: ""` rejected; an unrelated extra key with a recomputed valid digest rejected by BOTH
  composition validation and schema (preservation).
Run each suite at base BEFORE product edits and paste the observed failing messages. Do not weaken
or delete any existing assertion.

## Docs
- `docs/BACKLOG.md`: the row "Managed rail (cuda P1): GLM tautological no_finding_proof …" keeps
  `Status: fired 2026-09-16`; append to its Context: " (ii)+(iii) shipped v2.36.57: Node grammar
  aligned with the battery, raw_log salvaged on rejection; (i) pre-spend admission is
  docs/plans/_archive/2026-09-16-final-panel-blind-admission.md (next)." Then
  `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` must exit 0 (Context ≤ 240 bytes —
  shorten the existing Context text if needed, keep the three defects named).
- `skills/l5/references/hetero-impl-loop.md` step 11 fixed list: append "proof grammar parity +
  raw_log on rejected envelopes v2.36.57"; regenerate the mirror. Do NOT touch CHANGELOG.md or any
  version manifest.

## Verify (all, one at a time, foreground; all green)
```
bash hooks/tests/review-runner.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/status-task.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash scripts/check-canonical-invariants.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat 0e3ea3cc -- src/engine/implementation-campaign.js src/engine/campaign-intake.js src/campaign/cli.js scripts/dispatch-anthropic-review.js   # must print nothing
```

## Sealed output_paths (the ONLY files you may change)
```
scripts/dispatch-review.sh
platforms/codex/plugin/scripts/dispatch-review.sh
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/review-runner.test.sh
hooks/tests/dispatch-review.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```
Finish with a clean tree, changes committed as the harness instructs; report the RED-at-base
messages and every suite's pass/fail count.
