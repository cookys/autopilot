# doc-sync deterministic gate — Layer 1 (v2.20.0)

> S/L-ship. Adds a deterministic gate layer to `autopilot:doc-sync`, making
> "are the docs in sync?" reliably answerable.

## Project Goal

> **Final goal**: Give doc-sync a RELIABLE stopping condition by adding a
> deterministic Layer-1 gate alongside the existing (non-deterministic) LLM sweep.
> **Success criteria**:
> - `skills/doc-sync/SKILL.md` documents the two-layer model (gate-first + LLM
>   discovery + non-convergence rationale + demote-into-gate loop) — verified by reading.
> - A portable baseline gate `scripts/doc-drift-gate.py` exists, runs zero-config
>   (links + fences), is zero-false-positive (skips placeholders / GitHub-relative /
>   extensionless), and exits 0/1 — verified by running it.
> - `project-config-template/doc-drift-config.md` has a `gate_command` field.
> - Release hygiene: version 2.20.0 synced across mirrors (sync-version --check exit 0),
>   CHANGELOG v2.20.0, INDEX row. validate.sh 20/20.
> **Scope boundary**: autopilot side (skill + baseline script + template + release).
> Out of scope: fixing autopilot's own pre-existing broken doc links (8, found by the
> new gate — a separate doc-hygiene task), and wiring autopilot's own CI to the gate.

## Origin

codeforge built a 5-check deterministic gate (`scripts/check-doc-drift.py`) + ran the
LLM sweep 7 times, proving loop-to-zero does not converge (non-deterministic finders +
fixes-introduce-errors; a latent AI-commentary error sat undetected through rounds 1–6).
Conclusion: an LLM sweep is a DISCOVERY tool, not a gate; reliability comes from
deterministic checks. This ship generalizes that lesson into the autopilot skill so any
project gets the two-layer model + a portable baseline gate.

## Phases

| Phase | Status |
|-------|--------|
| P1 SKILL.md two-layer model | ✅ |
| P2 generic baseline scripts/doc-drift-gate.py (zero-FP) | ✅ |
| P3 template gate_command field | ✅ |
| P4 README row + CHANGELOG + INDEX + version 2.20.0 | ✅ |
