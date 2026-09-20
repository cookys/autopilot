# Seq 19 review — LSM P4 finish-flow and honest closeout

## Result

`READY`

Implementation commit: `f77866a`

## Minimum shippable version

- `autopilot status task --root-run-id <id>` resolves one exact task bundle and emits a
  digest-bound task-status receipt. Human output starts with `DONE` only when `can_close=true`;
  otherwise it starts with `NOT DONE`, the first blocker, and an exact next action.
- Product merge, consumer update, push, and lifecycle residue remain independent labels.
- LSM consumes a complete P3 execution receipt only when its root, manifest seal, ordered declared
  edges, modes, endpoint validations, restoration proof, edge digests, and terminal digest match.
- L5/L6 instructions require fresh task status before merge, after merge, and before marker clear.
  Marker clear accepts only a fresh, repo/root-bound, digest-valid LSM receipt with
  `can_close=true`; S/Fix/H behavior is unchanged.
- Marker deletion is idempotent only for an absent marker; other unlink failures fail closed and
  an allegedly successful clear verifies the marker is gone.
- `admit-backlog-follow-ups.js` accepts only canonical, evidence-backed, positive-value candidates;
  locks and rereads the backlog, writes atomically, dedupes by stable fingerprint, detects metadata
  conflicts, and emits a sealed admission receipt with `current_ticket_reopened=false`.

## Deterministic evidence

- `bash hooks/tests/status-task.test.sh` — PASS, including exact sealed-preflight edge binding.
- `bash hooks/tests/status-finish-followup.test.sh` — PASS, 23 assertions.
- `bash hooks/tests/status-cli.test.sh` — PASS, 26 assertions.
- `bash hooks/tests/session-mode.test.sh` — PASS, 21 assertions.
- `bash hooks/tests/autopilot-cli.test.sh` — PASS, 54 assertions.
- Merge-intent 24 assertions, merge-execute 38 assertions, lifecycle 63 assertions — PASS.
- Independent black-box transcript — PASS; oracle self-test also passed all 8 anti-vacuity
  mutations.
- Syntax, schema, diff, completeness, secret, canonical-invariant, agent-body sync,
  version-sync, and 28-skill validation — PASS / zero new findings.

## Bounded heterogeneous review

### Independent oracle repair

- The first public black-box run found one real blocker: a portfolio candidate could add an
  unknown `classification: "nitpick"` field and still be admitted because the parser ignored
  unknown keys.
- The smallest repair requires the exact canonical review-portfolio candidate key set. A dedicated
  regression now proves the nitpick shape is rejected as `noncanonical_candidate`.
- The repaired oracle passed the full transcript, valid-candidate first admission, duplicate
  replay, seven rejection attacks, marker refusal/success, human/JSON equivalence, and checkpoint
  ordering.

### Final panel

- Qwen3.8-Max-Preview returned parser-valid `SHIP-AS-IS` with a structured no-finding proof tied
  to R1–R10 and named tests.
- GLM-5.2 independently returned parser-valid `SHIP-AS-IS` with a structured proof covering status,
  merge execution, marker authority, admission safety, and false-clean prevention.
- Depth-0 earlier found and repaired two additional concrete gaps before final dispatch:
  execution edges now match the sealed preflight refs/modes exactly, and marker-clear unlink errors
  other than `ENOENT` no longer report false success.

## Follow-up admission

The bounded union/scoring mechanism emitted and the new rail admitted these candidates exactly
once; replay returned only `duplicate`, and all receipts kept `current_ticket_reopened=false`:

- `fd4e5ef9…` — durable merge execution crash recovery.
- `9cc8a47d…` — bind dirty content continuity from preflight to execution.
- `bedd809a…` — recover stale backlog admission locks safely.

The panel's request for additional in-repo copies of attack cases was rejected because the
independent oracle already executes the full matrix. GLM's suggested per-field re-derivation in
marker clear was rejected because LSM's digest-valid aggregate `can_close` is intentionally the
sole closeout authority.

The checkpoint sequence is enforced by the L5/L6/finish-flow methodology surfaces; P4 does not
invent a new merge coordinator/event ledger outside the frozen file boundary.

LSM P5 may begin.
