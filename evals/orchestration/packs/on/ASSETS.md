<!-- Word Count: 913 -->
# Quality-Floor Assets

This document contains the guidelines and protocols for maintaining quality floor during engineering tasks.

## 1. Probe Playbook (Diagnostic Probes)
When a run hits a symptom below, match an entry and run its probe. Do not invent a diagnosis. Every entry has a discriminating check.

### P1 — works-with-stubs, fails-with-the-real-engine
- **Symptom**: a parser/protocol/rail passes its stub-based test suite but misbehaves the first time the real engine runs through it.
- **Probe**: run the real engine ONCE with a trivial input, capturing stdout and stderr to SEPARATE files (`cmd > out.txt 2> err.txt`); `wc -l` both; diff their content against what the stub emits.
- **Expected if match**: the real engine's channel layout differs from the stub's (content on the other channel, extra chrome, duplicated payload).
- **Expected if NOT match**: channel layouts identical -> the defect is in the changed code, not the engine contract.

### P2 — tool behaves differently under the engine/harness than in an interactive shell
- **Symptom**: a CLI invocation works when typed in a shell but fails (or takes another code path) when spawned by a wrapper, engine, or hook.
- **Probe**: from INSIDE the spawned context, log `command -v <tool>` and `<tool> --version`; compare against the interactive shell's.
- **Expected if match**: different path or version (PATH ordering, nvm/npm shims, stale global installs).
- **Expected if NOT match**: identical binary+version -> suspect env/cwd/stdio.

### P3 — intermittent empty output from a dispatched process
- **Symptom**: a runner's capture file is empty at check time; the run is classified empty/failed, but reruns sometimes succeed.
- **Probe**: re-read the SAME capture file after a delay (seconds to minutes) without rerunning; record byte counts at T0 and T+delay.
- **Expected if match**: the file has content later -> late flush from a detached child; a bounded settle-wait is the fix.
- **Expected if NOT match**: still empty later -> genuinely empty; treat as an engine-side failure.

### P4 — parser rejects output that "looks valid" in the log
- **Symptom**: a fail-closed parser reports no-verdict/malformed, but eyeballing the captured log shows a plausible payload.
- **Probe**: dump the EXACT bytes the parser consumed (its input file/stream, not the human-facing log): `head -c 400 <parse-input> | od -c | head -20` — inspect for leading chrome, BOM/CR, duplicated blocks, or a missing terminator.
- **Expected if match**: parse input is not equal to the payload you eyeballed (wrong channel/file, extra prefix, missing END line).
- **Expected if NOT match**: parse input is byte-clean -> the parser rule itself is wrong.

### P5 — a test/gate passes, suspiciously
- **Symptom**: a gate goes green on the first try, or stays green when intuition says the change should have tripped it.
- **Probe**: perturbation — inject the exact defect class the gate guards (break the seeded invariant, plant the bug, remove the guarded line) and rerun the gate.
- **Expected if match**: gate stays GREEN under the injected defect -> the gate is vacuous; fix the gate before trusting anything it passed.
- **Expected if NOT match**: gate goes red on injection -> the gate discriminates.

---

## 2. Acceptance Patterns (Mechanical Acceptance Menu)
Attach patterns from this menu instead of inventing prose criteria. Every pattern embeds its own negative control.

### A1 — Round-trip parity
- **Use when**: two representations of one contract exist (producer/consumer, twin representations).
- **Template**: execute the REAL producer; feed its actual output through the REAL consumer; compare the full key/field set in BOTH directions.
- **Negative control**: inject one bogus key into a COPY of the real output and one deletion of a required key — the parity check must fail on each, naming the key.

### A2 — Perturbation
- **Use when**: shipping or modifying any gate, linter, validator, or seeded invariant.
- **Template**: with the gate green, mutate exactly the thing the gate guards, assert the gate FAILS naming the violation, restore, assert green.
- **Negative control**: built-in — the perturbation IS the control.

### A3 — Fidelity (byte-identical move/extract)
- **Use when**: code moves between containers with a no-behavior-change claim (heredoc to file, file split, inline to lib).
- **Template**: reconstruct the original body from git and `diff` against the new location minus explicitly-allowed additions; byte-identical or the unit fails.
- **Negative control**: the diff must be shown to detect a 1-character change.

### A4 — Idempotency
- **Use when**: a tool claims to be re-runnable (checker, scaffolder, sync).
- **Template**: run twice; hash the touched tree before/after the second run — byte-stable; plus control files OUTSIDE the tool's declared surface never change.
- **Negative control**: show the hash comparison catching a change (touch one byte between runs).

### A5 — Negative self-check (the test can fail)
- **Use when**: adding ANY new test whose subject is a failure mode.
- **Template**: alongside the passing assertions, include one case that plants the guarded defect and asserts the REJECTION fires, and one that proves the happy path still passes.
- **Negative control**: built-in by definition.

---

## 3. Finding-Adjudication Protocol
Reviewer findings enter a typed table, which is a validated JSON/JSONL artifact.
Statuses: `REPRODUCED | REFUTED | UNPROBED | PROOF_BY_TRACE`.

- **REPRODUCED**: the probe ran AND its parsed output asserts the claimed failure observably.
- **REFUTED**: requires a **mutation-validated probe** — inject the claimed defect (or its minimal synthetic form) and the same probe MUST fire; a probe that stays green under the injected defect is vacuous and the finding reverts to UNPROBED. Unvalidatable -> escalate.
- **PROOF_BY_TRACE**: findings whose evidence is a spec/code contradiction with no runnable crash — evidence is a file:line trace chain; requires confirmation by a SECOND disjoint family before acting.
- **UNPROBED**: may not be fixed; must be probed or escalated.
Only REPRODUCED / confirmed-PROOF_BY_TRACE findings may be dispatched for fixing.
