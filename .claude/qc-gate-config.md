# qc-gate-config — per-project qc-gate forcing-function strength

> Copy to `.claude/qc-gate-config.md` in the consuming project to override.
> Resolved by [`scripts/resolve-qc-gate.sh`](../scripts/resolve-qc-gate.sh), which the
> `.githooks/pre-push` hook and `finish-flow` both consult. Sibling of
> [`doa-config.md`](doa-config.md): DOA governs *dispatch authority*, qc-gate governs
> *whether a merge/push to a protected path requires review evidence*.

This file overrides `project-config-template/qc-gate-config.md` for this repo. Every setting matches the template defaults except `outcome`, which is `warn` by owner decision on 2026-10-19 (panel card d-716e951c), so the outcome stage warns and the rest of the gate behaves as the template does.

## Settings (one `key: value` per line; first match wins)

- mode: block
- protected_paths: skills/,agents/,scripts/,references/,hooks/
- evidence: trailer
- outcome: warn
- outcome_rerun: sample
- outcome_sample: 20
- outcome_budget_s: 600
