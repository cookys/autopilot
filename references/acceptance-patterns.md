# Acceptance Patterns — mechanical acceptance menu (L1)

Part of the quality-floor engine ([design](../docs/plans/2026-07-04-quality-floor-engine.md) §4.2).
A planner writing a unit's acceptance criteria ATTACHES patterns from this menu instead of
inventing prose criteria. Every pattern embeds its own **negative control** — an instance
must demonstrate it can fail. An acceptance section with no demonstrated failure mode is
itself a 🟠 Major review finding (reviewer contract).

A custom criterion is allowed only WITH a written justification of why no menu pattern
covers it — and it must still name its negative control.

## Menu

### A1 — Round-trip parity
**Use when**: two representations of one contract exist (producer/consumer, bash↔JS twin,
schema↔validator, source↔mirror).
**Template**: execute the REAL producer; feed its actual output through the REAL consumer;
compare the full key/field set in BOTH directions (unknown-to-consumer AND missing-from
-producer each fail, naming the drifted keys). Conditional fields get an explicit allowlist
with a comment, never a loosened comparison.
**Negative control**: inject one bogus key into a COPY of the real output and one deletion of
a required key — the parity check must fail on each, naming the key.
**Incident**: v2.31.10 `contract-parity.test.sh` — built after an 8-field silent drift.

### A2 — Perturbation
**Use when**: shipping or modifying any gate, linter, validator, or seeded invariant.
**Template**: with the gate green, mutate exactly the thing the gate guards (one seeded
line, one guarded path), assert the gate FAILS naming the violation, restore, assert green.
**Negative control**: built-in — the perturbation IS the control. A perturbation step whose
gate stays green is a vacuous gate: stop and fix the gate.
**Incident**: v2.31.10 canonical-invariant seeds validated exactly this way.

### A3 — Fidelity (byte-identical move/extract)
**Use when**: code moves between containers with a no-behavior-change claim (heredoc→file,
file split, inline→lib).
**Template**: reconstruct the original body from git (`git show <base>:<file>` + exact line
range) and `diff` against the new location minus explicitly-allowed additions
(shebang/header); byte-identical or the unit fails. Pair with the container's own runtime
check (compile/parse) and the surrounding callers' tests.
**Negative control**: the diff must be shown to detect a 1-character change (run it once
against a deliberately perturbed copy).
**Incident**: v2.31.10 test-integrity heredoc extraction (1,880 lines, verified verbatim).

### A4 — Idempotency
**Use when**: a tool claims to be re-runnable (checker, scaffolder, sync, `--init`).
**Template**: run twice; hash the touched tree before/after the second run — byte-stable;
plus control files OUTSIDE the tool's declared surface never change.
**Negative control**: show the hash comparison catching a change (touch one byte between
runs and observe the mismatch), so "byte-stable" is a real assertion, not a tautology.
**Incident**: v2.31.10 verification of `check-canonical-invariants.sh` (checker must not
mutate); `load-endpoints-env.sh --init` never-clobbers contract.

### A5 — Negative self-check (the test can fail)
**Use when**: adding ANY new test whose subject is a failure mode (rejection paths,
fail-closed exits, refusal rails).
**Template**: alongside the passing assertions, include one case that plants the guarded
defect and asserts the REJECTION fires (correct exit code + named reason), and one that
proves the happy path still passes.
**Negative control**: built-in by definition.
**Incident**: the entire `evals/known-bad` + reviewer-calibration design; v2.31.10
dispatch-explore tests (probe-fail exit 3, dirty exit 4) after their first version silently
exercised only the happy path.

### A6 — Live end-to-end (stubs never sufficient)
**Use when**: the change touches a dispatch rail, protocol, prompt contract, or any surface
whose real counterpart is an external engine/CLI — MANDATORY for these; stub suites remain
necessary but are NOT acceptance.
**Template**: one real-engine invocation over the changed rail with a trivial input; assert
the machine-readable outcome (status field, verdict, artifact), not the vibe. Record engine
+ version in the evidence (platform behavior drifts).
**Negative control**: the live run must be shown failing before the fix or on a planted
defect at least once in the unit's lifetime (otherwise it's a smoke test, not evidence).
**Incident**: v2.31.10 — the codex rail was structurally broken while 107 stub assertions
passed; one live low-effort call proved both the bug and, later, the fix.

### A7 — Baseline classification (pre-existing vs introduced)
**Use when**: any pre-merge failure appears in a suite the unit didn't target.
**Template**: run the failing test at the branch base in a fresh worktree (or
`scripts/verify-preexisting.sh`); classify PRE_EXISTING (record + BACKLOG with trigger,
don't block) vs INTRODUCED (block until fixed). The classification itself is part of the
release evidence.
**Negative control**: the base run must be shown green for at least one INTRODUCED case (or
red for the PRE_EXISTING one) — i.e. the worktree actually ran the right test at the right
ref (echo the ref in the output).
**Incident**: v2.31.10 — 3 pre-existing vs 1 introduced, both directions present in one
release.

## Composition guidance
Most non-trivial units need 2-3 patterns, not one (v2.31.10's heredoc unit = A3 + A2-on-the
-consumer + suite subset; the parity unit = A1 + A5). The planner lists the chosen pattern
ids in the unit prompt's acceptance section; the reviewer checks the EVIDENCE of each listed
pattern (including its negative control), not the label.
