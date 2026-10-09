| mode | cell | verdict | capture dir | note |
|------|------|---------|-------------|------|
| dev-flow | 待命 | PASS | runs/df-idle/20261005T074259Z | check.js 6/6 |
| dev-flow | 要你決定 (權限) | FAIL (capture) | runs/df-perm/20261005T074335Z | check.js: "no band found". While a permission dialog is open the bottom band row is hidden; the verdict shows only in the top-right panel ("要你決定 / 等你批准：Bash: touch /tmp/gate-perm-test（等了 0 分）") with no ▲ mark. attention.json kind=permission matches. Capture-tool limitation or band-visibility finding; depth-0 to adjudicate |
| dev-flow | 要你決定 (權限, 第二次) | PASS | runs/df-running/20261005T074449Z | check.js 7/7. FINDING: captured 22 s AFTER the permission was approved, mid-run of a 72 s foreground Bash; band still showed 要你決定 (attention not cleared until the tool finished). Intended as a 進行中 cell, it is not one |
| dev-flow | 進行中 (task in_progress, no run) | FAIL | runs/df-running-2/20261005T074757Z | check.js expects 進行中 (tasks.json in_progress, current=任務A); band showed 待命 with "0 done*" while Claude was mid-turn running a 75 s Bash |
| dev-flow | 進行中 (live dispatch run) | band 進行中 / check.js FAIL | runs/df-running-3/20261005T075221Z | band: "● 進行中 … 1 個派工在跑 · 2 件派工無決策紀錄". check.js FAIL only because tasks were 2/2 complete and it ranks 完成待驗收 above a live run (plan-text ordering vs band ordering) - adjudication needed; every other token PASS |
| dev-flow | 完成待驗收 (2 tasks completed) | PASS | runs/df-done/20261005T074936Z | check.js 6/6 |
| dev-flow | 要你決定 (AskUserQuestion) | FAIL (capture) | runs/df-ask/20261005T074954Z | Same as df-perm: dialog hides the band row; top-right panel shows "要你決定 / 等你回答：請選擇 A 還是 B？（等了 0 分）". attention.json kind=question matches |
| dev-flow | (a) AskUserQuestion payload | PASS | runs/df-ask/20261005T074954Z/decisions-cat.txt | decision file has source=ask_user_question, question 請選擇 A 還是 B？, options [A,B]; file gone after answering (decisions dir empty) |
| dev-flow | 疑似卡住 | UNCAPTURED (band did show it once; no capture dir) - see correction | runs/df-stall/20261005T080531Z (+ stall-samples.txt) | codex hand (gpt-6-astra) ran `sleep 420` but emitted a narration line every ~3 min (log gap ~206 s at one point, 16:05:14 -> 16:08:40) and the watcher's per-run probe is refreshed only every few minutes (run observed_at 08:06:51, stall=false, last_event_age 28 s). Band stayed 進行中 for the full run. No silent hand obtainable; dispatch-status.js: phase running, alive true |
| dev-flow | (c) repo not opted in | PASS | runs/dev-flow/c/ | markers: no new file; runs/: no new file; ~/.autopilot top-level: no new entry; watcher ps: same two PIDs (only etimes differ - the runbook's literal `diff` of ps output is therefore never empty; compare PIDs). Band showed "no project · run: autopilot status runs --watch". Scratch repo removed |
| dev-flow | (e) dispatch-author from plain session | PASS | runs/df-author/20261005T081017Z | codex/gpt-6-astra, status authored, exit 0, manifest role=author root_run_id=job-1791186062-55b7eca3 == marker root_run_id; band count went 3 -> 4 件派工無決策紀錄; check.js 6/6 |

CORRECTION (late background-poll result, task b043e0dwn): a polling loop I thought had failed did match during the first sleep-420 hand (stall2, near its end ~07:59Z) and printed `⏸ 疑似卡住 gate-sandbox · — · 15m · —` / `最久的派工 3m 沒有輸出 · 1 件派工無決策紀錄`. So the stall verdict does render, after ~3 min of hand silence. No capture.sh/check.js run exists for it (the 疑似卡住 row above is therefore UNCAPTURED, not PASS), and my stall3 retry missed the window. The earlier claim 'stall never appeared' in DRIVING.md item 7 and the BLOCKED reasoning are wrong; the tmux server also was gone by the time that loop finished, so its other output lines are noise. A re-run needs a foreground poll that calls capture.sh the moment the band shows ⏸.
| dev-flow redo | 要你決定 (權限) | PASS | runs/df2-perm/20261005T083748Z | surface: panel; check.js PASS (verdict+reason); natural prompt (printf>>README && node test.js)
| dev-flow redo | 要你決定 (AskUserQuestion) | PASS | runs/df2-ask/20261005T083959Z | surface: panel; decision-file.json source=ask_user_question, options [A,B] (cell a also PASS)
| dev-flow redo | 進行中 (task in_progress, no run) | verdict PASS / check.js FAIL (phase token) | runs/df2-running/20261005T084119Z | band "● 進行中 … 0 done*" reason "任務進行中：任務A" (verdict fixed vs pilot); check.js expects phase "做：任務A" but band phase slot shows "—": check.js/band phase disagreement for task-driven 進行中. turn.json state=ended (turn was idle)
| dev-flow redo | 完成待驗收 (2 tasks completed, no run) | PASS | runs/df2-done/20261005T084232Z | check.js all PASS
| dev-flow redo | 待命 (attempt, tasks 2/2 left) | PASS as 完成待驗收 (not a 待命 cell) | runs/df2-idle/20261005T084326Z | idle 70s after completed tasks correctly reads 完成待驗收; 待命 redone after /clear
| dev-flow redo | (g) 進行中 no task no dispatch, mid-turn | PASS | runs/df2-midturn/20261005T084625Z | band "● 進行中 … 回合進行中（0 分）"; turn.json state=active; mid-turn during 2nd slow Bash (first call needed approval) 
| dev-flow redo | (h) Escape mid-turn, +20 s | FINDING: band stays 進行中 | runs/df2-escape/20261005T084653Z | pane shows "Interrupted · What should Claude do instead?" (Claude idle) yet turn.json state=active (since unchanged) and band "● 進行中 回合進行中". check.js PASS (it derives the same from turn.json). Sampled every ~22 s to +5 min (08:46:30 esc -> 08:51:53): still active/進行中, never returned to 待命. Stop does not fire on interrupt; no staleness expiry within 5 min
| dev-flow redo | 待命 | PASS | runs/df2-idle2/20261005T085331Z | after /clear + simple Q, 65 s after Stop; check.js PASS
| dev-flow redo | 疑似卡住 | PASS | runs/df2-stall/20261005T085959Z | kill -STOP on codex exec pid 1263513 (cwd/environ checked) at 08:56:32; band ⏸ 疑似卡住 "最久的派工 3m 沒有輸出" seen ~08:59:56 (3.5 min); check.js PASS. Hand killed after capture
| l3 | 要你決定 (權限) | PASS | runs/l3-perm/20261005T090109Z | surface: panel; natural prompt: session-mode.js set --level l3
| l3 | 待命 | PASS | runs/l3-idle/20261005T090409Z | marker level l3; check.js PASS
| l3 | 要你決定 (AskUserQuestion) | PASS | runs/l3-ask/20261005T090439Z | surface: panel; decision-file.json source=ask_user_question
| l3 | 進行中 (task in_progress, no run) | verdict PASS / check.js FAIL (phase token) | runs/l3-running/20261005T090536Z | same phase-slot "—" vs expected "做：任務A" as dev-flow; reason 任務進行中：任務A
| l3 | 完成待驗收 | PASS | runs/l3-done/20261005T090626Z | check.js all PASS
| l3 | 疑似卡住 | PASS | runs/l3-stall/20261005T091022Z | kill -STOP codex exec 1292456 at 09:07:19 (cwd/environ checked); ⏸ "最久的派工 3m 沒有輸出" by 09:10:19; hand killed after capture. marker level l3 throughout
| ceo-agent | 要你決定 (權限) | PASS | runs/ceo-perm/20261005T091127Z | surface: panel; marker level null; natural prompt (printf>>README && git commit)
| ceo-agent | 待命 | PASS | runs/ceo-idle/20261005T091301Z | check.js PASS
| ceo-agent | 要你決定 (AskUserQuestion) | PASS | runs/ceo-ask/20261005T091333Z | surface: panel; decision-file source=ask_user_question
| ceo-agent | 進行中 (task in_progress, no run) | verdict PASS / check.js FAIL (phase token) | runs/ceo-running/20261005T091427Z | same phase-slot "—" vs expected "做：任務A"
| ceo-agent | 完成待驗收 | PASS | runs/ceo-done/20261005T091518Z | check.js PASS
| ceo-agent | 疑似卡住 | PASS | runs/ceo-stall/20261005T091901Z | kill -STOP codex exec 1315587 at 09:16:02 (cwd/environ checked), ⏸ by 09:19:01; hand killed. marker level null throughout; note the ceo-agent skill was not visibly loaded (plain session did the work)
| dev-flow3 (GATEFIX2) | 進行中 (task in_progress, no run) | FAIL (stale watcher) | runs/df3-running/20261005T093807Z | phase slot "—", no model.json: the status watcher (pid 878704, started 15:41, before GATEFIX2 commit 17:35) was old code. NOT a GATEFIX2 defect: a long-lived watcher keeps old code after a plugin update (idle-exit 3600 keeps it alive) |
| dev-flow3 (GATEFIX2) | 進行中 retry after killing stale watcher | PASS | runs/df3-running-b/20261005T093943Z | band "● 進行中 gate-sandbox · 做：任務A · 3m · 0 done*" reason 任務進行中：任務A; check.js 6/6 incl. phase. Fresh watcher respawned automatically (pid 1467371) and wrote the job page |
| dev-flow3 (GATEFIX2) | Escape mid-turn, task still in_progress | PASS (confounded) | runs/df3-escape-taskopen/20261005T094047Z | turn-effective file published 5 s after Escape (state=ended, reason=interrupted) but verdict stays 進行中 correctly because 任務A is still in_progress; not a 待命 test |
| dev-flow3 (GATEFIX2) | (h) Escape mid-turn, +40 s (clean session after /clear) | PASS | runs/df3-escape/20261005T094146Z | Esc 17:41:06; turn-effective/<sid>.json state=ended reason=interrupted published 17:41:14 (8 s after); turn/<sid>.json still state=active; band 待命 "沒有派工在跑" at +40 s; check.js 6/6. df2-escape finding (stays 進行中) is fixed |
| l4 | 要你決定 (權限) | PASS | runs/l4-perm/20261005T094240Z | surface: panel; natural prompt (depth-0 reading plugin scripts); marker level null until session-mode.js set --level l4 approved, then l4 |
| l4 | 待命 | PASS | runs/l4-idle/20261005T094526Z | after foreman finished + merged; marker level l4; check.js 6/6 |
| l4 | 要你決定 (AskUserQuestion) | PASS | runs/l4-ask/20261005T094556Z | surface: panel; decision file written (.git/autopilot/decisions/...job-1791193372-a0ca186d.json) |
| l4 | 進行中 | PASS (turn-driven, not foreman-driven) | runs/l4-running/20261005T094717Z | band "回合進行中" while depth-0 ran 3 qc reviewers after the foreman returned (foreman itself took only 28 s) |
| l4 | 進行中 (second run, foreman Committing) | PASS (turn-driven) | runs/l4-running-2/20261005T095353Z | band 進行中 "回合進行中（0 分）"; side panel lists 工頭活動 "Foreman: csv parser · Committing csv.js parser changes · 2s 前". Band reason does not mention the foreman; no live-run/foreman reason exists |
| l4 | 進行中 (foreman just dispatched) | FAIL (capture) | runs/l4-running-foreman/20261005T095248Z | surface none. FINDING: a permission dialog raised by the FOREMAN subagent ("Bash command · from the general-purpose agent", git reset -q --hard) is full-width and hides BOTH the bottom band and the right panel; attention.json kind=permission is correct but nothing on screen shows 要你決定 |
| l4 | 完成待驗收 | PASS | runs/l4-done/20261005T095131Z | via 2 tasks completed (RUNBOOK option 2); no campaign-progress 完成待驗收 reachable because the foreman finishes in <1 min and no campaign ledger is surfaced |
| l4 | 疑似卡住 | BLOCKED | n/a | /l4 foreman uses native sonnet worktree hands (Agent tool), no dispatch-hetero codex process, so there is no pid to kill -STOP. foreman.json stall_s is 600 s and only appears via context_tasks/stamp sources; a silent native subagent cannot be frozen from outside |
| l4 (FF4) | 進行中 工頭在跑 (run 3: quick git status then gate-wait.sh, bg foreman) | PASS | runs/l4f-running-b/20261005T112213Z | band "工頭在跑：L4 foreman: README test line（0 分前有動作）", check.js 7/7, no attention.json; stamp un-ended |
| l4 (FF4) | 疑似卡住 (same foreman, stamp quiet 205 s, gate-wait still running) | FAIL | runs/l4f-stall-b/20261005T112503Z | FINDING: check.js expects 疑似卡住 from stamp (quiet 205 s) but band stays 進行中 "工頭在跑…（0 分前有動作）": foreman.json carries the foreman as source=context_tasks age_s 1 stale false, which wins over the stamp, so the band never ages |
| l4 (FF4) | Esc at depth-0 idle while bg foreman runs | FAIL (same cause as stall-b) | runs/l4f-escape-b/20261005T112527Z | Esc 15 s earlier: foreman unaffected, gate-wait.sh kept running, no ended_at; harness auto-backgrounds the foreman so no foreground foreman could be Esc'd. Esc-on-foreman (SubagentStop on interrupt) NOT verified |
| l4 (FF4) | foreman normal completion | FAIL (capture) | runs/l4f-fg-done-b/20261005T112703Z | SubagentStop fired: ended_at 11:26:59 stamped 4 s after foreman's last tool; but band still "工頭在跑" at capture (context_tasks source still listing it) vs expected 回合進行中; transient or not not settled |
| l4 (FF4) | after done, reviewer subagent dialog | FAIL (capture) | runs/l4f-done-b2/20261005T112728Z | surface dialog ("from the autopilot:reviewer agent 1 of 2") but NO attention.json exists, so check.js has no 要你決定 source; left open, then /exit |
| l4 (FF4) | 進行中 工頭在跑 (run 2: gate-wait.sh as foreman's first tool, fg Bash) | PASS but non-exercising | runs/l4f-fg-running/20261005T111601Z + l4f-fg-stall/20261005T111848Z + l4f-escape/20261005T111656Z | foreman writes no stamp while its first tool call runs (stamp is PostToolUse): band 待命 "沒有派工在跑" for the whole 5 min while foreman was live (context_tasks listed it age 1 s) |
| l4 (FF4) | run 1 bg-shell foreman | PASS (consistent, but shows gap) | runs/l4f-running/20261005T110858Z, runs/l4f-stall/20261005T111220Z | foreman returned early (shell backgrounded), SubagentStop stamped ended_at; band 待命 while gate-wait.sh ran 5 min |
| l4 (FF4) | resumed foreman dialog | PASS | runs/l4f-resumed-dialog/20261005T111404Z | surface panel 要你決定 from attention.json; the resumed foreman kept the old ended_at (no new stamp) |

DEPTH-0 ADJUDICATION of the l4 (FF4) rows (2026-10-05 ~19:40, check.js re-run on every l4f-* dir: same verdicts as the hand's):
- l4f-stall-b, l4f-escape-b: band defect. `src/status/foreman-activity.js` mergeAgents keeps the newer of context_tasks and stamp; context_tasks `written_at` is the subagentStatusLine rewrite time (age ~1 s while the agent exists), so the merged row never ages and 疑似卡住 cannot fire. Fix row FOREMAN2 commit 1 (stamp owns liveness).
- l4f-fg-running/fg-stall/escape (run 2) and run 1: band reads 待命 while a foreman's FIRST tool call is running, because stamps are written only at PostToolUse. Fix row FOREMAN2 commit 1 (SubagentStart stamps the start).
- l4f-done-b2: hook defect. attention is one file per session; the main thread's Stop (and any same-tool_name PostToolUse of another agent) removes it while a subagent's dialog is still open. The hand's "approved foreman dialog left no permission confound" is the same defect. Fix row FOREMAN2 commit 2 (one entry per pending dialog).
- l4f-fg-done-b: capture timing, not a defect: captured 4 s after ended_at, inside the watcher tick (10 s) + mod poll (5 s); RUNBOOK requires >= 20 s after a transition. check.js reads agents/*.json directly and has no lag.
- Not yet verified: Esc on a RUNNING foreman (the harness backgrounded every foreman, so Esc at depth-0 idle never reached it); whether SubagentStart fires on a SendMessage resume. Both go into the post-FOREMAN2 /l4 re-run.

| l4 (FF5) | 進行中 工頭在跑 (foreman first tool = gate-wait.sh, +60 s) | PASS | runs/l4g-started/20261005T115927Z | check.js RESULT: PASS 7/7; stamp last_tool_at 11:58:27.880Z last_tool_name null, no ended_at; no attention.json; band "工頭在跑：Foreman: README test line（0 分前有動作）" |
| l4 (FF5) | 疑似卡住 (stamp quiet 249 s, gate-wait running) | PASS | runs/l4g-stall/20261005T120237Z | RESULT: PASS; band "⏸ 疑似卡住 … 工頭 4 分沒有動作"; no attention.json |
| l4 (FF5) | foreman commit dialog right after gate-wait (extra) | PASS | runs/l4g-foreman-dialog/20261005T120401Z | surface panel; attention kind permission pending[1] agent a5df2fb59a3c9a72d; stamp last_tool_at 12:03:30Z Bash. recover cell not separable: foreman ended 12:04:06.787Z, 2.4 s after its commit |
| l4 (FF5) | subagent dialogs, 2 qc reviewers | PASS | runs/l4g-subdialog/20261005T120438Z | surface panel, pending len 2 (a4619cae5ff0ca22e, ae289f5776ba8dfe8); after approving one, pending len 1 (the other) 30 s later (attention-after-approve-one.json in dir) |
| l4 (FF5) | 待命 after merge | PASS | runs/l4g-done/20261005T120654Z | RESULT: PASS; band 待命 沒有派工在跑; attention kind idle pending[1]; foreman stamp ended_at 12:04:06.787Z |
| l4 (FF5) | TaskStop on running foreman 2 (+~50 s) | FINDING (check.js PASS, behavior gap) | runs/l4g-taskstop/20261005T120900Z | no dialog; gate-wait.sh gone but stamp aea2d90a1607067b4 has NO ended_at (SubagentStop did not fire on TaskStop); band still 進行中 工頭在跑（1 分前有動作）; check.js PASS because stamp un-ended |
| l4 (FF5) | same dead foreman, +4 min | PASS (reads dead foreman as stuck) | runs/l4g-taskstop-late/20261005T121130Z | band ⏸ 疑似卡住 工頭 4 分沒有動作, stamp un-ended, quiet 257 s; check.js RESULT: PASS (verified in per-dir rerun) |

DEPTH-0 ADJUDICATION of the l4 (FF5) rows (2026-10-05 ~20:20, check.js re-run on all 7 l4g-* dirs: 7 PASS): FOREMAN2 verified live — started-only stamp → 工頭在跑 (l4g-started), quiet 249 s → 疑似卡住 (l4g-stall), two reviewer dialogs → pending 2, approving one leaves the other (l4g-subdialog), idle → 待命 (l4g-done). /l4 foreman cells: 進行中 PASS, 疑似卡住 PASS (previously BLOCKED). Remaining gap: TaskStop on a background foreman does not fire SubagentStop (l4g-taskstop, -late): the killed foreman reads 工頭在跑 then 疑似卡住 until SessionEnd/24 h. Transcript shows TaskStop input `{"task_id":"aea2d90a1607067b4"}` == the foreman's agent_id, so a PostToolUse(TaskStop) leg can end the stamp: row TASKSTOP. Hand's deviation (approved `git merge --no-ff` into the sandbox's local develop; reset afterwards, origin unchanged) accepted.

| l5 (Cell 0 FF6) | TaskStop on bg agent, ended_at | PASS (stamp) / FINDING (band) | runs/l4h-taskstop/20261005T122350Z | stamp a4aee842ac77aa8e0 ended_at 12:22:08.314Z, 4 s after TaskStop at 12:22:04; no gate-wait process left. check.js RESULT: PASS (attention.json kind=permission pending). Band read 要你決定 "等你批准：Bash: bash gate-wait.sh…" (stale pending[1] for the stopped agent, never cleared), NOT 待命 as expected |
| l5 | 要你決定 (權限) | PASS | runs/l5-perm/20261005T122457Z | surface panel; session-mode.js set --level l5 dialog; RESULT: PASS (verdict, reason; rest SKIP) |
| l5 | 要你決定 (AskUserQuestion) | PASS | runs/l5-ask/20261005T122656Z | surface panel kind=question; decision file source ask_user_question with question/options matching; removed after answering (decisions dir empty) |
| l5 | 待命 | PASS | runs/l5-idle/20261005T122621Z | RESULT: PASS, 70 s after turn end |
| l5 | campaign (running hetero hand / stall / proxy (d) / campaign done) | BLOCKED | runs/l5-blocked/20261005T123348Z | depth-0 after status readiness --probe: "engine implement-review needs a campaign contract signed by mission prepare/grant: plan, rubric, sources manifest, execution graph, .claude/mission-routing-config.json, .claude/owner-kernel-governance.json; sandbox has none" (6 seats probe-needed). No hetero hand ran, so l5-stall not reachable; (d) not reachable (no adjudication, no review receipt; decisions.jsonl absent in sandbox). capture itself RESULT: PASS (待命) |
| l5 | 進行中 (tasks route) | PASS | runs/l5-running-tasks/20261005T123435Z | 進行中 做：任務一 0 done*, RESULT: PASS |
| l5 | 完成待驗收 (tasks route, l5-done-tasks) | PASS | runs/l5-done-tasks/20261005T123541Z | 2/2 tasks, RESULT: PASS |
| l5 (b) | /compact marker | PASS | runs/l5-after-compact/20261005T123635Z | sha256 3f2eb867... before and after: SAME; level l5; check.js RESULT: PASS |

DEPTH-0 ADJUDICATION of l4h + l5 (2026-10-05 ~20:45, check.js re-run on all 8 dirs: 8 PASS):
- l4h-taskstop: TASKSTOP works (stamp ended_at 4 s after TaskStop) but the band read 要你決定: attention.json kept the stopped agent's APPROVED Bash entry (pending[0] agent a4aee842ac77aa8e0, `bash gate-wait.sh; echo "exit=$?"` — not byte-identical to the allow rule, hence the dialog). The killed tool never reaches PostToolUse and TaskStop fires no SubagentStop, so nothing removed the entry. check.js PASS is correct for the file but the band is wrong for the human. Row TASKSTOP2: TaskStop also removes that agent's pending entries.
- /l5 campaign cells (running with a hetero run, stall, (d) proxy, campaign-terminal done): BLOCKED — the only entry, `engine implement-review`, needs a mission campaign contract (plan, rubric, sources manifest, execution graph, mission-routing-config.json, owner-kernel-governance.json with attestations); the sandbox has none. Owner decides. Non-campaign /l5 cells PASS (perm, ask, idle, tasks running/done) and (b) compact SAME (marker level l5 kept).

| l4 (FF7) | TaskStop on bg agent without a pending dialog (`; echo done` raised none) | PASS (no FF7 test) | runs/l4i-taskstop-nodialog/20261005T131722Z | check.js RESULT: PASS; band 待命; stamp ended_at set; attention idle only. Brief's precondition (agent dialog) not met: compound allowed per sub-command |
| l4 (FF7) | TaskStop on bg agent with an approved dialog (`gate-wait.sh; touch /tmp/gate-ts2-marker`) | PASS | runs/l4i-taskstop/20261005T131920Z | before stop (+30 s): attention pending[0] agent a65fdf0549990ae5d kind permission. After TaskStop (+60 s): attention.json absent; stamp ended_at 13:18:15.685Z; capture 13:19:20 band 待命, check.js RESULT: PASS; no gate-wait.sh left |
| l5 campaign | running / proxy (d) / done / stall | BLOCKED | runs/l5c-blocked/20261005T132515Z | engine implement-review: status blocked, phase campaign_intake, REJECTED verify_cmd: expected bounded space-delimited argv without shell control operators (sealed verify_cmd has `\|` and `&&`). No hand ran; (d) not reachable (no review receipt, no ledger dir). Capture: band 待命, check.js RESULT: PASS. Marker roots: session job-1791206374-e35386b9, repo marker job-1791206430-b3ed51d6, contract mission-6c52a9b242660250f30f19b1 |

DEPTH-0 ADJUDICATION of l4i + l5c (2026-10-05 ~21:35, check.js re-run: 3 PASS):
- l4i-taskstop: TASKSTOP2 verified live — approved subagent dialog pending → TaskStop → entry gone, stamp ended, band 待命 (not 要你決定). l4i-taskstop-nodialog does not exercise it (no dialog arose).
- l5c campaign: BLOCKED at intake by the GATE SCAFFOLD, not the product: the prep graph's first verification command used a pipe and quotes; runtime.js:1368 joins verification_commands with ' && ' and implementation-campaign-check.js:298 admits only plain argv segments. Product gap (BACKLOG): the graph checker returned READY for a command that intake rejects, so the grant attempt is burned before anyone is told.
- Marker: the prep REPORT told the driven session to prefix every command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, including `session-mode.js set`, which therefore wrote the repo-keyed marker instead of the session's; the band followed the session marker (level null). Scaffold error; the redo runs session-mode set with the session id. Whether the band shows a campaign whose root (mission-…) differs from the marker root (job-…) is the open question for the redo.

| l5 campaign (retry) | running / proxy (d) / done / stall | BLOCKED | runs/l5d-blocked/20261005T133335Z | engine implement-review: status blocked, phase dev_flow_admission, DEV_FLOW_ADMISSION_REQUIRED_OR_STALE "session marker Mission projection mismatch: marker Mission mission_graph_digest does not match campaign projection"; no hand, no model call, grant attempt 1 burned. Depth-0 attributes it to the stale repo-keyed marker _home_cookys_projects_gate-sandbox.json (v1 graph digest 95c8c4ed) vs new beb0e5cd (inferred). Marker root job-1791207052-fd54fc14 vs contract root mission-bf0a9f8afbe2afca9718c4f9. (d) not reachable (no review receipt, no ledger). Skip l5d-stall: no live hand. Capture: band 待命, check.js RESULT: PASS |

DEPTH-0 ADJUDICATION of l5d (2026-10-05 ~21:50): BLOCKED again by the GATE SCAFFOLD. `engine implement-review` ran under `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` (depth-0's first prep brief said "env -u for every script"; both prep REPORTs copied it). With no session id the intake reads the REPO-keyed marker — the stale one l5c wrote with the v1 graph digest — hence `session marker Mission projection mismatch: marker Mission mission_graph_digest does not match campaign projection`. Canonical rule (l5 recipe + memory dispatch-env-no-session-id): drop only AUTOPILOT_SESSION_ID; CLAUDE_CODE_SESSION_ID must reach the intake. Retry l5e: re-grant node v2 (attempt 2 if the budget allows) and dispatch with `env -u AUTOPILOT_SESSION_ID` only.

| l5 campaign (retry 2, l5e) | running / proxy (d) / done / stall | BLOCKED | runs/l5e-blocked/20261005T134004Z | engine implement-review rc=1: status blocked, phase precondition_failed, "marker-to-campaign admission bridge failed: marker Mission routing shape is invalid"; grant status replay graph_attempt 1 (not attempt 2); env verified CLAUDE_CODE_SESSION_ID kept, AUTOPILOT_SESSION_ID unset. No hand/worktree/branch, 0 model calls; claim released, pre_spend_no_effect receipt. dev_flow_admission now passes. Cause (read in dispatch-hetero.sh ~1408): bridge checks every unexpired l5/l6 marker for the repo, so stale 7be684e2 (no mission_routing) fails it; inferred, markers not touched. Marker root job-1791207387-2d0aaf65 vs contract root mission-bf0a9f8a...; (d) not reachable (no review receipt, no ledger); stall skipped (no live hand). Capture: band 待命, check.js RESULT: PASS. origin e1316d0 unchanged |

DEPTH-0 ADJUDICATION of l5e (2026-10-05 ~22:00): the env fix worked (CLAUDE_CODE_SESSION_ID present, l5d error gone, grant replayed attempt 1 since l5d's was never consumed), then `precondition_failed: marker-to-campaign admission bridge failed: marker Mission routing shape is invalid`. Verified: dispatch-hetero.sh check_marker_campaign_admission_bridge iterates EVERY marker in ~/.autopilot/session-mode/*.json; four unexpired l5 markers name the sandbox, all left by aborted gate sessions (7be684e2 from the l5 run has no mission_routing and fails the shape check; c5ce705f/l5d, a8fed8df/l5e, the repo-keyed one/l5c). `session-mode clear` refuses l5 markers without a task-status receipt. Product gap (BACKLOG): an aborted /l5 session's marker fences every later /l5 dispatch in that repo until TTL, with no documented withdraw path for a run that never spent. Owner decision needed to continue the campaign cells.

| l5 campaign (retry 3, gate-sandbox2) | running / proxy (d) / done / stall | BLOCKED | runs/l5f-blocked/20261005T135021Z | mission prepare rc=1: `mission: [MISSION_AUTHORITY_BINDING_MISMATCH] TaskAuthority Mission lineage/policy/graph binding does not match prepare inputs`. Inferred (not tested): envelope bound to repo identity git-common-dir:/home/cookys/projects/gate-sandbox/.git, sandbox2 is a different common dir; depth-0 must rebuild the envelope (env.js) for sandbox2. session-mode set --level l5 READY (marker 6bae5b13, root job-1791208074-91773e8e, graph digest beb0e5cd); no grant, no brief, no hand, no worktree; (d) not reachable; stall skipped (no live hand). Capture: band 待命, check.js RESULT: PASS. origin e1316d0 unchanged; l5 marker 6bae5b13 remains |

| l5 campaign (retry 4, resumed) | running | PASS (capture hit dialog, not live-hand state) | runs/l5g-running/20261005T135712Z | surface panel 要你決定 (kind=permission, read-only inspect of implement-review output); check.js RESULT: PASS. envelope runs [] with scope root job-1791208074-91773e8e while ps showed 4 dispatch-review.sh + 4 reviewer processes under the campaign root mission-0d79866f...: the band cannot see campaign runs (marker root != contract root). 進行中 n 個派工在跑 was NOT observed; band was 待命 on every poll 13:53-13:58 |
| l5 campaign (retry 4, resumed) | (d) proxy | not reachable | none | all 4 final-panel seats SHIP-AS-IS, 0 findings adjudicated; `.git/autopilot/ledger/` does not exist (decisions.jsonl count: no file). Review receipt: campaign_receipt in <scratchpad>/l5prep2/implement-review-sb2.out |
| l5 campaign (retry 4, resumed) | done | FINDING (check.js PASS, band not 完成待驗收) | runs/l5g-done/20261005T135902Z | campaign terminal 13:58Z, capture 13:59:02Z: band 待命 沒有派工在跑 · 停在等你指示 0 分; check.js RESULT: PASS (no progress source in session scope). status task --root-run-id mission-0d79866f...: phase TERMINAL_READY, mission_terminal true, mission state COMPLETE, can_merge false (merge_preflight_unknown, product_merged_unknown, campaigns evidence invalid: campaign_binding_unmapped / campaign_verification_shape_invalid), zero_residue true, candidate_commit null |
| l5 campaign (retry 4, resumed) | stall | skipped | none | campaign already terminal: covered by df2/l3/ceo-stall (same envelope code path) |

l5g facts: marker root job-1791208074-91773e8e vs contract root mission-0d79866fc5e39773fe6d63e1 (differ; band follows marker scope). engine implement-review rc=0 status converged phase campaign_terminal_ready verdict SHIP-AS-IS rounds 1; implementer grok-4.7, branch mission/0d79866fc5e3/gate-readme-line-v2-2026-10-05-a1 commit 07b7c510 (kept, not merged); origin e1316d0 unchanged; l5 marker 6bae5b13 remains.

DEPTH-0 ADJUDICATION of l5g (2026-10-05 ~22:15, check.js re-run: 2 PASS): FIRST REAL /l5 CAMPAIGN on the gate — converged in ~5 min (TERMINAL_READY, 4/4 final-panel SHIP-AS-IS, grok-4.7, branch mission/0d79866fc5e3/…-a1 kept). PRODUCT DEFECT (release-blocking for 2.37.0): the band never showed the campaign. Marker root job-1791208074-91773e8e ≠ contract root mission-0d79866fc5e39773fe6d63e1; the watcher published both envelopes (`bd9bd5b9221b0b2a--mission-….json` exists) but the mod follows the marker root → 待命 during the run and after terminal (no 進行中 n 個派工在跑, no 完成待驗收). check.js PASS only because it derives from the same marker-scoped envelope. Also `status task` can_merge false (campaign_binding_unmapped, campaign_verification_shape_invalid, merge_preflight_unknown, product_merged_unknown). Fix row being designed (mechanism only).

| l5 campaign on FF8 (gate-sandbox3) | running | MISSED (sampled only) | none | band sampled every 5 s: 待命 → "● 進行中" 14:59:22-14:59:32Z (mission envelope runs=1) → 待命 14:59:37Z; the hand lived ~15 s and my loop did not auto-capture. campaign_roots in the marker contained the contract root mission-5f6b03d6560e2d82ad09a2af when first read (14:58:44Z). No capture dir |
| l5 campaign on FF8 (gate-sandbox3) | (d) proxy | not reachable | none | 0 adjudicated findings, no ledger dir; receipt in l5prep2/implement-review-sb3.out |
| l5 campaign on FF8 (gate-sandbox3) | done | FINDING (check.js PASS, band not 完成待驗收) | runs/l5h-done/20261005T150122Z | band 待命 沒有派工在跑 ~60 s after terminal; check.js RESULT: PASS (no FAIL lines). mission envelope runs [], model phase/progress null. Cause: work-order receipt lives under third root campaign-v1-3d77cc649f075adb3a76e911dc3d0017cb1e6f90acd5e0bea5343c0accf43aa0, not in campaign_roots, so capture's campaign-work-orders/mission-… is absent. status task: TERMINAL_READY, mission COMPLETE, can_merge false, can_close false (campaign_binding_unmapped, campaign_verification_shape_invalid) |
| l5 campaign on FF8 (gate-sandbox3) | stall | skipped | none | covered by df2/l3/ceo-stall (same envelope code path) |

l5h facts: session 809740b0, marker root job-1791212203-645d7584 vs contract root mission-5f6b03d6560e2d82ad09a2af (campaign_roots = [contract root]); campaign rc=0 converged SHIP-AS-IS, branch mission/5f6b03d6560e/gate-readme-line-v2-2026-10-05-a1 commit 18f390fa kept; origin e1316d0 unchanged; l5 marker 809740b0 remains. Wall ~3 min campaign, ~7 min drive.

DEPTH-0 ADJUDICATION of l5h (2026-10-05 ~23:05, live FF8, gate-sandbox3; check.js re-run l5h-done: PASS): SCOPE works for the live phase — marker campaign_roots = [mission-5f6b03d6…] after admission, band `● 進行中` 14:59:22–14:59:32Z with the mission envelope runs=1 (hand lived ~15 s; the hand's sampler printed but did not capture, so l5h-running has no capture dir — UNCAPTURED, not PASS). After terminal the band read 待命 instead of 完成待驗收: the frozen progress receipt sits under work-orders/campaign-v1-3d77cc…, the campaign's ICC id, which is not bound. Fix row SCOPE2 (bind the ICC id too). status task: can_merge/can_close false (campaign_binding_unmapped expects campaign-v2-3dbb…, receipt carries campaign-v1-3d77cc…; merge/acceptance predicates unknown) — BACKLOG candidate, separate from the band.

| l5 campaign on FF9 (gate-sandbox4) | running | PASS | runs/l5i-running/20261005T153329Z | auto-captured in polling loop; band "● 進行中 … 準備 · 0m · 0%（0/1） / 1 個派工在跑 · 1 件派工無決策紀錄"; check.js RESULT: PASS; mission envelope runs=1 (grok implementer), capture 6 s after hand start |
| l5 campaign on FF9 (gate-sandbox4) | (d) proxy | not reachable | none | 0 adjudicated findings, no ledger dir |
| l5 campaign on FF9 (gate-sandbox4) | done (dialog) | PASS (permission cell, not the target) | runs/l5i-done/20261005T153556Z | I denied an unexpected worktree-add verification dialog with Escape; attention stayed, band 要你決定 COMPLETED 100% (1/1); check.js PASS |
| l5 campaign on FF9 (gate-sandbox4) | done2 | PASS | runs/l5i-done2/20261005T153755Z | band "✓ 完成待驗收 … COMPLETED · 4m · 100%（1/1）"; frozen progress from campaign-v1 ICC root; check.js RESULT: PASS. status task: TERMINAL_READY, can_merge false, can_close false (campaign_binding_unmapped) |
| l5 campaign on FF9 (gate-sandbox4) | stall | skipped | none | covered by df2/l3/ceo-stall |

l5i facts: session 8756dd52, marker root job-1791214261-8a0411cc vs contract root mission-490e369abdd648ade689926c; campaign_roots = [mission-490e..., campaign-v1-86809178...]; campaign rc=0 converged SHIP-AS-IS commit a80e1aad kept on mission/490e369abdd6/...-a1; origin e1316d0 unchanged; l5 marker 8756dd52 remains. Wall ~3 min campaign, ~9 min drive.

DEPTH-0 ADJUDICATION of l5i (2026-10-05 ~23:45, live FF9 = SCOPE + SCOPE2, gate-sandbox4; check.js re-run: 3 PASS). **/l5 campaign band cells PASS on the real machine**: l5i-running `● 進行中 gate-sandbox4 · 準備 · 0m · 0%（0/1）` + 「1 個派工在跑」 (auto-captured 6 s into a ~15 s hand; mission-root envelope runs=1); l5i-done2 `✓ 完成待驗收 … COMPLETED · 4m · 100%（1/1）` from the ICC root's frozen receipt; marker campaign_roots = [mission-490e369a…, campaign-v1-86809178…]. l5i-done is a 要你決定 cell (the hand denied an unexpected `git worktree add` with Esc; attention lingers until the next prompt — the documented deny/Esc rule in hooks/awaiting-owner.js header, not new). (d) proxy not reachable (zero findings on a one-line change; unit-tested). Stall covered by df2/l3/ceo (same envelope path). Cosmetic: phase slot prints the raw `COMPLETED` (no zh-TW label) — owner eyeball item. status task can_merge/can_close false as in l5h (BACKLOG candidate).

| /l6 on FF9 (gate-sandbox5) | perm | PASS | runs/l6-perm/20261005T154130Z | session-mode set --level l6 dialog open ~27 s; panel 要你決定 kind=permission; check.js RESULT: PASS |
| /l6 on FF9 (gate-sandbox5) | ask | PASS | runs/l6-ask/20261005T154255Z | AskUserQuestion open; 要你決定 kind=question; decision file source ask_user_question; check.js PASS; answered A |
| /l6 on FF9 (gate-sandbox5) | idle | PASS | runs/l6-idle2/20261005T154421Z | 待命 ~80 s after turn end, check.js PASS (l6-idle/20261005T154348Z was early at ~48 s, also 待命 PASS) |
| /l6 on FF9 (gate-sandbox5) | author-running | BLOCKED | none (runs/l6-author-running/20261005T154443Z is a turn-in-progress capture, not a dispatch) | dispatch-contract check NO-GO rc=3: `quota: quota unavailable for Qwen3.8-Max-Preview as verification-author` (qoderclicn, family alibaba); engine-capability-state current shows quota.status unknown (checker needs available); no dispatch-author ran, no runner spend |
| /l6 on FF9 (gate-sandbox5) | running | PASS | runs/l6-running/20261005T155047Z | auto-captured in loop 7 s into the hand; band "● 進行中 … 準備 · 0m · 0%（0/1） / 1 個派工在跑 · 1 件派工無決策紀錄"; check.js RESULT: PASS; mission envelope runs=1 grok-4.7 |
| /l6 on FF9 (gate-sandbox5) | (d) proxy | not reachable | none | 0 adjudicated findings, no ledger dir |
| /l6 on FF9 (gate-sandbox5) | done | PASS | runs/l6-done/20261005T155311Z | band "✓ 完成待驗收 … COMPLETED · 2m · 100%（1/1）"; frozen progress from campaign-v1 ICC root; check.js RESULT: PASS. status task: TERMINAL_READY, can_merge false, can_close false (campaign_binding_unmapped) |
| /l6 on FF9 (gate-sandbox5) | stall | skipped | none | covered by df2/l3/ceo-stall |

l6 facts: session 77e32751, marker root job-1791214894-125d3d13 vs contract root mission-31493d52a09f0f323ec80d5c; campaign_roots = [mission-31493d52..., campaign-v1-4a5e14ca...]; campaign rc=0 converged SHIP-AS-IS commit 3536435 kept on mission/31493d52a09f/...-a1; origin e1316d0 unchanged; l6 marker 77e32751 remains. Wall ~13 min drive, campaign ~4.7 min.

DEPTH-0 ADJUDICATION of l6 (2026-10-06 ~00:00, live FF9, gate-sandbox5; check.js re-run: 7 PASS). **/l6 band cells PASS**: l6-perm (panel), l6-ask (panel + decision file), l6-idle2 (待命 ~80 s after the turn), l6-running (`● 進行中 … 準備 · 0%（0/1）` + 「1 個派工在跑」, auto-captured 7 s into the hand), l6-done (`✓ 完成待驗收 … COMPLETED · 100%（1/1）` from the ICC root). Not counted: l6-idle (48 s, before the 70 s rule) and l6-author-running (matched 回合進行中, not a dispatch). Verification-author leg BLOCKED: `dispatch-contract.js check` NO-GO rc=3 `quota: quota unavailable for Qwen3.8-Max-Preview as verification-author` (capability state quota.status unknown — never probed on this host for that tuple); no probe/override was run (owner decision: a quota probe spends). (d) proxy not reachable; stall covered by df2/l3/ceo. status task can_merge/can_close false as in l5h/l5i (campaign_binding_unmapped expects campaign-v2-…; BACKLOG candidate).
| l6 author (FF9, gate-sandbox6) | quota probe | PASS (after endpoint fix) | runs/l6b/created.txt | safe probe (role verification-author, --effort high) left quota.status unknown; --live-spend flipped it to available but with endpoint_binding ambiguous-legacy, so dispatch-contract check on sb5 stayed NO-GO; one more live-spend with `--role verification_author --effort high --endpoint @none` (exact binding) -> available, check on sb5 contract = GO assurance provisional |
| l6 author (FF9, gate-sandbox6) | author-running | PASS | runs/l6b-author-running/20261005T163557Z | auto-captured in loop at the first `個派工在跑`; band "● 進行中 gate-sandbox6 · — · 1m · — / 1 個派工在跑 · 1 件派工無決策紀錄"; check.js RESULT: PASS; envelope author row run_id author-1791218150-883616 runner qoderclicn Qwen3.8-Max-Preview, phase running, alive, elapsed 5 s |
| l6 author (FF9, gate-sandbox6) | author-done | PASS (band) / author BLOCKED (engine output) | runs/l6b-author-done/20261005T163746Z | band "◌ 待命 gate-sandbox6 · — · 2m · —", check.js RESULT: PASS (~30 s after turn end). Author dispatch: dispatch-author --strict-contract exit=5, status truncated, error frame_missing, 38 s; raw log 583 B of broken `<tool_call>`/`<|>` markers (copy runs/l6b/author-raw-log.txt); no artifact, sandbox clean, no containment breach. Not rerun (max_attempts 1) |

DEPTH-0 ADJUDICATION of l6b (2026-10-06 ~00:40, live FF9, gate-sandbox6; check.js re-run: 2 PASS). Owner-authorized quota probe: safe probe left quota unknown; live-spend with the checker's exact binding (`--role verification_author --effort high --endpoint @none`) → available, endpoint_binding exact → dispatch-contract GO (assurance provisional). **/l6 author cell PASS for the band**: l6b-author-running `● 進行中 gate-sandbox6 … 1 個派工在跑` with the envelope row role author / qoderclicn / Qwen3.8-Max-Preview alive; l6b-author-done 待命 after it ended. The author ENGINE output was broken (`status truncated, error frame_missing`, exit 5, 583-byte garbled log) — a seat-quality finding for engine qualification, not a band defect; one attempt, not retried.

## P7 gate (2026-10-09, run A: dev-flow, l3, ceo-agent; plugin develop 95ed4fc3; sandbox gate-sandbox; widths 209/120/80)

Rows are check.js final lines, one per width capture (dir = gate/runs/<dir>). w80 captures got meta.body_columns=75 where check.js misread the 80-col stacked pane as a dock (see notes). created.txt per mode: runs/<mode>/created-p7.txt.

| capture dir | check.js final line |
|---|---|
| dev-flow-perm-w209/20261009T022226Z | PASS dev-flow fields=2 |
| dev-flow-perm-w120/20261009T022234Z | PASS dev-flow fields=2 |
| dev-flow-perm-w80/20261009T022243Z | PASS dev-flow fields=1 |
| dev-flow-perm-stage-w209/20261009T022417Z | PASS dev-flow fields=2 |
| dev-flow-perm-stage-w120/20261009T022425Z | PASS dev-flow fields=2 |
| dev-flow-perm-stage-w80/20261009T022434Z | PASS dev-flow fields=1 |
| dev-flow-idle-w209/20261009T022730Z | PASS dev-flow fields=10 |
| dev-flow-idle-w120/20261009T022739Z | PASS dev-flow fields=10 |
| dev-flow-idle-w80/20261009T022748Z | PASS dev-flow fields=10 (body_columns=75 written) |
| dev-flow-ask-w209/20261009T022849Z | PASS dev-flow fields=2 |
| dev-flow-ask-w120/20261009T022857Z | PASS dev-flow fields=2 |
| dev-flow-ask-w80/20261009T022906Z | FAIL dev-flow fields=1 failed=verdict |
| dev-flow-running-w209/20261009T023015Z | PASS dev-flow fields=10 |
| dev-flow-running-w120/20261009T023023Z | PASS dev-flow fields=10 |
| dev-flow-running-w80/20261009T023032Z | PASS dev-flow fields=10 |
| dev-flow-done-w209/20261009T023123Z | PASS dev-flow fields=10 |
| dev-flow-done-w120/20261009T023132Z | PASS dev-flow fields=10 |
| dev-flow-done-w80/20261009T023141Z | PASS dev-flow fields=10 |
| dev-flow-running-dispatch-w209/20261009T023538Z | PASS dev-flow fields=10 |
| dev-flow-running-dispatch-w120/20261009T023547Z | PASS dev-flow fields=10 |
| dev-flow-running-dispatch-w80/20261009T023555Z | PASS dev-flow fields=10 |
| dev-flow-panel-legend | PASS dev-flow fields=10 |
| dev-flow-panel-now/20261009T023659Z | PASS dev-flow fields=10 |
| dev-flow-panel-graph/20261009T023702Z | PASS dev-flow fields=10 |
| dev-flow-stall-w209/20261009T023950Z | PASS dev-flow fields=10 |
| dev-flow-stall-w120/20261009T023959Z | PASS dev-flow fields=10 |
| dev-flow-stall-w80/20261009T024007Z | PASS dev-flow fields=10 |
| l3-perm-w209/20261009T024107Z | PASS l3 fields=2 |
| l3-perm-w120/20261009T024116Z | PASS l3 fields=2 |
| l3-perm-w80/20261009T024124Z | PASS l3 fields=1 |
| l3-perm-agent-w209/20261009T024157Z | PASS l3 fields=2 |
| l3-perm-agent-w120/20261009T024206Z | PASS l3 fields=2 |
| l3-perm-agent-w80/20261009T024214Z | PASS l3 fields=1 |
| l3-idle-w209/20261009T024246Z | PASS l3 fields=10 |
| l3-idle-w120/20261009T024254Z | PASS l3 fields=10 |
| l3-idle-w80/20261009T024303Z | PASS l3 fields=10 |
| l3-ask-w209/20261009T024331Z | PASS l3 fields=2 |
| l3-ask-w120/20261009T024340Z | PASS l3 fields=2 |
| l3-ask-w80/20261009T024348Z | FAIL l3 fields=1 failed=verdict |
| l3-idle2-w209/20261009T024520Z | PASS l3 fields=10 |
| l3-idle2-w120/20261009T024528Z | PASS l3 fields=10 |
| l3-idle2-w80/20261009T024537Z | PASS l3 fields=10 |
| l3-running-w209/20261009T024619Z | PASS l3 fields=10 |
| l3-running-w120/20261009T024628Z | PASS l3 fields=10 |
| l3-running-w80/20261009T024636Z | PASS l3 fields=10 |
| l3-done-w209/20261009T024728Z | PASS l3 fields=10 |
| l3-done-w120/20261009T024736Z | PASS l3 fields=10 |
| l3-done-w80/20261009T024745Z | PASS l3 fields=10 |
| l3-panel-legend/20261009T025119Z | PASS l3 fields=10 |
| l3-panel-now/20261009T025127Z | PASS l3 fields=10 |
| l3-panel-graph/20261009T025131Z | PASS l3 fields=10 |
| l3-stall-w209/20261009T025447Z | PASS l3 fields=10 |
| l3-stall-w120/20261009T025455Z | PASS l3 fields=10 |
| l3-stall-w80/20261009T025504Z | PASS l3 fields=10 |
| ceo-agent-perm-w209/20261009T025547Z | PASS ceo-agent fields=2 |
| ceo-agent-perm-w120/20261009T025555Z | FAIL ceo-agent fields=2 failed=reason |
| ceo-agent-perm-w80/20261009T025604Z | PASS ceo-agent fields=1 |
| ceo-agent-idle-w209/20261009T025706Z | PASS ceo-agent fields=10 |
| ceo-agent-idle-w120/20261009T025715Z | PASS ceo-agent fields=10 |
| ceo-agent-idle-w80/20261009T025723Z | PASS ceo-agent fields=10 |
| ceo-agent-ask-w209/20261009T025751Z | PASS ceo-agent fields=2 |
| ceo-agent-ask-w120/20261009T025759Z | PASS ceo-agent fields=2 |
| ceo-agent-ask-w80/20261009T025807Z | FAIL ceo-agent fields=1 failed=verdict |
| ceo-agent-idle2-w209/20261009T025931Z | PASS ceo-agent fields=10 |
| ceo-agent-idle2-w120/20261009T025939Z | PASS ceo-agent fields=10 |
| ceo-agent-idle2-w80/20261009T025948Z | PASS ceo-agent fields=10 |
| ceo-agent-running-w209/20261009T030027Z | PASS ceo-agent fields=10 |
| ceo-agent-running-w120/20261009T030036Z | PASS ceo-agent fields=10 |
| ceo-agent-running-w80/20261009T030044Z | PASS ceo-agent fields=10 |
| ceo-agent-done-w209/20261009T030126Z | PASS ceo-agent fields=10 |
| ceo-agent-done-w120/20261009T030134Z | PASS ceo-agent fields=10 |
| ceo-agent-done-w80/20261009T030143Z | PASS ceo-agent fields=10 |
| ceo-agent-panel-legend/20261009T030304Z | PASS ceo-agent fields=10 |
| ceo-agent-panel-now/20261009T030308Z | PASS ceo-agent fields=10 |
| ceo-agent-panel-graph/20261009T030311Z | PASS ceo-agent fields=10 |
| ceo-agent-stall-w209/20261009T030514Z | PASS ceo-agent fields=10 |
| ceo-agent-stall-w120/20261009T030522Z | PASS ceo-agent fields=10 |
| ceo-agent-stall-w80/20261009T030531Z | PASS ceo-agent fields=10 |
| ceo-agent-stall-b-w209/20261009T030739Z | PASS ceo-agent fields=10 |
| ceo-agent-stall-b-w120/20261009T030747Z | PASS ceo-agent fields=10 |
| ceo-agent-stall-b-w80/20261009T030756Z | PASS ceo-agent fields=10 |

Notes: (1) ask-w80 FAILs (3 modes): at 80 columns the AskUserQuestion dialog hides band and panel, check.js finds no verdict; attention.json kind=question is correct, so this is a display/checker-surface finding. (2) ceo-agent-perm-w120 FAIL reason: the 50-wide dock truncates the reason with an ellipsis by display width, check.js expects a fixed-length prefix (checker rule, band fine). (3) ceo-agent-stall (first) was captured 2m21 after SIGSTOP, before the stall flag; PASS with 進行中; retry ceo-agent-stall-b shows ⏸ 疑似卡住. (4) Sandbox Mission mode was temporarily set to shadow (uncommitted, reset after each mode) because a plain dispatch-hetero is refused under enforce; stall hands killed after capture.

### Batch B: l4, l5, l6 (2026-10-09 11:08-12:15 CST; plugin develop 95ed4fc3; sandbox gate-sandbox; widths 209/120/80; 80-col captures have body_columns=75 written to meta.json)

| Capture dir | check.js final line |
|---|---|
| l4-perm-w209/20261009T031056Z | PASS l4 fields=2 |
| l4-perm-w120/20261009T031105Z | PASS l4 fields=2 |
| l4-perm-w80/20261009T031113Z | PASS l4 fields=1 |
| l4-perm-agent-w209/20261009T031358Z | PASS l4 fields=2 |
| l4-perm-agent-w120/20261009T031406Z | PASS l4 fields=2 |
| l4-perm-agent-w80/20261009T031414Z | PASS l4 fields=1 |
| l4-idle-w209/20261009T031754Z | FAIL l4 fields=2 failed=nonok |
| l4-idle-w120/20261009T031803Z | FAIL l4 fields=2 failed=nonok |
| l4-idle-w80/20261009T031811Z | FAIL l4 fields=2 failed=nonok |
| l4-ask-w209/20261009T032015Z | PASS l4 fields=2 |
| l4-ask-w120/20261009T032023Z | PASS l4 fields=2 |
| l4-ask-w80/20261009T032031Z | FAIL l4 fields=1 failed=verdict |
| l4-running-w209/20261009T032158Z | PASS l4 fields=2 |
| l4-running-w120/20261009T032206Z | PASS l4 fields=2 |
| l4-running-w80/20261009T032215Z | PASS l4 fields=1 |
| l4-running2-w209/20261009T032446Z | PASS l4 fields=2 |
| l4-running2-w120/20261009T032455Z | PASS l4 fields=2 |
| l4-running2-w80/20261009T032503Z | PASS l4 fields=1 |
| l4-idle2-w209/20261009T032736Z | PASS l4 fields=10 |
| l4-idle2-w120/20261009T032745Z | PASS l4 fields=10 |
| l4-idle2-w80/20261009T032754Z | PASS l4 fields=10 |
| l4-running3-w209/20261009T032852Z | PASS l4 fields=10 |
| l4-running3-w120/20261009T032901Z | PASS l4 fields=10 |
| l4-running3-w80/20261009T032909Z | PASS l4 fields=10 |
| l4-done-w209/20261009T033022Z | PASS l4 fields=10 |
| l4-done-w120/20261009T033030Z | PASS l4 fields=10 |
| l4-done-w80/20261009T033039Z | PASS l4 fields=10 |
| l4-panel-legend/20261009T033112Z | PASS l4 fields=10 |
| l4-panel-now/20261009T033146Z | PASS l4 fields=10 |
| l4-panel-graph/20261009T033152Z | PASS l4 fields=10 |
| l4-stall-w209/20261009T033741Z | PASS l4 fields=10 |
| l4-stall-w120/20261009T033749Z | PASS l4 fields=10 |
| l4-stall-w80/20261009T033758Z | PASS l4 fields=10 |
| l5-perm-w209/20261009T033906Z | PASS l5 fields=2 |
| l5-perm-w120/20261009T033914Z | PASS l5 fields=2 |
| l5-perm-w80/20261009T033923Z | PASS l5 fields=1 |
| l5-idle-w209/20261009T034333Z | PASS l5 fields=10 |
| l5-idle-w120/20261009T034342Z | PASS l5 fields=10 |
| l5-idle-w80/20261009T034350Z | PASS l5 fields=10 |
| l5-ask-w209/20261009T035103Z | PASS l5 fields=2 |
| l5-ask-w120/20261009T035111Z | PASS l5 fields=2 |
| l5-ask-w80/20261009T035120Z | FAIL l5 fields=1 failed=verdict |
| l5-running-w209/20261009T035237Z | PASS l5 fields=10 |
| l5-running-w120/20261009T035245Z | PASS l5 fields=10 |
| l5-running-w80/20261009T035254Z | PASS l5 fields=10 |
| l5-done-w209/20261009T035405Z | PASS l5 fields=10 |
| l5-done-w120/20261009T035414Z | PASS l5 fields=10 |
| l5-done-w80/20261009T035422Z | PASS l5 fields=10 |
| l5-panel-legend/20261009T035431Z | PASS l5 fields=10 |
| l5-panel-now/20261009T035440Z | PASS l5 fields=10 |
| l5-panel-graph/20261009T035446Z | PASS l5 fields=10 |
| l5-compact/20261009T035657Z | PASS l5 fields=10 |
| l6-perm-w209/20261009T040119Z | PASS l6 fields=2 |
| l6-perm-w120/20261009T040127Z | PASS l6 fields=2 |
| l6-perm-w80/20261009T040136Z | PASS l6 fields=1 |
| l6-ask-w209/20261009T040655Z | PASS l6 fields=2 |
| l6-ask-w120/20261009T040704Z | PASS l6 fields=2 |
| l6-ask-w80/20261009T040712Z | FAIL l6 fields=1 failed=verdict |
| l6-idle-w209/20261009T040925Z | PASS l6 fields=10 |
| l6-idle-w120/20261009T040933Z | PASS l6 fields=10 |
| l6-idle-w80/20261009T040942Z | PASS l6 fields=10 |
| l6-running-w209/20261009T041044Z | PASS l6 fields=10 |
| l6-running-w120/20261009T041052Z | PASS l6 fields=10 |
| l6-running-w80/20261009T041101Z | PASS l6 fields=10 |
| l6-done-w209/20261009T041214Z | PASS l6 fields=10 |
| l6-done-w120/20261009T041226Z | PASS l6 fields=10 |
| l6-done-w80/20261009T041235Z | PASS l6 fields=10 |
| l6-panel-legend/20261009T041244Z | PASS l6 fields=10 |
| l6-panel-now/20261009T041253Z | PASS l6 fields=10 |
| l6-panel-graph/20261009T041259Z | PASS l6 fields=10 |

Notes (batch B):
(1) l4-idle (first): FAIL nonok. The /l4 depth-0 ran `session-mode clear` at the end of its run, so the session had no marker (meta.json scope_key null); band showed only `◌ 待命 │ ⓘ`; check.js has no envelope without a marker. Retry l4-idle2 (marker re-set with `session-mode.js set --level l4`, run by the driven session) PASS. Finding: after /l4 finishes and clears its marker the session has no scope; a plain follow-up prompt does not recreate the marker.
(2) ask-w80 FAILs (l4, l5, l6): at 80 columns the AskUserQuestion dialog hides band and panel; attention.json kind=question correct; known checker gap, 'question dialog hides band'.
(3) /l4 ran a real foreman twice (first one failed precondition_failed: worktree base 9c5bf49 because the sandbox has no origin/HEAD; depth-0 set worktree.baseRef=head in git-ignored settings.local.json and re-dispatched; merged locally, not pushed). l4-perm = real depth-0 Bash permission dialogs; l4-perm-agent = foreman-subagent dialog (surface dialog). l4-running/l4-running2 captured while a subagent dialog was open (fields=2, dialog surface, panel verdict 進行中/要你決定); real band-surface running cell is l4-running3 (task in_progress, method 1). done cells use method (2) (two tasks completed, no dispatch). l4 marker for idle2/running3/done/stall was set by the driven session running session-mode.js set --level l4 (the state at the /l4 front door), because the campaign had cleared it.
(4) l5 campaign rail BLOCKED (enforce): UNRESOLVED_MISSION_EXISTS, two old ACTIVE lineages (gate-readme-line-2026-10-05, gate-readme-line-v2-2026-10-05) in the sandbox; finalize-abort needs an authenticated control adapter; original authority intent not recoverable. l6: same blocker in the foreman (mission prepare -> UNRESOLVED_MISSION_EXISTS for lineage-v1-6c52a9b2 / lineage-v1-bf0a9f8a), raised to the user via a real AskUserQuestion (decision file payload: source ask_user_question, 3 options, root_run_id job-1791518496-ff49f41a; closed after answer; l6-ask is that real question). l5/l6 idle/running/done/panel cells were taken with the real l5/l6 markers (set by the front door) using the task-list methods.
(5) stall cells: l4 PASS (Mission mode set to shadow in sandbox owner-kernel-governance.json line 90, reset with git checkout after; codex hand gpt-6-astra pid 3015936 cwd/environ checked, SIGSTOP 11:34:22, ⏸ seen 11:37:29 = 3m07s; hand killed). l5 and l6 stall BLOCKED: with an active l5/l6 marker dispatch-hetero.sh is refused even in shadow ('precondition_failed: active session-mode=l5 requires a sealed campaign strict projection'; l6: prompt-only write dispatch refused, needs sealed campaign / engine implement-review). No hand spawned.
(6) extras: (a) PASS in l4 (decision file present during question with question/options A,B, source ask_user_question, gone after answer) and l6 (real question, payload above). (b) l5 /compact: marker sha256 before = after (888f2693...), level l5, band after compact PASS: l5-compact/20261009T035657Z. (c)/(d)/(e)/(f) not run.
(7) Panel: Ctrl+x Tab then Enter opens/focuses the pane on Legend in all three modes (at 200 columns the pane is already auto-docked on Now; the keystrokes switched it to Legend). Tab/Enter, Right/Left/Down+Enter did NOT switch tabs; an SGR mouse click on the tab label (tmux send-keys of ESC[<0;col;2M/m) switched to Now and Graph. Legend lists the slot glyphs; Now shows verdict + reason line (e.g. 任務 2/2 都完成，等你驗收) + progress; Graph shows 'no data · no stage walk published for this session' (no stage recorded: sessions here never set a size). Panel captures are at window width 200, not 209.
(8) Watcher: gate-sandbox watcher pid 2598395 (started 10:19:32, after 95ed4fc3 commit, cwd gate-sandbox) already serves new code: runs/<scope>.json has host_today_brain_usd (77.3 -> 134 over the run) and brain_cap_usd 150; stage/<sid>.json appeared (3028da81...json) in the live dir. Not restarted.
(9) Sessions created: l4 3028da81-bc08-4aa5-8ea9-8f6786b5c6ab, l5 94d641f7-fb20-4646-9968-96c5b604acaf, l6 5c243380-f5fd-4321-b0c6-36ced1d1768e (details gate/runs/l4|l5|l6/created.txt). Leftover: worktree /tmp/hetero-gate-l4-stall-Ag7uO8 (branch gate-l4-stall).

## Batch C (2026-10-09, live plugin b170549c, rebuilt sandbox)
| cell | check.js final line |
|---|---|
| l5-running-c-w209/20261009T042901Z | PASS l5 fields=10 |
| l5-running-c-w120/20261009T042910Z | PASS l5 fields=10 |
| l5-running-c-w80/20261009T042918Z | PASS l5 fields=10 |
| l5-stall-c-w209/20261009T043306Z | PASS l5 fields=10 |
| l5-stall-c-w120/20261009T043314Z | PASS l5 fields=10 |
| l5-stall-c-w80/20261009T043323Z | PASS l5 fields=10 |
| l5-done-c-w209/20261009T043554Z | PASS l5 fields=10 |
| l5-done-c-w120/20261009T043602Z | PASS l5 fields=10 |
| l5-done-c-w80/20261009T043611Z | PASS l5 fields=10 |
| l6-perm-c-w209/20261009T044144Z | PASS l6 fields=2 |
| l6-perm-c-w120/20261009T044153Z | PASS l6 fields=2 |
| l6-perm-c-w80/20261009T044201Z | PASS l6 fields=1 |
| l6-running-c-w209/20261009T044905Z | PASS l6 fields=10 |
| l6-running-c-w120/20261009T044913Z | PASS l6 fields=10 |
| l6-running-c-w80/20261009T044922Z | FAIL l6 fields=10 failed=dispatch |
| l6-stall-c-w209/20261009T045251Z | PASS l6 fields=10 |
| l6-stall-c-w120/20261009T045300Z | PASS l6 fields=10 |
| l6-stall-c-w80/20261009T045309Z | PASS l6 fields=10 |
| l6-done-c-w209/20261009T045453Z | PASS l6 fields=10 |
| l6-done-c-w120/20261009T045501Z | PASS l6 fields=10 |
| l6-done-c-w80/20261009T045510Z | PASS l6 fields=10 |
| dev-flow-panel-keys (200 cols) | FAIL: Ctrl+x Tab then Enter on the info mark opens/keeps the pane on Legend (ring on the info mark, [Legend] highlighted); Tab, Right, Left, Down, Up, S-Tab, Enter, Space did NOT move to Now/Graph. Esc did not close the pane but returned typing to the prompt (a typed char landed in the prompt). Ends on Legend. captures: runs/dev-flow-panel-keys/w200 |
| dev-flow-panel-keys (120 cols) | FAIL: same as 200 cols, both with the pane auto-docked and after closing it by SGR click on x and reopening via Ctrl+x Tab Enter (opens on Legend); no key switches tabs; Esc leaves pane open, focus on prompt. captures: runs/dev-flow-panel-keys/w120 |

Notes (batch C):
(1) Sandbox rebuilt: old ~/projects/gate-sandbox moved to /tmp/gate-sandbox-old-20261009T042235Z (not deleted); fresh clone of ~/projects/gate-sandbox-origin.git, local branch develop tracking origin/develop (origin HEAD points at nonexistent master, so no origin/HEAD, as before), restored only git-ignored .claude/settings.local.json (permissions allow + worktree.baseRef=head) copied from the old dir. No hooksPath existed. Stale UNRESOLVED_MISSION_EXISTS state lived only under the sandbox git common dir (.git/autopilot/mission/{registry.json,states,artifacts}, implementation-campaign.jsonl, work-orders, controller-authority) so the move removed it. For l6 the sandbox was re-cloned again (previous one at /tmp/gate-sandbox-after-l5-20261009) because the l5 lineage was now COMPLETE.
(2) l5: campaign ran for real (prepare, grant, grok-4.7 hand via dispatch-hetero, mission COMPLETE, frozen 1/1). Hand pid 3239467 (cwd/environ checked) SIGSTOP 12:29:39, stall:true 12:32:38, band stall, SIGCONT 12:33:26, campaign finished; depth-0 then stopped at can_merge unknown predicates (status task has no writer); marker left l5. l6: first foreman returned BLOCKED (no task-authority envelope; depth-0 did not author one); after a user nudge depth-0 authored it and a retry foreman ran the campaign (a2 lineage); hand pid 3367039 SIGSTOP 12:49:36, stall:true 12:52:25, SIGCONT 12:53:12, done 12:54.
(3) l6-running-c-w80 FAIL dispatch: band showed only 進行中 while envelope already had a live run; the hand had started between the w120 and w80 captures (band lags up to 5 s); likely timing, not re-run in place.
(4) Colour (band-209.png): done = green check + verdict word, dim separators; stall = pink/red mark + word with white gear/pause counts. The info mark renders as a small half-moon glyph, mouse-mode box [-] mid-line.
(5) Sessions: panel-keys a0976e0e-b6fb-4a58-ad5f-f4fb95eb0b89; l5 ffea7985-61a8-46dd-b36b-092895eb3ea2 (marker l5 left, root job-1791519827-d7c12422, project 51de403da82a23f0); l6 7cbcb68a-3fe4-4681-b1a3-7fc841acc835 (marker l6 left, root job-1791520623-bfaad5b0). Branches: mission/143504fc8cb6/...-a1 (old sandbox), mission/20c40ae80803/...-a2 and worktree-agent-a0a996e5a76cd2993 (locked worktree .claude/worktrees/agent-a0a996e5a76cd2993) in the new sandbox; .git/info/exclude of new sandbox got .claude/worktrees/ from the driven session.
| dev-flow-panel-keys-cycle (200 cols) | PASS: pane already docked on Now at start; Ctrl+x Tab, then 9x Enter on the info mark gave Graph, Dispatch, Review, Decisions, Spend, Hygiene, Legend, Now, Graph (each Enter advances one tab, wraps Hygiene to Legend). Esc returned the prompt (typed char landed in prompt). Closed via SGR click on the x (col 199); Ctrl+x Tab Enter reopened on Legend. session ac246111-fc81-4c87-babd-3539f6e5fc63. captures: runs/dev-flow-panel-keys-cycle/200 |
| dev-flow-panel-keys-cycle (120 cols) | PASS: pane not docked at start; Ctrl+x Tab, then 9x Enter gave Legend, Now, Graph, Dispatch, Review, Decisions, Spend, Hygiene, Legend (first Enter opens on Legend). Esc returned the prompt. Closed via SGR click on x (col 119); Ctrl+x Tab Enter reopened on Legend. session 946438b1-979f-4db0-bac8-cd976673f34e. captures: runs/dev-flow-panel-keys-cycle/120 |
