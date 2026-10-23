# Trim audit of docs/plans/2026-10-24-per-turn-gate-phase2.md

Method: for each consecutive commit pair from 9c0aa397d (first version) to this commit's parent state, every sentence or table cell of the older text that no longer appears verbatim in the newer text was listed (script: sentence split on `. ; :` and `|`, exact match after whitespace normalisation) and judged by hand. "Carries" means the sentence states a rule, condition, limit, commitment or approval gate. "Equivalent" means the current text still says the same thing. Splitter fragments (a sentence cut at a colon, or a cell that only changed because a neighbouring clause was edited) are marked frag. Result: 24 sentences were restored, all others are rationale, history, restated elsewhere, or superseded on purpose.

Pairs: A = 9c0aa397d to d41aa8486, B = d41aa8486 to 408f8eeb5, C = 408f8eeb5 to b6ba3a39e, D = b6ba3a39e to f596528ee/b88b6d700.

## Restored (carried a rule and had no equivalent)

| Pair | Removed text (place) | Carries | Action |
|---|---|---|---|
| A,D | "Owner approval of the figure precedes launch" (section 3 caps) | approval gate | restored |
| D | "The caps bound loss; they do not promise completion" | limit | restored |
| A,D | "env -u session-id prefix" (Also kept) | wrapper rule | restored, with the uutils timestamp reason |
| A,D | wrapper "verifies tracked and unmodified" (prereg item 1) | condition | restored |
| A | "Version stays 3.0.0 (owner hold)", no bump / CHANGELOG | commitment | restored |
| A | "first P1 batch, label U, is history only" (Evidence) | scope of evidence | restored |
| B | "PATCH-class surface" (W1 ruling) | semver class | restored |
| B | "a mechanism commit does not edit requirement text" | CLAUDE.md rule | restored |
| B | "beyond the hook timeout budget the design is not shipped" (2.3) | stop condition | restored |
| A | "becomes its own plan when a task with subagents exists" (2.4) | commitment | restored |
| A | "W1 to W3 do not need it [the evaluation] for existence" | ruling | restored |
| A,D | "recomputed by two independent methods ... first JSON object of oracle.log" (metrics) | method | restored |
| A | "Reported, not gating: M3_ON against round-2's 26/29" | reporting duty | restored |
| A,D | "PASS permits documenting ... does not decide a default" | limit | restored |
| A | "(43 over 28)" retry provenance | evidence | restored |
| B | "(30 runs ... as in the rerun)" basis of the 17 USD C-arm budget | derivation | restored as "16.23 in the rerun" |
| B | "the touched hook's own tests" in the P2-1 done condition (was "hooks/tests/run.sh subset for the touched hook") | done condition | restored |
| B | "doc says the text is unevaluated" (W4 evidence) | limit | restored in P2-4 |
| B | "no mid-batch replacement" (U batch rerun) | rule | restored |
| A,B | "a pin change goes to the owner" (CLI auto-updates) | gate | restored |
| A | "run timeout" among hook-trap mitigations | mitigation | restored |
| A | "owner re-logs in, whole-batch rerun only by owner decision" (STOP_AUTH) | gate | restored |
| A | "Cost: the stop rule and cap in section 3; the cap is never raised in place" | rule | restored |
| B | "BLOCKED, not worked around" (hook disagreement / timeout) | rule | restored |

## Judged not carrying, or equivalent present (no action)

| Pair | Removed text | Judgement |
|---|---|---|
| A | status line "follow-up ... reserved; no code changes; needs its own plan review" | shortened; "needs its own plan review" and "no code here" remain |
| A | apply_gate description in Thesis | rationale; "harness gate vs in-session" remains |
| A | "two treatments differ, round-2 numbers a reference" | kept in shorter form |
| A | Out-of-scope list (long form) | same items remain |
| A | A1/A2/B1 detail in section 1 | shortened, same results; full detail is in the P0 README |
| A | batch not rule-valid / label numeric only | kept in shorter form |
| A | cost cell detail (range, 9240 s, C-30 timeout) | history; costs.tsv holds it |
| A | "Consequence for this plan: ... concurrent control" | kept in shorter form |
| A | "Test applied (CLAUDE.md, literal) ... no item edits a skill" | shortened; the literal test is still named |
| A | W1/W4 row wording; "guidance (changes what the model is asked)" | superseded by W4 rewrite (B) |
| A | Decision bullet, "Error is never a block", allowed_reason record | superseded by the log contract (C); "Error never blocks" remains |
| A | turn-boundary fallback sentences | kept shortened |
| A | "The hook knows nothing about t14" / verifier contract wording | same contract, shorter |
| A | "Owner decision O4", "shipping unmeasured hook breaks scorecard-first" | kept shortened |
| A | ON treatment wording "retry text per W4" | superseded by mode wording (B) |
| A | "Sample size: ... claim is no large trade" | replaced by the power paragraph (D) |
| A | old trade check (two-sided p <= 0.05) | superseded by the one-sided rule (B) |
| A | old cost paragraph and table cells (16.1, 21.5, 38, 42.5, 59 ...) | wrong numbers, replaced by script output (D) |
| A | "Proposed cap" wording | kept as "Caps" |
| A | 3.1 intro (P1 rerun could not be called valid ...) and table cell wording (START appended before the call, STOP_WINDOW if exceeded, VERSION before the call, PROBE row, CMD manifest, SCORE parsed by wrapper, ORDER before the call, COST fields, PREREG kept) | each condition and artifact remains in the table, in shorter cells; timing is in the "Applies" column |
| A | "Also kept: ... uutils" | restored above |
| A | NC1 to NC8 old wording ("Red: ...") | replaced by mutation/failing-assertion form (B); iteration ceiling kept in NC2 |
| A | P2-0 done condition (frag; only NC6 clause changed) | rest unchanged in the current text |
| A | P2-1 done "hooks/tests/run.sh subset" | restored above |
| A | P2-2 (frag) | unchanged apart from "(each red then green)" |
| A | "U batch ... only by owner decision" | restored above |
| A | risks "Treatment drift" and "Harness edits touch frozen eval code" | restored (D, see 408f8eeb5 note) / equivalent W5 risk line |
| A | O2, O3, O4, O6 old wording | O2/O3 superseded by the cost and power rewrite; O4, O6 kept shortened |
| A | R0 "Not yet reviewed" | review log now lists R1; plan header still says awaiting review |
| B | W1 "asks the model nothing new by itself" | rationale |
| B | "ON/OFF evaluation (section 3)" evidence cell, "Until it passes ..." | superseded by W4 phase ownership; unevaluated-doc clause restored above |
| B | treatment sentence "rerun wrapper behaviour" | label only; the probe and credentials rules remain |
| B | old power sentence, old trade check, old instrument health | superseded by the log/HOOKCOUNT and one-sided rules |
| B | "hard maximum is 5 x N" | present in the cost paragraph and table |
| B | caps split detail, "Hitting a cap ... section 3.3 of the parent plan" | kept shortened |
| B | "Owner approval of the figures precedes launch" | restored above |
| B | --selfcheck / --audit sentences | kept shortened; "valid only if exits 0" remains |
| B | TURNS, HOOKCOUNT cells | superseded by per-arm and gate-only forms |
| B | P2-0/P2-1/P2-2/P2-4 cell fragments | superseded by the W4/NC6 reassignment; the substantive clauses are restored above |
| B | "Treatment drift: a PASS is evidence for this hook ..." | restored in the later edit (D follow-up) |
| B | "One task, one alias, one CLI pin" | kept; pin clause restored above |
| B | W5 risk line, O7 | kept shortened |
| C | "Isolation rests on the trace alone (no side effect ...)" | shortened; P0 README holds the detail |
| C | hook config key sentence | kept shortened |
| C | `allowed_reason` record | superseded by the log contract |
| C | "C1 was affirmative, so the drop consequence does not fire" | implied by "affirmative but deferred" |
| C | old power sentence, per-block cost "(longer context)" | superseded / wording only |
| C | BLOCKMAX and NC6 wording | superseded by the log contract |
| D | evidence list wording; "An ON run adds model turns per block" | wording |
| D | cost table cells (16.1, 0.70, 21.5, 38, 1.40, 42.5, 59, 77.5) | replaced by cost-power.py output |
| D | "wrapper's own sha256 ... log header" | present in prereg item 2, shorter |
| D | "The condition-to-artifact table below is in the preregistration and implemented by the wrapper" | present as "The table below is in the preregistration ..." |
| D | O3 old power figure | replaced by one-sided figure |
