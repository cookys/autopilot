# G1 findings (mods-visible-dispatch-2026-10-03-p1w, generation 1)

verdict: CONDITIONAL | policy_reason: depth_0_adjudication_required | next_generation: 2 | seat opus_chair: success/strict

## 1. R1 [blocking] class=decision-now
fingerprint: cf854b831d9d45ef9e236f9f2d26d298f1bea42292fc03ff6832d1c32b3c78b7
surface: src/status/runs-watch.js assemble() inputs decision and compare (P1W W1a/W1g/W2a/W2e/W3a)
claim: Two of the four hard-coded watcher inputs have no row that removes the hard-coding. W1a replaces progress, and W1g replaces planned. No row changes the watcher to read decision.json (W2a) into decision. No row changes it to read compare-record.json (W2e) into compare. Writing those files therefore leaves decision: null and compare: [] on every publish, so 要你決定 (decision path) and the compare section never light up from those writers.
evidence: §4 P1W rows W1a, W1g, W2a, W2e, W3a; 起因 bullet citing src/status/runs-watch.js:394

## 2. R1 [non-blocking] class=decision-now
fingerprint: 199cf562fd84ac06112abb4ac1c27b9742c1b2acfc37739a316615ca4d0da5ef
surface: planned and decisions-made count for non-campaign modes (dev-flow, /l3)
claim: planned has a writer only for campaigns (W1g reads the campaign execution graph). For dev-flow and /l3 without a campaign, no row gives planned a writer, and the row does not state the honest fallback. W1h covers only engine auto-adjudications. Depth-0 proxy decisions (depth0-control-loop.md:406, never produced a file) have no mechanism writer, and no guidance row covers them either, so the 代你決定 count stays a partial undercount without saying so.
evidence: §4 P1W rows W1g, W1h; §4 P5 順序 1

## 3. R2 [non-blocking] class=decision-now
fingerprint: b5ce15106eea54c7dad9d7c6cf63bf09fadfbbf518c191d4c4f36db9ab986a3a
surface: W1i honest-text rule; band verdict words and fields fed by W1d/W1e/W2a/W2b/W2c/W2e/W3b
claim: W1i defines the 來源未接 text but not how a reader distinguishes 'source not wired' from 'source wired, currently empty'. Once W2a ships, an absent decision.json must render as 目前沒有待你決定, but before W2a ships the same absence must render as 來源未接. No signal is defined to tell these apart. The plan also does not say what 要你決定 and 待命 show while W1d/W1e wait on spikes. Showing 待命 when attention is unwired would be a misleading value.
evidence: §4 P1W rows W1i, W3a, 出貨切分 bullet

## 4. R3 [non-blocking] class=decision-now
fingerprint: d5944866f5687271d4131f8fd1fa7082aea5413d0d68b9f805086c772addb6b2
surface: P1W 依賴 column (W3a, W2c, W2a)
claim: W3a is missing edges to writers it reads or displays: W1g (planned), W1b (完成待驗收 now uses campaign terminal state or acceptance), W1i (same mod/band text files), and W1c (watcher presence for dev-flow). W2c -> W1c is likely spurious, because run-ledger heartbeat writing does not need watcher autostart. W2a -> W1e is an ordering preference, not a data dependency.
evidence: §4 P1W table, 依賴 column for W3a, W2c, W2a

## 5. R4 [blocking] class=decision-now
fingerprint: a9078ca5029042452da6cdbc0eda550409d680001ba320147ddff4be9084f6f3
surface: Wave 1 parallel dispatch: W1a, W1b, W1c, W1f, W1h, W1i
claim: Wave 1 rows are not file-independent. W1a and W1f both modify the runs-watch.js assemble() call (progress/phase vs elapsed). W1a and W1i both modify render-review-page.js (buildPhase source vs honest text). W1c and W1b (if the merge trigger is a hook) both touch hooks/hooks.json, hook inventory, and hook-count/sync-version. Every row bumps CHANGELOG/version. Parallel dispatch will collide or force ad-hoc serialization.
evidence: §4 P1W 平行派法 bullet and rows W1a, W1c, W1f, W1i

## 6. R5 [non-blocking] class=decision-now
fingerprint: 150826cb4ddb763d51cabc8b9004fe146744a93dc3e8d720ffaa844e90399d43
surface: Row classification W2a, W2c, W1b trigger, W1f export
claim: Several rows mix mechanism and guidance or leave the class open. W2a bundles a helper script (mechanism) with a skill step (guidance). W2c is classified as 先查…缺的部分為指引, which is undecided. W1b's 'merge 後' trigger has no named firing mechanism; if a skill step must call it, it is guidance, not mechanism. W1f's depth-0 export of ROOT_RUN_ID is a mechanism only if the rail does it without a skill-text change. The W1b plausibility claim (finish-flow L-5.3 already reads the file) is consistent with fact (b).
evidence: §4 P1W rows W1b, W1f, W2a, W2c; fact (e)

## 7. R6 [blocking] class=decision-now
fingerprint: a1ccc836ae6df8a463e9ee4db32195d731214b47a86d6129f38fbba5f5346cc7
surface: P1W release gate (W4 owner ssh+tmux real run)
claim: The gate is not falsifiable. Four problems: (1) 'band 每格是真值' has no per-cell pass/fail definition; (2) the gate conflicts with shipping v2.37.0 while guidance cells legitimately show 來源未接; (3) one ordinary run per mode will usually never exercise 要你決定, 疑似卡住, or 完成待驗收, so those cells cannot be observed; (4) the mode list omits /l6 and ceo-agent without /lN, which the plan itself names as unwired.
evidence: §4 P1W 規則 bullet, row W4, 出貨切分 bullet

## 8. R7 [non-blocking] class=decision-now
fingerprint: 4c1a71c7433d7a33b6239ba1f35723f12643e486a75d829ad42663b5d4e2425c
surface: Default-on hooks W1c (SessionStart), W1d (PostToolUse Task), W1e (attention)
claim: Only W1c mentions a disable knob and hook-classes. None of the three rows states latency cost, knob name, hook-inventory registration, hook-count bump, or semver class. The count interacts with P1d (32) and P3 (33). New hooks are PATCH but are slated into the MINOR v2.37.0. W1d's matcher 'Task 工具' is ambiguous: it could include the Agent/Task subagent tool and spawn Node on every call, against the P2 baseline. W1c does not bound the detached spawn per SessionStart, for example with a foreground flock -n probe before spawning.
evidence: §4 P1W rows W1c, W1d, W1e; §4 P1d, P3 包裝

## 9. R8 [non-blocking] class=decision-now
fingerprint: d24561c55f8e16227d29b209b2dd8dfe5a0bfa5ebbee92bf5998dabd9d652f95
surface: New files <live>/tasks/<sid>.json, <live>/attention/<sid>.json, decision.json, decisions sidecar, task-status bundle
claim: The new contracts have no schemas, scope keys, or writer discipline. tasks/<sid>.json holds aggregate counts that concurrent PostToolUse invocations would read-modify-write without a lock. decision.json has no defined location or scope (project, root, or sid), and no stated single writer. The sidecar and bundle do not state null-vs-0 semantics. The plan does not say whether new assemble() inputs extend runs-live/1, which is additionalProperties:false per P5.
evidence: §4 P1W rows W1d, W1e, W2a, W2d, W1b; §4 P5 順序 2

## 10. R9 [blocking] class=decision-now
fingerprint: a50b091bd74f5fdd48d917bdf579e2e7a07816a80d71594267b8e925a86b0428
surface: W1c watcher autostart from SessionStart (dev-flow, ceo-agent without /lN)
claim: The existing --idle-exit rule keeps the watcher alive only while an unexpired session-mode marker exists. Dev-flow sessions, the exact case W1c targets, have no marker. A hook-started watcher therefore self-exits after 3600 s with no live runs while the session is still open. SessionStart does not re-fire, so the band goes stale mid-session and the dev-flow release cell fails. Scope is also undefined: 專案有 project_key is circular for unmarked repos (fact c), and if the hook computes the key from cwd, every git repo session on the host starts a watcher. The plan does not cover the resource bound, the opt-in for non-autopilot repos, or session-end cleanup.
evidence: §4 P1W row W1c; §4 P1a watcher 生命週期; fact (c)

## 11. R10 [non-blocking] class=decision-now
fingerprint: 4bd84d7ae0e67f6f6a20c1988d5e8d4e07d9864e97b627ca1926256c6b7df85e
surface: W0b spike, W1d task writer, W2b phase fallback
claim: W1d already names payload fields (subject, status, id, first_created_at) before W0b answers. No fallback is stated if the task-tools pin makes TaskCreate/TaskUpdate unavailable or changes their shape. W2b's interim phase source is W1d, so a W0b=no outcome leaves dev-flow phase and progress with no writer and no stated band text.
evidence: §4 P1W rows W0b, W1d, W2b

## 12. R11 [non-blocking] class=decision-now
fingerprint: d0276cac2213c99157419e12eac9c0a5661c5097b0ebc4e216f427440f2b7ea9
surface: W1a work-order binding, W1f ROOT_RUN_ID export, W3a phase mapping
claim: W1a binds work orders to a root by directory name based on a 5/5 sample and picks the 'latest' work-order without an ordering key. It should confirm the binding against an in-file root field and leave the record unbound on mismatch. W1f's rail-side export must only propagate an existing AUTOPILOT_ROOT_RUN_ID or PARENT; it must never mint a root for ad-hoc dispatch, or it violates §2.7 (no guessing, unbound when no root). W3a does not state that awaiting_disposition (case-insensitive) maps to 進行中 or depth-0-waiting, never to 要你決定.
evidence: §4 P1W 已確認事實 bullet, rows W1a, W1f, W3a; §2.7 table

## 13. R12 [blocking] class=decision-now
fingerprint: 43a507defc3804b5cd05ba680bebfd03c29f32d7efe97713ec42adb0dfa413a2
surface: P1W ship split vs W4 and owner ruling
claim: The release gating is self-contradictory. The owner ruling says v2.37.0 ships only after P1W 完成. 出貨切分 and the R5 log say v2.37.0 ships when the mechanism rows are done and guidance rows follow as PATCH. W4 (which produces v2.37.0) depends on 全部, including guidance rows W2a/W2b/W2c/W2e and spike-pending W3b, and is 一次 landing of W1–W3. W1d and W1e are listed among the mechanism W1* rows but wait on spikes. Per-row test requirements name RED-first and mutation but no negative controls for the new writers, such as a stale tasks file, an attention file left after its end signal, or a decision.json from a wrong root.
evidence: §4 P1W owner 裁決 bullet, row W4, 出貨切分 bullet; Review log R5

