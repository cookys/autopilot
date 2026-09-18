# Implementation brief — shared-packet (blind review redesign cut 2-C, deliverable 2 of 2)

ONE managed deliverable. The harness commits; never push, never `git stash`, never touch files outside the sealed
`output_paths`, never run a real reviewer model. Base for RED evidence and byte-identity: `fd4ea3a6`.
This campaign ships plan §1.2 ONLY (one packet build per candidate, private per-seat copies, batched tree hash).
§1.1 (the panel station) shipped in v2.36.68 — do NOT touch `src/engine/campaign-composition.js`,
`campaign-intake.js`, any resolver, `scripts/dispatch-review.sh`, `scripts/lib/*`.

## Read first
1. `docs/plans/2026-09-18-blind-review-panel-station.md` — §0 (third bullet), §1.2 items 1–4 NORMATIVE, §2.2, §2.5
   (second list), §2.6, §4 (`packet-once`, `tree-hash-batch`), §4.1. The plan wins over this brief. Then
   `.rubric.md` R4–R5, R6–R8.
2. `src/runners/review-packet.js` (`hashObject` :249, `verifyTreeIntegrity` :264, `buildReviewPacket` :311, hash
   preimage :548-573), `src/runners/review.js` (`prepareReviewLaunch` :209, `dispatchReviewBatch` :326,
   `dispatchReviewJsonBatch` :503), `src/engine/autopilot-engine.js` (`runPanel` :5255 — the seat loop calls
   `performReview({deferDispatch})` per seat then `dispatchReviewJsonBatch` :5408; `packet_hash` collection :5512).

## Product (plan §1.2 normative)
1. BUILD ONCE. `review.js` exports `buildPacketOnce(identity)` — identity `{repo, baseSha, candidateSha, diffFile,
   specFile, denyExtra}` → `{ packet_dir, packet_hash, manifest, dispose() }` (its own mkdtemp, 0700). It is the ONLY
   call site of `buildReviewPacket(` in `review.js` (the runner suite counts exactly one call + the definition —
   keep `builder_callers=2`). `prepareReviewLaunch(args, { packet, sharedPacket })`: when `sharedPacket` is given,
   no build — materialise it into the seat's own `mkdtemp` (item 2); when absent, build via `buildPacketOnce`
   (batch of one) — byte-identical launch args/env/hash to base for the same identity. `dispatchReviewBatch` /
   `dispatchReviewJsonBatch` accept one `sharedPacket` applied to every job (pass-through per item is fine).
2. MATERIALISE PER SEAT. `review-packet.js` exports `materializePacket(srcDir, dstDir)` — plain per-file copy
   (`fs.copyFileSync`, `COPYFILE_FICLONE` allowed, NEVER a hardlink: no `linkSync`), symlinks recreated with the same
   target bytes, modes preserved — returning the re-derived hash; and `hashPacketDir(dir)` — the builder's OWN preimage
   function (factor it out of `buildReviewPacket` so both use one code path; read `base_sha`/`candidate_sha`/`deny_list`
   from `MANIFEST.json`). Before a seat launches, its dir is re-hashed with `hashPacketDir` and must equal the shared
   `packet_hash`; mismatch → that seat is `precondition_failed` before spend (`skipLaunch: true`, reason on the outcome
   row; the engine keeps its `reviewed:false` shape). After the batch nothing is re-hashed. `packet_hash` on every seat
   receipt / `AUTOPILOT_REVIEW_PACKET_HASH` = the shared build's hash; `AUTOPILOT_REVIEW_PACKET_DIR` = the seat's copy.
3. HASH THE TREE ONCE. `verifyTreeIntegrity` batches regular files whose path contains neither `\n` nor `\r` through
   ONE `git hash-object --stdin-paths --no-filters` process (cwd = treeDir, same `-c extensions.objectFormat` rule as
   `hashObject`); LF/CR names go through today's per-file `hashObject`; symlinks hashed in-process from
   `readlinkSync` bytes as today. Compare in tracked-file order — the FIRST mismatch throws `tree integrity: <rel>`
   with the same text as base; the unlisted-file walk unchanged. Report the before/after wall time of one
   `buildReviewPacket` on this repo's HEAD in your final message (depth-0 records it; base 21 s).
4. ENGINE. In `runPanel` (both stations: `panel` and `terminal`) build the packet ONCE per candidate with
   `buildPacketOnce` and pass it as `sharedPacket` to every seat's prepared launch; dispose it after the batch.
   `performReview` for the single seat is unchanged in behaviour (batch of one through the same path). The 2-B
   all-or-none / one-value `packet_hash` validator stays.
5. Byte-identity (§2.6): `scripts/dispatch-review.sh`, `scripts/lib/cleanroom-launch.sh`, `scripts/lib/review-fanout.js`,
   every resolver, `campaign-composition.js`, `campaign-intake.js` untouched.
6. Docs: `references/blind-dispatch.md` "Packet blinding" paragraph: one build per candidate, private per-seat copies
   (no hardlinks), pre-launch re-hash, batched integrity; `docs/BACKLOG.md` row "Review packet: `verifyTreeIntegrity`
   spawns …" Status → `shipped v2.36.69 2026-09-19`; redesign row (1a-B) Context (≤240 B, measure with `wc -c`) →
   `packet (tree + git diff + spec, deny-list); packet/cleanroom tiers; intake canary; verify-once; parallel seats;
   quorum + snapshot; panel station; shared packet. Shipped: 1a-A..2-C v2.36.59-69. Open: 2-D overlap/pre-pass.`
7. `sync-codex-plugin-skills.sh` then `--check`. Do NOT touch CHANGELOG.md or version manifests.

## Tests (RED-first, `# RED at base fd4ea3a6: <observed>`; never weaken)
review-packet: batched hashing equals per-file hashing on a fixture tree with a symlink, a NUL-unsafe name and a
newline-bearing name (pin `hashObject` call count = LF/CR files only); mismatch text and first-mismatch order equal
base; `materializePacket` copy is a distinct inode tree (every regular file's `ino` differs; `nlink === 1`) with equal
bytes and equal `hashPacketDir`; mutating a file in one seat dir leaves the other seat dir and the shared hash
unchanged; a seat dir whose pre-launch re-hash differs is refused `precondition_failed` (no launch). review-runner:
three jobs, one shared packet → `packet_hash` equal on all three, three distinct launch dirs (none the shared dir),
exactly ONE `buildReviewPacket` invocation and N=3 `hashPacketDir` calls counted SEPARATELY (wrap the exports);
batch of one without `sharedPacket` byte-identical (args, env keys, hash) to base. engine: `real_batch_panel`
asserts one packet build for three seats and one `packet_hash` across seat receipts. Report each RED observation
verbatim (depth-0 files them). Run each suite at base BEFORE edits.

## Verify (§4.1; one at a time, foreground, all exit 0; `env -u AUTOPILOT_SESSION_ID`)
```
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat fd4ea3a6 -- scripts src/engine/campaign-composition.js src/engine/campaign-intake.js src/engine/resolve-review-loop.js schemas  # empty
```

## Sealed output_paths (ONLY files you may change; every `platforms/codex/plugin/...` twin is sealed too — sync, don't hand-edit)
```
src/runners/review.js
src/runners/review-packet.js
src/engine/autopilot-engine.js
hooks/tests/review-packet.test.sh
hooks/tests/review-runner.test.sh
hooks/tests/autopilot-engine.test.sh
references/blind-dispatch.md
docs/BACKLOG.md
```
`docs/plans/evidence/**` is NOT yours — never write there. Finish with a clean tree; report RED-at-base messages,
suite counts and the integrity timing.
