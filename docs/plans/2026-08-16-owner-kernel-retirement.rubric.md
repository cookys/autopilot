# Rubric — Owner Kernel retirement & quarry extraction

- R1: [rationale] The retirement is justified architecturally — the machinery addresses record
  integrity and emitter authentication while the governing threat is claim veracity (no independent
  re-derivation anywhere in the kernel; truth enters only via caller-injected verifier adapters that
  were never implemented) — and is NOT justified by zero-output telemetry of an unlaunched system.
- R2: [separability] The delete-set is exactly separable from the survivors:
  `canonical/errors/task-authority/policy/actions` keep their paths (36 external requirers), the
  `supervised-*` family is untouched, and the pre-delete symbol grep (P2 step 1) catches hidden
  consumers of `src/engine/index.js` re-exports before anything is removed.
- R3: [knowledge preservation] Everything of unique policy value in the delete-set survives —
  `references/evidence-contract.md` captures the acceptance-predicate content (green evidence per
  leg, non-self non-same-family challenger clear, zero blocking findings, contract frozen at
  intake, evidence bound to artifact) and the terminal-issuer invariants; quarry anchors make
  resurrection possible; nothing else in the deleted 15,141 lines carries policy value that is lost.
- R4: [/l5 downgrade] Advisory mode keeps an audit trail (logged stderr warning + override logging),
  weakens no other gate, and neutralizes the 2026-08-17 claim-expiry hard block; claims remain as
  documentation of last verification.
- R5: [unwiring completeness] After P3, no shipped doc, skill, template, or mirror claims retired
  machinery exists or fires — the exact documented-but-dead failure mode this repo catalogued in
  `references/evidence-discipline.md`.
- R6: [host-residue safety] Archive-before-delete ordering is enforced (P1 lands before P2/P5),
  sudo steps are user-executed only, and rollback (git revert + archived `/etc` copies) genuinely
  restores the pre-plan state.
- R7: [gate adequacy] `validate.sh` + the full `hooks/tests/` suite + the KR2 grep gate + the
  inventory/parity gates + `preflight-release.sh` cover the change; test deletion follows the
  read-target-first rule so no kept module loses its only coverage.
- R8: [scope discipline] No new trust machinery and no redesign implementation is smuggled in; the
  supervised-substrate verdict and skill contract-card rewrites are deferred to named BACKLOG rows;
  the PATCH / authorized-breaking change-policy record is coherent with the repo's semver policy.
