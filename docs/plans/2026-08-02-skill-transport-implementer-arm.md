# Plan — skill-transport implementer arm closure

> Status: FROZEN FOR EXECUTION
> Owner: depth-0 CEO
> Size: L
> Source: `docs/plans/2026-07-15-skill-transport-payoff-ab.md` § Phase 2 and `docs/BACKLOG.md`
> Frame: paired measurement; the deliverable is evidence plus a decision, not a production default change

## Context

The reviewer arm of the skill-transport experiment shipped in `3e7d344` and refuted H2, but the independently pre-registered implementer arm never ran. The triggered backlog item therefore remains a genuine evidence gap: whether adding the frozen implementer methodology pack improves an already-structured six-element implementation prompt.

This continuation narrows the historical plan to its only remaining executable deliverable. Historical reviewer-arm outputs are inputs, not work to replay.

## Objective and measurable result

Run one deterministic paired experiment over exactly eight S-size micro-repositories and close the implementer hypothesis with a reproducible report.

- Exactly 16 implementation cells: 8 tasks × `{nopack, pack}`.
- Every task is independently base-red before dispatch and judged by its pre-authored oracle after dispatch.
- Both arms use the same task bytes, seed, Codex model, effort, six-element prompt, timeout, and fixed independent reviewer. The only intentional arm difference is the frozen implementer pack injection.
- Every cell reaches one terminal state: `completed`, `infra_failed`, or `invalid`; missing/unparseable output is never rerolled or counted as success.
- The report emits exact paired counts, cost telemetry where available, the pre-registered H1 rule result, and a terminal backlog disposition.

## Global constraints (copied verbatim into every dispatch)

- The task set is frozen to `t1-fix-with-decoy`, `t3-vacuous-test`, `t4-config-layer`, `t7-config-rename`, `t8-log-redaction`, `t11-boundary-fix`, `t13-log-parser`, and `t15-cache-invalidation` under `evals/orchestration/tasks/`.
- The pack is frozen at `evals/skill-transport/packs/implementer-pack.md`, SHA-256 `3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca`; any byte drift aborts the entire matrix before a model call.
- The implementation engine is `gpt-5.3-codex-spark` through `scripts/dispatch-hetero.sh --runner codex`, at its normal implementation effort. If that exact model is unavailable before the first cell, stop with an infrastructure verdict; do not substitute or mix models.
- Every cell starts from a fresh copy of the same frozen task repository, initialized with one baseline commit; no branch, provider session, or worktree is reused across arms.
- Arm `nopack` receives the frozen seven-element dispatch wrapper containing the same six-element implementation task; arm `pack` receives those identical bytes plus only `--skill-mode prompt --skill evals/skill-transport/packs/implementer-pack.md`.
- Cell order is shuffled once from one recorded seed and resumed by the exact key `<engine>|<arm>|<task>`; an existing terminal key is skipped and no failed cell is silently rerolled.
- Implementer self-report and implementer-run tests are non-authoritative. Outcome authority belongs to the task's pre-authored `oracle.sh` plus one reviewer tuple frozen before cell one and from a non-OpenAI family.
- Raw model logs remain in the private Autopilot run store; committed results contain bounded metadata and normalized findings only, with no credentials, environment values, or absolute secret-bearing paths.
- No production default, review-loop roster, skill pack, dispatch rail, version manifest, release artifact, remote branch, or external publication changes in this mission.

## Change-policy decisions

- **Compatibility impact**: `internal-only` — additive evaluation tooling and evidence; no shipped runtime contract or default changes.
- **Dependency decision**: `platform/stdlib` — Bash, Node built-ins, Git, and existing dispatch scripts are sufficient; no new dependency is authorized.

## File-structure map

| Path | Responsibility |
|------|----------------|
| `evals/skill-transport/implementer-tasks.json` | Frozen eight-task manifest with task/oracle digests and verify commands |
| `evals/skill-transport/run-implementer-matrix.sh` | Base-red qualification, deterministic shuffle/resume, isolated paired dispatch, oracle and independent-review collection |
| `evals/skill-transport/implementer-report.js` | Deterministic JSONL fold and H1 rule evaluation |
| `evals/skill-transport/test/stub-implementer-dispatch.sh` | No-spend dispatcher fixture for mechanics tests |
| `evals/skill-transport/test/implementer-matrix-mechanics.test.sh` | Negative controls for drift, base-green, reroll, arm isolation, fail-closed rows, and report math |
| `evals/skill-transport/results/implementer-*` | Seed, 16-cell result ledger, JSON report, and human-readable report; no raw logs |
| `evals/skill-transport/README.md` | Operator contract and reproducible commands for both completed experiment arms |
| `docs/plans/2026-07-15-skill-transport-payoff-ab.md` | Historical plan terminal status and execution note only |
| `docs/BACKLOG.md` | Remove this one triggered item after terminal evidence, or retain it with an exact infrastructure trigger |
| `docs/projects/2026-08-02-skill-transport-implementer-arm/` | Progress, evidence, decision, and lifecycle record |

## Deliverable contract

### Frozen input qualification

The eight task repositories above were copied to isolated temporary directories, initialized at one baseline commit, and their unmodified `oracle.sh` commands were executed on 2026-08-02. All eight exited `1` with `STATUS: FAIL`; `unexpected_base_green=0`. The shipped mechanics test must reproduce this property and include a planted base-green fixture that is rejected, satisfying acceptance patterns A5 and A7.

`implementer-tasks.json` must bind each task ID to the SHA-256 of `task.md` and `oracle.sh`. The driver checks all digests and the frozen pack digest before creating the first run directory or invoking a dispatcher.

### Paired execution

The matrix driver must:

1. validate all inputs before spend;
2. freeze and persist a single numeric seed;
3. build the complete 16-key schedule, shuffle it deterministically, and skip only already-terminal exact keys;
4. construct a fresh task Git repository per cell and invoke the existing worktree-isolated implementation rail;
5. run the task oracle from the frozen source path against the candidate commit/worktree, never a candidate-authored replacement oracle;
6. send the candidate diff to one preflighted, fixed, non-OpenAI reviewer tuple and normalize its verdict/findings without trusting the implementer;
7. append one valid JSON object atomically per terminal cell, including engine, arm, task, seed, dispatch status, commit witness, oracle result, reviewer defect count/fingerprints, usage when available, wall time, and infrastructure classification;
8. preserve private raw-log evidence paths outside Git while keeping committed artifacts secret-free.

The fixed reviewer preference is `claude-opus` via `claude-native`, then `Gemini 3.6 Flash (High)` via `agy` only if the first tuple fails readiness before cell one. Once selected, no reviewer substitution or family mixing is allowed. A reviewer outage after cell one yields `infra_failed` rows and a resumable matrix, not a reroll with a different seat.

### Deterministic report and decision

For each task, defects are the union of oracle failure (one harness defect when non-infrastructure) and normalized independent-review findings, deduplicated by stable fingerprint. Let `D = total_defects(nopack) - total_defects(pack)`; positive values favor the pack. Cost ratio is summed non-cached input+output tokens for pack divided by nopack when all 16 cells expose comparable usage; otherwise it is `null` and cannot satisfy the surprise rule.

- `D <= 0`: H1 is confirmed; six-element prompts are sufficient for this set; keep implementer skill transport off and close the backlog item.
- `D >= 2`, all eight pairs valid, and cost ratio `<= 1.5`: H1 is refuted; keep production defaults unchanged here and create one trigger-bearing follow-up for separate wiring work.
- Any other complete result: inconclusive; keep defaults off, record the exact counts, and close the measurement item because the pre-registered run is complete.
- Fewer than eight valid pairs or mixed engine/reviewer tuples: no capability verdict; retain the backlog item with the exact infrastructure trigger needed for a clean resume.

The report must state exact counts, not percentages alone. Applying these frozen rules is deterministic CEO execution under the user's delegated authority; it is not a new mid-run approval gate.

## Verification

- `bash evals/skill-transport/test/implementer-matrix-mechanics.test.sh` passes and demonstrates A2/A5 perturbations, A4 resume idempotency, and A7 baseline classification.
- One real Codex cell over the changed rail supplies A6 live evidence before the full matrix is trusted; its terminal row is part of the frozen schedule, not an extra cherry-picked run.
- `node evals/skill-transport/implementer-report.js --in evals/skill-transport/results/implementer-matrix.jsonl --json` exits 0 only for a structurally complete, internally consistent report.
- The result ledger has exactly 16 unique terminal cell keys, one seed, one implementer tuple, one reviewer tuple, eight `nopack`, and eight `pack` rows.
- `bash evals/skill-transport/assert-instruments.sh`, the existing reviewer matrix mechanics test, the complete hook suite, and `bash scripts/sync-all.sh --check` remain green.
- An independent depth-0 QC panel reviews the final candidate diff after the foreman returns. The foreman and cell implementers are not authoritative final verifiers.

## Risks and inversion

- **Arm contamination** guarantees a false result. Mitigation: byte-compare prompts after removing the one declared pack block; mechanics test perturbs another byte and requires rejection.
- **Oracle replacement** lets the implementer grade itself. Mitigation: invoke the frozen source oracle by digest against the candidate tree.
- **Unequal starting trees or reused sessions** introduce learning/carry-over. Mitigation: fresh baseline repo, unique branch/worktree, and no provider resume per cell.
- **Cherry-picking completed cells** biases the sample. Mitigation: complete schedule persisted before dispatch; every key must be terminal and infra failures remain visible.
- **Reviewer drift** changes the measurement ruler. Mitigation: one tuple frozen before cell one; no mid-matrix fallback.
- **Token telemetry gaps** can manufacture a cheapness claim. Mitigation: missing comparable usage makes cost ratio null and blocks the surprise rule.
- **Long-running matrix stalls** waste time. Mitigation: one 120-minute foreman budget plus at most one evidence-backed extension; after that depth-0 takes over the same worktree and lineage.

## Out of scope

- Production wiring or default changes.
- Editing either frozen skill pack.
- Re-running or reinterpreting the reviewer-arm experiment.
- Expanding beyond the eight frozen tasks, adding repeats, tuning prompts after seeing results, or swapping engines/reviewers mid-matrix.
- Version bump, release, push, PR, or publication.

## Open questions

None. The original plan answered the spend/order questions, and the user delegated bounded CEO execution through `/l4`.

## Review log

- R0 2026-08-02: depth-0 continuation authored from the frozen 2026-07-15 plan, current triggered backlog entry, real task/oracle inspection, and eight-of-eight isolated base-red qualification. No live model cell had run when this plan and its rubric were frozen.

