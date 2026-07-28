# Seq 18 review — LSM P3 merge execution receipts

## Result

`READY`

Implementation commit: `a401f35`

## Minimum shippable version

- `autopilot merge execute` accepts only an exact sealed manifest plus a digest-valid P2 preflight.
- Every edge revalidates canonical repository/worktree binding, source and target SHAs, target
  symbolic ref, dirty inventory, and preserved content before mutation.
- Dependent endpoints consume authenticated predecessor execution receipts rather than the initial
  P2 observation.
- Only declared `no-ff` and `ff-only` modes execute. Receipts record ordered before/after SHAs,
  merge commits, conflicts, preservation evidence, terminal status, and a canonical digest.
- Path-scoped staged, unstaged, untracked, symlink, and executable-mode state is restored exactly.
  Ignored-path and directory/file-prefix collisions fail closed.
- Conflict recovery is reported successful only when dirty state, target ref/HEAD, and operation
  markers all return to the pre-edge state.
- The executor contains no push, branch/worktree deletion, stash creation, or stash-drop path.

## Deterministic evidence

- `bash hooks/tests/merge-execute.test.sh` — PASS, 38 assertions.
- `bash hooks/tests/merge-intent.test.sh` — PASS, 24 assertions.
- `bash hooks/tests/autopilot-cli.test.sh` — PASS, 54 assertions.
- `node /tmp/lsm-p3-normalized.js .../autopilot .../src/merge/cli.js` — PASS with explicit
  no-finding proof for independent invariants V1–V10.
- JS syntax, receipt schema parsing, diff, completeness, secret, canonical-invariant,
  skill-validation, agent-body sync, and version-sync checks — PASS / zero new findings.

## Bounded heterogeneous review

- Qwen3.8-Max-Preview returned parser-valid `SHIP-AS-IS`, `FINDINGS: none`, and a structured
  no-finding proof covering the seal gate, predecessor binding, exact modes, preservation restore,
  drift/conflict fixtures, negative capabilities, schema, and security-sensitive path handling.
- GLM-5.2 independently returned parser-valid `SHIP-AS-IS`, `FINDINGS: none`, and a structured
  no-finding proof tied to named functions and assertions. It explicitly checked exact pre-edge
  revalidation, merge graph semantics, rollback evidence, executable-mode restoration,
  ignored-path collision handling, and absence of forbidden Git operations.
- The union contains no admitted `MUST-FIX`. Both reviewers inspected concrete surfaces and proved
  their no-finding verdicts; neither passed through an empty response or generic approval.

## Cut / follow-up

- A durable on-disk write-ahead log for process-crash recovery is outside the frozen P3 contract:
  the phase grants no receipt storage path or lifecycle authority. It is a bounded follow-up
  candidate, not a blocker.
- P2 binds dirty path categories; P3 additionally fingerprints exact content/index state at
  execution start and before each edge. Proving content continuity all the way back to P2 issuance
  would require a P2 contract/schema expansion and is therefore a bounded follow-up candidate.
- LSM P4 owns evidence-backed follow-up dedupe and backlog admission. These candidates must pass
  that gate rather than expanding P3.

LSM P4 may begin.
