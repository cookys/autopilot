# Plan — reviewer output-token budget Codex mirror closure

> Status: FROZEN SUCCESSOR ADMISSION
> Owner: depth-0 CEO; same L4 foreman transcript, branch, and worktree
> Size: boundary correction only
> Supersedes graph digest: `e9f1e70ecd84bf18a6efe8b42cfd605af552172686938772a379e5e1e6d9e9d0`

## Context

The original frozen plan correctly authorized the canonical reviewer wrapper and operator
reference, but its execution graph omitted their two deterministic Codex package mirrors:

- `platforms/codex/plugin/scripts/dispatch-review.sh`
- `platforms/codex/plugin/references/hetero-dispatch.md`

Depth-0 found the omission by running `bash scripts/sync-codex-plugin-skills.sh --check` after the
canonical wrapper/reference edits but before any mirror write, lifecycle finalization, independent
review, or candidate commit. The check failed only on those two exact canonical-to-mirror pairs.
No unauthorized output path was changed. The original ledger lease was terminalized as
`stale_ignored` with reason `superseded-by-codex-mirror-closure`; the same uncommitted work remains
in the same branch/worktree.

## Objective and measurable result

Continue the original one-deliverable mission while expanding its output boundary by exactly the
two generated mirrors required by the repository sync invariant. Do not change the product contract,
implementation approach, foreman identity, worktree, branch, or review topology.

- Run the canonical sync script to generate both mirrors; never hand-author divergent copies.
- Canonical and Codex-package bytes are exact-equal after generation.
- The final candidate changes the original eight output paths plus exactly these two mirrors.
- All original R1–R8 requirements remain binding.
- The preserved focused evidence may be reused; the interrupted full-suite run has no verdict and
  must be rerun once from the successor state.

## Change-policy decisions

- **Compatibility impact**: unchanged from the original additive flag contract.
- **Dependency decision**: unchanged; existing deterministic sync script only.
- **Version decision**: unchanged; v2.34.1 train, no manifest bump.

## Deliverable contract

The successor source set is the original frozen plan/rubric plus this correction/rubric. The
implementation foreman must reacquire a new run ledger on the same branch/worktree, run
`scripts/sync-codex-plugin-skills.sh`, and verify byte equality for both pairs. It then completes the
original lifecycle docs, full bundle, exactly one independent first-pass review using the existing
verifier transcript, and returns one final candidate commit. Depth-0 remains the sole authoritative
whole-diff QC and merge owner.

No other generated path, canonical path, plan/rubric, version mirror, release surface, remote, or
external state is authorized. This correction cannot be used to add semantics or reopen adjacent
review-efficiency backlog items.

## Out of scope

- Any semantic change beyond the original frozen output-token budget contract.
- Replacing the foreman/verifier, creating a new feature worktree, or replaying already-passed
  focused tests without an affected-file reason.
- Version bump, release, push, PR, or publication.

## Review log

- C0 2026-08-02: authored from deterministic sync-gate evidence before any mirror write. Original
  stage disposed honestly; successor keeps one deliverable and the same implementation lineage.
