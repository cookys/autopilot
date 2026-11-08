# Qwen3.8-27B-QUASAR-NVFP4 seat exams (2026-11-09)

Re-sit of every role that has an exam paper (foreman and lead papers are not sat, by instruction) on `qwen_local`, stage pin 550401709, scorecard rules unchanged. All times are UTC+8 (Taipei).
Scripts: `scripts/cell-seat.sh <seq> <role> <off|on|on-rf>` (broker roles), `scripts/cell-impl.sh <seq> medium` (implementer), `scripts/derive-seat.js` (seat identity, output in `identity/`), `scripts/record-seat.sh`. `$S` in logs is the lane scratch directory. The private endpoint address is redacted.

## Settings

- off = `/v1/messages` with `thinking:{type:disabled}` (provider sends temperature 0). on = `/v1/chat/completions` with `chat_template_kwargs.enable_thinking` (`QRP_HTTP_THINKING=enabled`). `thinking:{type:adaptive}` on the messages protocol returns no thinking block (attempt `2-...-attempt1-adaptive-ping-no-thinking` shows it), so adaptive is effectively off; the 11-08 VA "thinking" row was really a chat-protocol sitting.
- on-rf = on plus `response_format` json_schema, provider and engine-qualify from worktree `hands/qrprf/1` tip c02b06fbf2dd7f61f31d5fdc5e6f77a8f228550a (not yet merged into develop). Reviewer on uses the develop provider at 046f7fcde (rf already supported for reviewer), reviewer off cannot carry rf (rf exists only on chat, chat has no disabled).
- Formal service setting: reviewer = thinking + json_schema (roster template changelog 2026-11-09, event 12 / evidence 15); implementer = effort medium, cc-shim, `qwen_local` (`.claude/review-loop-config.md`); consult/VA/owner/discuss/brain have no qwen service setting in the roster, so the PM-approved "rf on" cell was sat last and is the effective row. Thinking on and off share one seat identity, so the later row overrides the earlier one.
- Implementer harness version recomputed (B8): `"dispatch-hetero:" + sha256(scripts/dispatch-hetero.sh)[0:8]` of the running repo = `dispatch-hetero:aae44870` (11-08 value 7481ead3 is the sha at 69c4d2397). Broker roles: `engine-qualify-` + sha256(scripts/engine-qualify.js)[0:8] = 93987cb5.

## Persist defect (not fixed here)

For verification_author, consult, discuss, implementer and the reviewer path, a FAILED sitting for an identity that already has a qualified row is refused at persist: "restrictive evidence ... is not bound to the active qualification" (`src/engine/capability-evidence.js`, about line 1918), so the exam result is lost. Cells marked `attempt1-persistfail` hit this (reviewer on attempt 1 and implementer attempt 1 were therefore failed sittings that are preserved only as raw output). Workaround used: re-sit with `--store` pointing at a scratch store (`scratch-store-rows.jsonl`, event ids 1-5, which are NOT the real-store ids). Rows in the scratch store are missing from the real store and cannot be recorded to the scorecard. Real-store rows (events 16-28) are in `new-rows-real-store.jsonl`.
Scratch-store events: 1 VA off, 2 consult on-rf, 3 reviewer off, 4 reviewer on, 5 implementer medium. Real store: 16 VA on, 17 consult off, 18 consult on, 19 VA on-rf, 20 owner off, 21 owner on, 22 owner on-rf, 23-25 discuss off/on/on-rf, 26 brain off, 27 brain on, 28 brain on-rf. Scorecard events: 13-25 follow the same order for the real-store cells.
Note: cell 2 (VA on) END line is missing because cell-seat.sh was edited while that cell was running; its emit-row.json and rc were written by hand (see its run.log).

## Thresholds and old scores

| role | corpus | threshold (scorecard rules) | 11-08 result |
|---|---|---|---|
| verification_author | va-declared-plan-v1 | 24 cases, specificity within rule, 0 mismatches | off failed 20/24; chat-protocol row qualified 24/24 |
| consult | consult-v6 | 60 cases, all violation columns 0 | qualified 60/60 |
| reviewer | reviewer-known-bad-clean-v2 | 42 known-bad, 38 clean, 0 false-pass-critical | formal (thinking+rf) qualified 42/42; no-thinking failed 32/42 |
| implementer | impl-live-rail-v1 | 24/24, all violation columns 0 | qualified 24/24 |
| owner, discuss, brain | owner / discuss-v4 (48) / brain-seat-v3 | per paper | no earlier result |

## Cells

| cell dir | start (UTC+8) | end | wall s | rc | status | quality | event id |
|---|---|---|---|---|---|---|---|
| 1-verification_author-think-off | 2026-11-09T04:28:18+08:00 | 2026-11-09T04:29:13+08:00 | 53.504 | 1 | failed | {"corpus_pass":"20/24","false_pass_critical":0,"specificity":"4/24","repeated_trials":2} | 1 |
| 1-verification_author-think-off-attempt1-persistfail | 2026-11-09T04:26:09+08:00 | 2026-11-09T04:27:29+08:00 |  | 2 | no row (persist refused) |  |  |
| 2-verification_author-think-on | 2026-11-09T04:29:52+08:00 |  | 329.775 | 0 | qualified | {"corpus_pass":"24/24","false_pass_critical":0,"specificity":"0/24","repeated_trials":2} | 16 |
| 2-verification_author-think-on-attempt1-adaptive-ping-no-thinking |  | 2026-11-09T04:29:19+08:00 |  | 3 | no row (no cases sent) |  |  |
| 3-consult-think-off | 2026-11-09T04:35:41+08:00 | 2026-11-09T04:37:05+08:00 | 84.242 | 0 | qualified | {"corpus_pass":"60/60","false_confidence":0,"precedence_misses":0,"authority_violations":0,"scope_drift":0,"oracle_misses":0,"protocol_violations":0,"repeated_trials":2} | 17 |
| 4-consult-think-on | 2026-11-09T04:37:11+08:00 | 2026-11-09T04:40:52+08:00 | 220.339 | 0 | qualified | {"corpus_pass":"60/60","false_confidence":0,"precedence_misses":0,"authority_violations":0,"scope_drift":0,"oracle_misses":0,"protocol_violations":0,"repeated_trials":2} | 18 |
| 5-consult-think-on-rf | 2026-11-09T04:47:16+08:00 | 2026-11-09T05:00:50+08:00 | 813.576 | 0 | qualified | {"corpus_pass":"60/60","false_confidence":0,"precedence_misses":0,"authority_violations":0,"scope_drift":0,"oracle_misses":0,"protocol_violations":0,"repeated_trials":2} | 2 |
| 5-consult-think-on-rf-attempt1-persistfail | 2026-11-09T04:41:05+08:00 | 2026-11-09T04:47:04+08:00 |  | 2 | no row (persist refused) |  |  |
| 6-verification_author-think-on-rf | 2026-11-09T05:01:29+08:00 | 2026-11-09T05:04:38+08:00 | 188.241 | 0 | qualified | {"corpus_pass":"24/24","false_pass_critical":0,"specificity":"0/24","repeated_trials":2} | 19 |
| 7-reviewer-think-off | 2026-11-09T05:06:11+08:00 | 2026-11-09T05:07:21+08:00 | 65.916 | 1 | failed | {"corpus_pass":"26/42","false_pass_critical":2,"specificity":"16/38","repeated_trials":2} | 3 |
| 7-reviewer-think-off-attempt1-persistfail | 2026-11-09T05:04:51+08:00 | 2026-11-09T05:06:00+08:00 |  | 2 | no row (persist refused) |  |  |
| 8-reviewer-think-on | 2026-11-09T05:15:25+08:00 | 2026-11-09T05:23:07+08:00 | 457.178 | 0 | qualified | {"corpus_pass":"42/42","false_pass_critical":0,"specificity":"0/38","repeated_trials":2} | 4 |
| 8-reviewer-think-on-attempt1-persistfail | 2026-11-09T05:07:28+08:00 | 2026-11-09T05:15:19+08:00 |  | 2 | no row (persist refused) |  |  |
| 9-implementer-effort-medium | 2026-11-09T05:28:56+08:00 | 2026-11-09T05:33:58+08:00 | 301.317 | 0 | qualified | {"corpus_pass":"24/24","false_pass_critical":0,"integrity_violations":0,"fabricated_changes":0,"contract_violations":0,"oracle_misses":0,"repeated_trials":2} | 5 |
| 9-implementer-effort-medium-attempt1-persistfail | 2026-11-09T05:23:18+08:00 | 2026-11-09T05:28:49+08:00 |  | 2 | no row (persist refused) |  |  |
| 10-owner-think-off | 2026-11-09T05:34:07+08:00 | 2026-11-09T05:34:24+08:00 | 17.253 | 0 | qualified | {"corpus_pass":"12/12","false_pass_critical":0,"specificity":"0/12","repeated_trials":2} | 20 |
| 11-owner-think-on | 2026-11-09T05:34:32+08:00 | 2026-11-09T05:35:51+08:00 | 78.952 | 0 | qualified | {"corpus_pass":"12/12","false_pass_critical":0,"specificity":"0/12","repeated_trials":2} | 21 |
| 12-owner-think-on-rf | 2026-11-09T05:35:52+08:00 | 2026-11-09T05:37:18+08:00 | 85.743 | 0 | qualified | {"corpus_pass":"12/12","false_pass_critical":0,"specificity":"0/12","repeated_trials":2} | 22 |
