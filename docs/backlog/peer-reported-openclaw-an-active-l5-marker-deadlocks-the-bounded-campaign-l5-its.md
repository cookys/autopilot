# Openclaw two leftover side effects

Relevant section of the original sidecar (English as written). The closed main claim is omitted. Source blob: b9caa7db6^:docs/backlog/peer-reported-openclaw-an-active-l5-marker-deadlocks-the-bounded-campaign-l5-its.md.

- **Status 2026-09-13**: the main claim is **shipped and verified locally**. v2.36.28's `sealed_bounded_campaign_without_mission_projection` (`scripts/dispatch-hetero.sh`, P5 of the 2026-09-12 graph) skips `check_session_mode_gate` on exactly the predicate the peer proposed — the contract carries no Mission projection and is sealed — and `hooks/tests/dispatch-hetero.test.sh:976` ("sealed bounded campaign dispatches under a live L6 marker") is green in the 234-assertion run. The reversal was justified on "unsatisfiable by construction" (a closed bounded-contract schema has nowhere to put a projection), not on marker retirement. **Remaining**: side effects (a) and (b) below; they were never reproduced here and still need the peer's artifacts.

- **Trigger (remaining)**: side effect (a) — rejection reports `released`, state keeps `live_lease` — is the third sighting of that class and the larger item; reproduce with the peer's ledger backup before designing. Side effect (b) — `verify_cmd` inherits a PATH without the operator's tool — is a precondition-vs-verification classification question.

- **Two side effects the peer saw on the same run**: (a) the `precondition_failed` rejection reports `admission_release.status=released` while the durable state keeps `live_lease`, so the next launch hits `campaign_state_lease_open` and IMPLEMENTING is not a resumable phase — they wiped the ledger by hand; (b) the `verify_cmd` subprocess inherited a PATH without their `bats` install, so `campaign_verification` failed on a tree that passes by hand — a "command not found" arguably belongs in precondition, not verification.

- **Repro artifacts for side effect (a)**, named by the peer 2026-09-12 and **held on their host, not here**: `/tmp/claude-<uid>/-home-cookys-projects-hangar/dde388b7-cbe4-4cd9-b7ac-51a122ba3821/scratchpad/{rollout-campaign.log,autopilot-ledger-bak.*}` — the second JSON result plus the backed-up `.git/autopilot` ledger still carrying `live_lease`. Paths recorded rather than contents; ask them for the files when this row is picked up, and treat them as a peer's artifacts until re-derived locally.

- **Effort**: S for the gate predicate; S including the test matrix case. The lease/release inconsistency is the larger of the two side effects.

- **Source**: peer report from openclaw via fleet relay, 2026-09-12. Not reproduced on this host.


Restored 2026-10-19 from b9caa7db6^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
