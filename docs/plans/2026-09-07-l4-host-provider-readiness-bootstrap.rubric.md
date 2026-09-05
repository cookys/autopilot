# Rubric — l4 host provider-readiness bootstrap (frozen for the plan loop, 2026-09-07)

> Source plan: docs/plans/2026-09-07-l4-host-provider-readiness-bootstrap.md
> Each R-item is a pass/fail question about the PLAN TEXT. A reviewer answers it from the plan and the
> cited code sites only; a finding must name the R-item and the plan section it fails.

- R1: [thesis-grounded] Does §0 correctly state that canonical-policy coverage is already advisory (Board 2026-08-16) so l4 needs no new capability claims, and does every later section stay consistent with that (no phase silently reintroduces a hard roster-identity gate)?
- R2: [ADR-0001] Does the plan add zero trust machinery — the l4 bundle comes from the SAME live `collectProviderReadinessBundle` probe and the same `qualificationProvider` as l5/l6, with disk scorecards still telemetry-only (§2.5)?
- R3: [roster-profile isolation] Does P1 define the per-level roster profile so that l5/l6 behaviour is byte-identical (VA required, QC panel required) and is that isolation pinned by a mandatory negative control in P3 (KR3), not by intent alone?
- R4: [level literal] Does the plan require `strict_level` = the actual level (`l4`) in bundle AND consumed receipt, with the level-drift check widened rather than removed, and an assertion in the executable fixture (KR1/P3)?
- R5: [waiver interplay] Is the v2.36.7 reviewer-qualification waiver interplay specified unambiguously — certified reviewer ⇒ no `waived` entry, uncertified ⇒ `waived` — and tested at the engine level (KR4)?
- R6: [observation feed] Does the plan cover `engine-lifecycle-observation.js` accepting `l4` and `waived` so an l4 run's statuses serialize intact, with a unit test (KR5)?
- R7: [advisory path tested] Does P3 prove the advisory override path for an uncertified l4 roster (policy_override reason `advisory_default`, uncertified seats listed, stderr line) rather than only the certified path (KR2)?
- R8: [RED-first] Does the plan require every new assertion to be red on `develop` before green on the branch, with the red run recorded in the project ledger?
- R9: [concreteness] Are P1's edits named by function and approximate line (constructor guard, `deriveStrictL5InvocationPolicy` VA/QC sites, `validateCollectedBundle`, level-drift check) so a zero-context implementer needs no discovery, and is the P0 spike evidence consistent with those sites?
- R10: [scope discipline] Are the frozen D4 claim set, new exam evidence, the v2 claim ↔ ICC identity binding, and consuming-repo enforcement defaults explicitly out of scope (§7), with nothing in P1–P4 touching them?
- R11: [release mechanics] Does the plan name PATCH `v2.36.8`, the codex mirror sync before commit, the two BACKLOG rows to close, the front-door reference rewrite, and the two portability/installation doc mentions (§3/P4)?
- R12: [dogfood is human-gated] Is P5 (cuda WIZHALL re-run) defined as a report with a concrete pass observable (intake reached, not `provider_readiness_authority_missing`) and any new rejection routed to BACKLOG rather than same-day patching?
- R13: [inversion honest] Does §6 name the failure modes that would silently break the goal (hard-gating l4 coverage, l5 profile leak, `l5` literal, observation rejects) each with a concrete mitigation tied to a KR?
