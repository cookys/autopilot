# Rubric — 2026-09-16-ledger-rotation-order.md

> Source plan: docs/plans/_archive/2026/09/2026-09-16-ledger-rotation-order.md

R1: After two forced rotations (`RUN_LEDGER_MAX_BYTES=1`, `RUN_LEDGER_MAX_ROTATIONS=1`) with no original journal row left in any segment, BOTH `${ledger}.1` and the live segment list the campaign's intake + three event journals in append order, every copy `_rotation_carry:true`, each `_rotation_root` exactly once per segment.
R2: `projectCampaign(loadRows(ledger), campaignId)` on that carry-only snapshot does not throw and returns the expected phase, event count and `last_output_artifact_digest`; at base it throws `event input artifact must match the prior output artifact`.
R3: The fixture is deterministic and self-checking: the three event rows share one journal `ts` (pinned via a `date` shim that only intercepts the `iso_ts` argv) and one `observedAt`, use pinned idempotency keys, and the test asserts as a precondition that the lexically sorted rotation roots differ from append order (failing as `fixture not discriminating`, never passing vacuously).
R4: The journal carry in `scripts/run-ledger.sh` keeps first occurrence per `_rotation_root` in oldest-to-live order and uses no sorting primitive (`group_by`, `unique_by`, `sort_by`, `sort`) on journal rows; `_rotation_root` derivation and the `_rotation_carry` flag are unchanged.
R5: Stage carry is unchanged: latest leased row per `(run_id, stage)` present exactly once in the live segment after rotation; `query-latest` returns the pre-rotation generation and nonce (preservation guard, green at base).
R6: No reader change: `src/` is byte-identical to base `41193a66` (`git diff --stat 41193a66 -- src/` empty); no reader-side reordering or chain recovery is introduced.
R7: Existing suites green: `hooks/tests/run-ledger-rotation.test.sh`, `run-ledger-directive.test.sh`, `implementation-campaign-dogfood.test.sh`, `campaign-claim-resolve.test.sh`, `next-touch-validation.test.sh`, `mission-runtime-v2.test.sh`; `bash scripts/sync-codex-plugin-skills.sh --check` passes (codex mirror of `run-ledger.sh` and of the l5 reference byte-identical).
R8: Every change-pinning assertion (R1, R2) is recorded RED against base `41193a66` in the test header with the failing message; preservation guards (R5) labelled as such. Tests touch only sandbox ledgers under `$TEST_TMP`, never the host ledger.
R9: Docs: the BACKLOG row's Context names the real mechanism (`group_by` sorted the journal carry) with Status `shipped v2.36.54`; a new open row records the already-scrambled segments follow-up; `skills/l5/references/hetero-impl-loop.md` step 11 adds the fixed item with its version; no other reference text changes.
R10: No file outside the sealed `output_paths` changes.
