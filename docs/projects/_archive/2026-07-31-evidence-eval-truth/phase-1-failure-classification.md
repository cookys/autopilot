# Phase 1 — Failure Classification

## Goal

No failed orchestration-eval row enters a score without an evidence-backed cause.

## Design

- Add a closed `failure_class` vocabulary: `capability_fail|infra_fail`, plus a class-specific
  `failure_cause` vocabulary: capability failures permit only `oracle_rejected`; infrastructure
  failures permit only `runner_timeout|authentication|runner_error|empty_output|missing_oracle|oracle_error`.
- Use runner exit, timeout/auth/empty-output evidence, and oracle outcome; duration alone is not
  sufficient.
- Reject absent/unknown classification at scoring time.
- Reject successful rows that carry either failure metadata field.
- Exclude infrastructure failure from both capability and adherence denominators while printing
  its count and causes.
- Preserve already-valid historical rows.

## Tasks

- [x] Plant unclassified, auth, timeout/empty, and real oracle-reject fixtures.
- [x] Prove the existing scorer accepts the planted unclassified failure before the repair.
- [x] Emit the class from the real runner result path.
- [x] Enforce the class in `score.js`.
- [x] Add the explicit infra-excluded report row/footer.
- [x] Run the full orchestration-eval hermetic suite.

## Verification

Acceptance pattern A5:

```bash
bash hooks/tests/orchestration-eval.test.sh
```

The suite must show capability failure included, infrastructure failure excluded and counted,
unclassified failure rejected, and successful runs unchanged.
