# Evidence and Eval Truth Rubric

## R1 Failure classification is closed and evidence-backed

Every failed orchestration-eval row has exactly one valid `failure_class`, and the classifier uses
observable process/oracle evidence rather than duration alone.

## R2 Scoring fails closed

`score.js` rejects an `oracle_pass:false` row whose class is absent or unknown, excludes
`infra_fail` from capability statistics, and prints an explicit excluded tally.

## R3 Transcript import is aggregate-only

Supported transcript schemas produce de-identified aggregate metrics without raw messages, prompts,
paths, session IDs, credentials, or transcript fragments.

## R4 Import remains honest about missing and biased data

Agy token/cost stays unavailable, truncation is reported, and OpenCode calibration cohorts are not
presented as general-use cost evidence.

## R5 Import is deterministic and non-authoritative

Re-importing identical inputs is byte-stable/idempotent, and imported telemetry cannot create a
qualified row or routing ladder candidate.

## R6 MiniMax limitations cannot be silent

The recorded 5/6 false-central-claim limitation is mechanically surfaced for the diff-only reviewer
seat, or the seat is demoted only to an already-qualified replacement.

## R7 Verification has real negative controls

Tests demonstrate rejection of unclassified failures, raw-content leakage, non-idempotent import,
and removal of the MiniMax caveat/demotion guard.
