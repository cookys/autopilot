# Implementation brief — blind-review-packet-engine-2026-09-17 (cut 1a-B)

You implement ONE managed deliverable. The harness commits; you never push, never `git stash`,
never touch files outside the sealed `output_paths`, never run a real reviewer binary or build a
real review packet inside a test — stubs only. Base for RED evidence and byte-identity: `bee8da3d`.

## Read first (in this order)
1. `docs/plans/2026-09-17-blind-review-packet-engine.md` — §1 (items 1, 1b, 2–6) is NORMATIVE and
   complete; §2 is the test list (every lettered item is a required assertion); §2.5 sealed paths;
   §2.6 constraints; §4 + §4.1 acceptance and the exact verify commands. The plan wins over this brief.
2. `docs/plans/2026-09-17-blind-review-packet-engine.rubric.md` — R1–R9.
3. `src/engine/autopilot-engine.js`: `reviewDiff` (~`:2945`; options block ~`:3366-3378`, success
   return ~`:3429`); `_runManagedCampaignComposition` closures `prepareReview` (~`:4701`),
   `performReview` (~`:4768`, reviewOptions ~`:4900`, success return ~`:5040`),
   `finalPanelSeatReceipt` (~`:5053`), `performFinalPanel` (~`:5086`); terminal site in
   `_runImplementationReviewLoop` (~`:9683` diffProvider, ~`:9791` reviewOptions).
4. `src/engine/campaign-composition.js:318-420` (`FINAL_PANEL_SEAT_KEYS`, `hasFinalPanelSeatKeys`,
   `validateFinalPanelReceipt`) and the `raw_log` precedent it already carries.
5. Tests you extend: `hooks/tests/autopilot-engine.test.sh` (`createEngine(noReviewSpec)` fixture
   ~`:4052-4136`; the `reviewDiff` stub idiom at the top of the file);
   `hooks/tests/implementation-campaign-routing.test.sh` (`proofRoster` / `runRedPath({ proofPanel })`
   ~`:2438-2478` — the REAL `performReview`/`finalPanelSeatReceipt` run there);
   `hooks/tests/implementation-campaign-receipt.test.sh` (`raw_log` block ~`:951-1035`);
   `hooks/tests/implementation-campaign-dogfood.test.sh` (kill→resume run ~`:660-770`, it already
   captures `reviewArgsSeen`). `hooks/tests/lib.sh` for `TEST_TMP`/asserts.

## Product (plan §1 normative; this is the order of operations)
1. `reviewDiff`: in the options block, ALWAYS `delete reviewOptions.packet`; then, ONLY when
   `reviewOptions.blindDiscovery === true` AND `input.packet` is an object with three non-empty
   strings `{ repo, baseSha, candidateSha }`, set `reviewOptions.packet` to exactly that; a present-but-malformed `input.packet` → the existing
   `prepare_review` blocked shape with reason `packet must be { repo, baseSha, candidateSha }`
   before the dispatcher is called. Success return: add `packet: reviewResult.packet` ONLY when
   `reviewResult.packet.packet_hash` is 64 lower-case hex; otherwise NO key (never `null`).
2. Campaign `performReview`: derive `{ repo: loopCwd, baseSha: base, candidateSha: candidate.commit }`
   — the SAME `base`/`commit` `prepareReview` handed `diffProvider` (never `currentBase`, never a
   tree sha). If either is not a non-empty string return `{ reviewed: false, phase: 'prepare_review',
   reason: 'review packet identity unavailable' }` BEFORE `this.reviewDiff`; else pass it as
   `packet:` in the `reviewDiff` input. Success return: `packet_hash: reviewed.packet.packet_hash`
   only when `reviewed.packet` exists (key absent otherwise).
3. Terminal site (`_runImplementationReviewLoop`): same derivation with `immutableBase` and the
   round's `commit`; missing → `finish({ status: 'blocked', phase: 'prepare_review', reason:
   'review packet identity unavailable', … })` in the shape the surrounding code already uses.
4. `finalPanelSeatReceipt`: `body.packet_hash = outcome.packet_hash` only when `isReviewed` and
   the value is 64 lower-case hex (inside the digested body, like `raw_log`). Never on a failed seat.
5. `performFinalPanel`: over `reviewedOutcomes`, if some have `packet_hash` and some do not, or
   two distinct values exist → `reviewed: false`, `verdict: null` (same branch shape as
   `findingsConsistent === false`); all-absent or all-equal → unchanged. Add NO new key to the
   panel object.
6. `campaign-composition.js`: `const FINAL_PANEL_SEAT_OPTIONAL_KEYS = Object.freeze(['raw_log',
   'packet_hash'])` (exported) replaces the inline `'raw_log'` allow-set in `hasFinalPanelSeatKeys`.
   In `validateFinalPanelReceipt`, after the existing per-seat loop: `packet_hash` present but not
   `/^[0-9a-f]{64}$/` → `final_panel_metadata_incomplete`; present on a non-`reviewed` seat →
   `final_panel_metadata_incomplete`; among reviewed seats mixed presence →
   `final_panel_packet_hash_mixed`; ≥2 distinct values → `final_panel_packet_hash_mismatch`;
   all-absent valid. Keep the existing reason ordering for everything else.
7. Schema: `$defs/finalPanelSeat.properties.packet_hash: { "$ref": "#/$defs/sha256" }`; not
   required; `additionalProperties` stays `false`.
Mirrors: `bash scripts/sync-codex-plugin-skills.sh` then `--check` (engine, composition, schema, reference).

## Tests — plan §2 is the complete list; implement every lettered item exactly
Homes: autopilot-engine (a)(b) on the `noReviewSpec` fixture + a direct `reviewDiff`; routing (c)
on the `proofPanel` stub with a per-call `packetHashes` knob; receipt suite mirrors the `raw_log`
block for every validator/schema rule; dogfood kill→resume captures dispatcher `options`.
Each RED block starts `# RED at base bee8da3d: <observed message>`: run each suite at base BEFORE
product edits and quote the messages. Re-compute `canonicalDigest(body)` in tests that read a
`packet_hash` from a receipt; assert absence with `hasOwnProperty`. Never weaken or delete an
existing assertion; the eight other receipt-building suites stay green untouched (the key is optional).

## Docs
- `references/blind-dispatch.md` § "Packet blinding (v2.36.59)": add paragraph "Engine wiring
  (v2.36.61)" — every managed review is packet-backed or blocks before dispatch, the optional seat
  `packet_hash`, mixed/mismatch rules, pointer to cut 1b. Regenerate the mirror.
- `docs/BACKLOG.md` row "Blind review redesign: blind the packet and the process boundary, not the
  runner": replace the Context value with EXACTLY: `packet (tree + git diff + spec, deny-list);
  packet/cleanroom tiers; intake canary; verify-once; parallel seats. Cuts 1a-A (v2.36.59) and
  1a-B (v2.36.61) shipped; 1b/2 open. Detail in the pointer.` (Status stays `open`). Do NOT touch
  CHANGELOG.md or version manifests.

## Verify (plan §4.1 — all thirteen, one at a time, foreground, all exit 0)
```
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/status-task.test.sh
bash hooks/tests/next-touch-validation.test.sh
bash hooks/tests/review-runner.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat bee8da3d -- scripts bin/autopilot.js src/runners   # must print nothing
```

## Sealed output_paths (the ONLY files you may change)
```
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/implementation-campaign-dogfood.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
docs/BACKLOG.md
```
Finish with a clean tree, committed as the harness instructs; report RED-at-base messages and each
suite's pass/fail count.
