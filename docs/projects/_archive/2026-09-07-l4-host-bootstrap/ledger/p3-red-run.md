# P3 RED run — new assertions fail on develop sources (2026-09-06)

Branch `feat/v2.36.8-l4-host-bootstrap` with the four test suites modified and the four source files
(`src/readiness/provider-bootstrap.js`, `src/engine/engine-lifecycle-observation.js`, `src/engine/campaign-intake.js`, `bin/autopilot.js`)
stashed back to `develop` (`c7cc64aa`). Each suite was then run once; every FAIL line below is a new v2.36.8 assertion.
GREEN on the branch afterwards: consumer 34 · observation 78 · engine 486 · cli 117 assertions.

## provider-readiness-consumer (8 FAIL)

```
FAIL [provider-readiness-consumer] strict /l5 provider policy bootstrap is available: expected exit 0, got 1
FAIL [provider-readiness-consumer] strict /l5 policy is the exact frozen six-claim contract: 'strict_policy_exact=true' not found in output
FAIL [provider-readiness-consumer] strict /l5 accepts a fresh host-owned exact-roster readiness bundle: 'strict_positive_ready=true' not found in output
FAIL [provider-readiness-consumer] strict /l5 negative matrix rejects before workflow dispatch: 'strict_negative_matrix_zero_dispatch=true' not found in output
FAIL [provider-readiness-consumer] v2.36.8: l4 roster profile derives, issues and consumes an l4 bundle; l5/l6 invariants pinned by isolated controls: 'strict_l4_profile=true' not found in output
FAIL [provider-readiness-consumer] refusal names the level and the cause (l4 compiles the bootstrap since v2.36.8): 'AUTOPILOT_LEVEL=l3; only l4/l5/l6 build the strict host bootstrap' not found in output
FAIL [provider-readiness-consumer] refusal names the two legal remedies: 'enforcement_mode to shadow, or run it under /l4, /l5 or /l6' not found in output
FAIL [provider-readiness-consumer] 27 passed, 7 failed
```

## engine-lifecycle-observation (8 FAIL)

```
FAIL [engine-lifecycle-observation] KR5 observation level probe exits 0: expected '1', got '0'
FAIL [engine-lifecycle-observation] KR5: l4 is accepted as a legacy observation level: 'level_l4=l4' not found in output
FAIL [engine-lifecycle-observation] KR5: l5 still accepted: 'level_l5=l5' not found in output
FAIL [engine-lifecycle-observation] KR5: l6 still accepted: 'level_l6=l6' not found in output
FAIL [engine-lifecycle-observation] KR5: l3 is still rejected, naming the accepted set: 'level_l3=lifecycleObservation.legacyLevel must be l4, l5 or l6' not found in output
FAIL [engine-lifecycle-observation] KR5: the observation envelope binds the l4 legacy level: 'kr5_open_level=l4' not found in output
FAIL [engine-lifecycle-observation] KR5: waived serializes intact (not hashed as unknown) on the observation wire: 'kr5_waived_on_wire=true' not found in output
FAIL [engine-lifecycle-observation] 71 passed, 7 failed
```

## autopilot-engine (7 FAIL)

```
FAIL [autopilot-engine] KR4 interplay process exits 0: expected '1', got '0'
FAIL [autopilot-engine] KR4: the l4 bootstrap bundle is consumed (strict_l5_provider_readiness:ready): 'cert_readiness=true' not found in output
FAIL [autopilot-engine] KR4: a certifying l4 bootstrap leaves NO reviewer_qualification:waived entry: 'cert_has_waived=false' not found in output
FAIL [autopilot-engine] KR4: without a certifying bootstrap the v2.36.7 waived entry remains: 'uncert_has_waived=true' not found in output
FAIL [autopilot-engine] KR4: without a bootstrap no readiness entry is fabricated: 'uncert_readiness=false' not found in output
FAIL [autopilot-engine] KR4: --require-qualified-reviewer without a certifying bootstrap still blocks: 'forced_phase=reviewer_qualification' not found in output
FAIL [autopilot-engine] 480 passed, 6 failed
```

## autopilot-cli (14 FAIL)

```
FAIL [autopilot-cli] strict L4 executable fixture consumes a fresh host-owned readiness bundle (KR1): '"strict_l5_provider_readiness":{"status":"ready"' not found in output
FAIL [autopilot-cli] strict L4 executable fixture receipt carries the actual level, not an l5 literal: '"strict_level":"l4"' not found in output
FAIL [autopilot-cli] strict L4: the bootstrap certified the reviewer, so no waived ledger entry (KR4): unexpected '"unit":"reviewer_qualification"' in output
FAIL [autopilot-cli] strict L4 executable fixture records the frozen policy digest (D4 claim set untouched): '"policy_digest":"b3b525daaaf8f7363698a1035bcb5e029e5bf3e652e7730b8d88194f88d73d76"' not found in output
FAIL [autopilot-cli] strict L4 CLI warns loudly on an advisory derivation (KR2c: stderr line present): 'POLICY OVERRIDE' not found in output
FAIL [autopilot-cli] strict L4 CLI records advisory_default when no override reason is configured (KR2a): 'reason: advisory_default' not found in output
FAIL [autopilot-cli] strict L4 CLI names the uncertified reviewer seat in the override line (KR2b): 'reviewer=cc-shim/unknown-reviewer-model' not found in output
FAIL [autopilot-cli] strict L4 CLI proceeds to readiness under advisory policy: '"strict_l5_provider_readiness":{"status":"ready"' not found in output
FAIL [autopilot-cli] strict L4 advisory run still stamps the actual level: '"strict_level":"l4"' not found in output
FAIL [autopilot-cli] l4 default + certifying bootstrap: no waived entry (KR4): unexpected '"unit":"reviewer_qualification"' in output
FAIL [autopilot-cli] l4 default: the full roster derives under the l4 profile (VA + QC included when present): '"strict_level":"l4"' not found in output
FAIL [autopilot-cli] l4 + --require-qualified-reviewer: host-verified by the consumed l4 bundle, not blocked: unexpected '"phase":"reviewer_qualification"' in output
FAIL [autopilot-cli] l4 + --require-qualified-reviewer: readiness consumed before the requirement is checked: '"strict_l5_provider_readiness":{"status":"ready"' not found in output
FAIL [autopilot-cli] 104 passed, 13 failed
```

