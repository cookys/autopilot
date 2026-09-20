# Plan — Codex payload residual spike mirror closure

> Status: FROZEN SUCCESSOR ADMISSION
> Owner: depth-0 CEO; same L4 foreman transcript, branch, and worktree
> Size: deterministic boundary correction only
> Supersedes graph digest: `6dac89b07eea8f0ee0f85497c87d6fc46991a9b90934d52f5ad3d3a59363c3f2`

## Context

The original residual-spike graph authorized the canonical portability reference but omitted its
deterministic Codex package mirror:

- `platforms/codex/plugin/references/multi-agent-portability.md`

The foreman completed all three disposable probes, cleaned their external/local fixture residue,
and wrote the six authorized candidate outputs. At the single bundled gate,
`bash scripts/sync-all.sh --check` failed because `scripts/sync-codex-plugin-skills.sh` mirrors the
canonical `references/` tree into the Codex payload. The base canonical file and mirror were equal;
the candidate changed only the canonical reference, so the failed check identifies exactly one
required generated output. The mirror remains unmodified and the candidate remains uncommitted.

Waiving the sync gate would ship known drift. Hand-editing or silently adding the mirror would
violate the frozen output boundary. This successor preserves the original graph and authorizes only
the mechanically required mirror closure.

## Objective and measurable result

Continue the original one-deliverable mission with the same foreman, worktree, branch, evidence,
decision, and review topology while expanding the candidate output boundary from six paths to seven.

- Dispose the old ledger stage as `stale_ignored`, never as passed.
- Fast-forward the same feature branch onto this successor bootstrap while preserving the existing
  dirty six-path candidate.
- Run the canonical sync generator; do not hand-author the mirror.
- Prove canonical and mirror files are byte-equal and `sync-all --check` passes.
- Final candidate diff from the successor bootstrap contains exactly the original six paths plus the
  one mirror.
- All original R1–R6 requirements and the conjunctive NO-GO rule remain binding.

## Change-policy decisions

- **Compatibility impact**: none; this is a generated documentation mirror of the already-authorized
  portability evidence.
- **Dependency decision**: existing deterministic sync script only.
- **Version decision**: unchanged; v2.34.1 train, no manifest bump.

## Deliverable contract

The successor source set consists of the original frozen plan/rubric plus this correction/rubric.
It retains one Mission node. The candidate output set is exactly:

1. `docs/BACKLOG.md`
2. `references/multi-agent-portability.md`
3. `platforms/codex/plugin/references/multi-agent-portability.md`
4. `docs/projects/2026-08-02-codex-payload-residual-spike/README.md`
5. `docs/projects/2026-08-02-codex-payload-residual-spike/dev-info.md`
6. `docs/projects/2026-08-02-codex-payload-residual-spike/evidence.json`
7. `docs/projects/INDEX.md`

The same foreman reacquires a successor ledger stage, runs the canonical sync generator, verifies
byte equality, commits one candidate, and re-runs the bundled gates. Its existing independent
first-pass verifier transcript reviews the complete seven-path diff once. Depth-0 remains the sole
authoritative QC and merge owner.

No other generated path, canonical path, plan/rubric, script, test, manifest, version surface,
release surface, remote, or external state is authorized. The correction cannot alter any probe
verdict, weaken the NO-GO conclusion, or initiate the payload migration.

## Out of scope

- Any semantic change beyond the original report-only residual spike.
- Re-running already-closed live Codex probes without a concrete evidence defect.
- Replacing the foreman/verifier, creating another feature worktree, or waiving sync.
- Version bump, release, push, PR, publication, or payload migration.

## Review log

- C0 2026-08-02: authored from deterministic `sync-all --check` evidence before the omitted mirror
  was written or the six-path candidate committed. The successor keeps one deliverable and the same
  implementation lineage.
