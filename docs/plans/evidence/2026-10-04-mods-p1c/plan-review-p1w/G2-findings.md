# G2 findings (generation 2)

verdict: CONDITIONAL | policy_reason: generation_cap_requires_depth_0_adjudication | next_generation: null | seats: opus_chair:success/strict | growth {"numerator":21353,"denominator":20505}

## 1. R3 [blocking] class=decision-now
fingerprint: c4e40f4ead98f26ad47bcec7929d70f90178bb84724b9b8f75bea0d7b0f1fc42
surface: P1W dependency table (依賴 column) vs G1 處置 text
claim: The dependency table that dispatchers will copy was not updated to match the accepted G1 fixes. The table and the disposition now contradict each other, and several rows referenced in the disposition do not exist in the table.
evidence: docs/plans/2026-10-03-mods-visible-dispatch.md §4 P1W dependency table; §4 P1W 'G1 處置（R5.1）' bullets 依賴修正 / 第 1 波共用檔 / 分類

## 2. R4 [blocking] class=decision-now
fingerprint: 001c602f76bfe5d93c4838fdb7221daa1c68bce1aa50992ba40bf270b0e818fb
surface: Wave 1 row W1f vs W1a and W1d
claim: W1f is scheduled in wave 1 but is not independent of the other rows.
evidence: §4 P1W table rows W1f, W1a, W1d; 平行派法 bullet; G1 處置 第 1 波共用檔 bullet ('runs-watch.js 只歸 W1a')

## 3. R8 [blocking] class=decision-now
fingerprint: 0092e7aa5433cdf319daf6e5a9b455ed9eb63d5f466b20bab78870fb39c4bf8e
surface: W1b task-status input bundle writer
claim: W1b auto-writes the input bundle that feeds 'autopilot status task' (and therefore acceptance_verdict) when a campaign reaches a terminal state. The plan does not say which bundle fields W1b fills or from which certified source. This risks making a mechanical trigger a second verdict source, which violates the two-axis rule.
evidence: §2.5 兩條狀態軸 bullet; §4 P1W row W1b; G1 處置 契約 bullet; rubric fact (b)

## 4. R5 [non-blocking] class=decision-now
fingerprint: ed0e685ada4e13a5429dceb79a0cb8e9dcfbb63e21b8d50ec3035273aa703ea5
surface: W1b classification (機制) and trigger points
claim: W1b is labelled 機制 and placed in wave 1, but its trigger points are still unnamed. If 'merge 後' is fired by a finish-flow skill step, that part is guidance.
evidence: §4 P1W row W1b; G1 處置 分類 bullet; rubric fact (b) and (e)

## 5. R5 [non-blocking] class=decision-now
fingerprint: 1c93edab972c978f5e48b2728f178fe9fb1c2c1a6d166cbc2457dc6e0afdf23f
surface: W2b and W2e row composition
claim: W2b and W2e each mix mechanism code and skill-text guidance in one row. This invites the single-commit mix that CLAUDE.md forbids. W2a was split for this reason, but these two were not.
evidence: §4 P1W rows W2b, W2e; 規則 bullet; G1 處置 分類 bullet (W2a split only); rubric fact (e)

## 6. R6 [non-blocking] class=decision-now
fingerprint: 6dca98b49e9b1ab8cc28c848735b50660a15a1a4ae2682b8ec891fad8dcfea35
surface: W4 release gate
claim: The release gate is internally inconsistent and does not define 'true value' for most band cells.
evidence: §4 P1W row W4; 規則 bullet; G1 處置 發版規則 bullet

## 7. R7 [non-blocking] class=decision-now
fingerprint: 863f3fe87465ad09756c84da6af237973ba4b797efd42e273ea77a290de5d5f5
surface: W1c SessionStart + UserPromptSubmit hooks; hook-count bump
claim: The UserPromptSubmit restart probe spawns 'flock -n' in the foreground on every prompt, which is a per-call process spawn the plan does not bound. The final hook count and per-hook latency budget are not stated, although P1W adds several new default-on hooks.
evidence: G1 處置 W1c and 新 hook bullets; P1d sync-version bullet; P3 包裝 bullet; §4 P2

## 8. R9 [non-blocking] class=decision-now
fingerprint: cb813c191c53b55159aecef969599578cc0337d6e25029e7be2d2095cd38b3a4
surface: W1c autostart opt-in and liveness
claim: Two conditions that control autostart and shutdown are undefined, and the non-git case is not stated.
evidence: G1 處置 W1c bullet; P1a watcher 生命週期 bullet; table row W1c

## 9. R10 [non-blocking] class=decision-now
fingerprint: c843b98ec571dbc6f2053dabb5494196b9cf82900718e865710453fc4f70af13
surface: W0b/W1d task-tools dependence
claim: The table still describes W1d with the pre-spike payload assumption. The fallback for task-file consumers other than the band text is incomplete.
evidence: §4 P1W rows W0b, W1d, W1f, W1g; G1 處置 W0b bullet

## 10. R11 [non-blocking] class=decision-now
fingerprint: 93133e6bf6e5a6ad2f69d170cc8698ab739a00011f98da0c23ab334c1cb17411
surface: W1f campaign elapsed anchor
claim: W1f's campaign anchor 'root 最早 work-order' does not say how work-orders are selected. If it relies on the directory name equalling root_run_id (5/5 sample), it is weaker than W1a's in-file binding.
evidence: §4 P1W row W1f; G1 處置 W1a bullet; rubric fact (d)

## 11. R12 [non-blocking] class=decision-now
fingerprint: 875e305f7bbaed5cfaca8ecc5b5bebeba5c519c910c09be6b56d10bbe8b9f4e8
surface: W4 landing scope vs ship split
claim: W4's 'one landing' and 'depends on all' conflict with the ship rule that v2.37.0 needs only the mechanism rows + W3a + the W4 gate, with guidance rows following as PATCH.
evidence: §4 P1W row W4; 出貨切分 bullet; G1 處置 發版規則 bullet

## 12. R2 [non-blocking] class=decision-now
fingerprint: b3edbfc0644c646a7ad20f636c6dfbeeb248a4735c31e4722d168b8c4743d7af
surface: W2c and W3b interim display
claim: Two deferred rows do not state what their surface shows in the meantime.
evidence: §4 P1W rows W2c, W3b; 出貨切分 bullet; G1 處置 來源是否接上 bullet

## 13. R1 [non-blocking] class=decision-now
fingerprint: 9cd5d3046f6f20352765f0d6e349d6c9af04070f97342ff6d399a585bd0db947
surface: context hint field
claim: The context % value has no P1W writer that is guaranteed to fire. W2f only prompts the user to install statusline-live-tee.js, so on hosts without it the field depends on a user action.
evidence: §4 P1W row W2f; P1c band bullet (context from <live-base>/context/<sid>.json)

