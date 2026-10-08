# Total QC — autopilot 3.0.0 stage-graph release (Train A + Train B), packet {{PACKET}} of 8

You are one seat on a heterogeneous QC panel. The full range under review is `8a10980f..{{HEAD}}` on branch `release/3.0.0` (autopilot plugin repo). It is too large for one prompt, so it is cut into 8 packets **by plan phase / concern, each packet carrying code together with its own tests**. You see ONE packet's diff. The packet map below names every file in the range and which packet carries it — files outside your packet DO exist and are reviewed by other seats; do not report "X is missing / not updated" for a file that the map shows in another packet. Report a cross-packet finding only when something INSIDE your diff demonstrably breaks a contract of another file (cite both).

Not in any packet, verified deterministically instead (outputs below):
- `platforms/codex/plugin/**` — a generated mirror; `scripts/sync-codex-plugin-skills.sh --check` byte-verifies it.
- `evals/skill-onoff/packs/**` — frozen guidance copies for the eval; `scripts/check-guidance-eval.js` verifies every shipped guidance file is byte-equal to its pack and re-scores the recorded results.
- `evals/skill-onoff/results/**` — recorded eval data.
- `profiles/*.json` — generated rule inventory / migration hash chains; `build-profile-payload.js catalog --check` and the profile suites verify them. A human-readable summary of the 364 new `removed` dispositions is in packet K6's spec.

Pre-existing reds, NOT caused by this range (same failure set on the pre-range base): `hooks/tests/autopilot-cli.test.sh` (9 FAILs), `scripts/doc-drift-gate.js` (3 failures: dangling CHANGELOG/INDEX links, unbalanced fences in backlog sidecars, a `check-inputs-landed` mention).

Repo conventions you should hold the diff to: severity vocabulary 🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion; Node scripts use built-ins only (Node ≥ 20.10); ADR-0001 "verification over attestation" (no hash chains / attestation / trust machinery — verification is independent re-derivation); breaking changes ship as clean renames under a MAJOR (3.0.0-alpha.N) with no compatibility shims or dual-read aliases (owner policy).

## What to look for
Correctness bugs, contract mismatches between writer and reader, tests that cannot fail (assert nothing, pass when the gate under test is deleted, pinned to one machine, write into real user state), silent fail-open where the plan requires fail-closed (or vice versa), and divergence from the frozen plan (full text at the end of this spec, including its accepted execution deviations and owner addendum A1 / ruling R-K1 — those deviations are decided, do not re-litigate them). Every finding cites file:line from the diff and states a concrete failure scenario.

## Packet-specific focus
{{FOCUS}}

## Packet map (file → packet)
{{MAP}}

## Deterministic gate outputs at {{HEAD}}
```
{{DET}}
check-guidance-eval --base 8a10980f --results evals/skill-onoff/results/stage-graph.v5.jsonl:
{{CGE}}
```
