# Acceptance rubric — skill-transport implementer arm closure

This rubric is content-bound to the frozen execution plan by the Mission source manifest. Every item is required; suggestions do not silently expand scope.

## R1 Frozen task and pack integrity

Exactly the eight named task repositories are present in a committed manifest with matching `task.md` and `oracle.sh` SHA-256 values, and the implementer pack matches `3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca`. Any drift fails before dispatcher, branch, or worktree effects.

## R2 Discriminating baseline

All eight frozen task oracles fail non-zero at their pristine baseline. A mechanics negative control plants a base-green task and proves the driver rejects it rather than spending a model call.

## R3 Paired-arm isolation

The ledger contains exactly 16 unique terminal keys: eight tasks in both `nopack` and `pack`. Each pair starts from byte-identical task content, and prompts are identical except for the declared frozen pack injection. No provider session, candidate branch, or worktree crosses cells.

## R4 Engine and reviewer constancy

Every implementation cell records `codex/gpt-5.3-codex-spark` at one effort. Every outcome uses one preflighted non-OpenAI reviewer tuple selected before cell one. No engine or reviewer substitution occurs after the schedule begins.

## R5 Deterministic fail-closed execution

One persisted seed determines the full shuffled schedule; rerunning skips only terminal exact keys. Unparseable/missing dispatcher or reviewer output becomes a visible `infra_failed` or `invalid` row and is never silently rerolled or counted as success. A4 and A5 controls demonstrate these properties.

## R6 Independent outcome authority

Candidate success is determined by the frozen source oracle plus normalized findings from the fixed independent reviewer. Implementer self-report and candidate-modified tests/oracles carry no authority. Reviewer and harness defects are deduplicated by stable fingerprints.

## R7 Exact report and pre-registered decision

The deterministic report reconciles one-for-one with all JSONL rows, prints exact per-arm/per-task counts, valid-pair count, defect delta `D`, comparable cost ratio or explicit null, infrastructure totals, and exactly one frozen decision state. It cannot claim the surprise rule unless `D >= 2`, eight pairs are valid, and comparable cost is `<= 1.5x`.

## R8 Live and mechanical verification

The no-spend mechanics suite includes perturbation/negative controls and passes. At least one scheduled cell traverses the real Codex implementation rail. Existing skill-transport instrument tests, the full hook test suite, and `scripts/sync-all.sh --check` pass without exclusions.

## R9 Evidence and capability recording

Committed results contain no raw model logs or secrets. Each real dispatch produces private run evidence and a capability/scorecard record with `skill_transport` populated as `off` or `prompt_pack`; report rows carry enough non-secret identity and usage metadata to audit the comparison.

## R10 Honest lifecycle closure

The historical plan, project tracker, project index, and backlog agree with the evidence. The triggered item is removed only after eight valid pairs and a terminal capability decision; otherwise it remains with an exact resume trigger. No production default, version, release, remote branch, PR, or publication changes.

