# Driving notes - dev-flow pilot (2026-10-05, agent-driven)

Mechanics that worked
- `env -i ... tmux -L gate new-session -d -s df -x 200 -y 50 -c ~/projects/gate-sandbox`, then send-keys -l of the launch line + separate Enter. First launch shows the trust dialog (default "No, exit"): Down, Enter. Band is a right-hand side panel plus a bottom row ("◌ 待命 gate-sandbox · ..."); 200x50 is enough.
- New session id: diff `ls ~/.autopilot/session-mode` before/after launch (use `LC_ALL=C sort` on both sides or comm complains). Pass it as capture.sh arg 3; `GATE_TMUX_SOCKET=gate` for capture.sh. Captures land in gate/runs/<cell>/<ts>/ (not runs/<mode>/).
- Helpers I used (in /tmp, recreate): type = `send-keys -l "$1"; sleep .5; send-keys Enter`; a wait loop that polls capture-pane for "Do you want" / the band word. Permission dialogs: send `1` + Enter (option numbers appear in the dialog; the "don't ask again" option is exact-command only).

What tripped
1. TARGET AMBIGUITY: with two sessions (`df`, `c`), `-t c` sent keys to `df` (the launch line landed as a prompt in the dev-flow session). Always address `-t <name>:` (or `'=name'` quoted - bare `=c` is zsh-expanded) and never rely on a default target in helper scripts (a stray `x` also went to df that way). Cost: two junk turns in the df session, harmless to the cells.
2. Bash tool in the driven session blocks bare foreground `sleep N` (hook); a `for ...; do sleep` loop passes but needs approval ("variable can't be checked"). Pre-approve with option 2 ("don't ask again") on an exact command; the rule is exact-string, so reuse the literal command (I used /tmp/slow.sh).
3. FINDING: permission dialog / AskUserQuestion dialog covers the bottom band row; capture.sh finds no `▲ 要你決定` line, so check.js FAILs with "no band found" although the top-right panel shows the verdict + reason. Either the capture must also look in the side panel or the band must stay visible.
4. FINDING: after approving a permission, attention stays open until the tool call finishes; band says 要你決定 for a 72 s run. To get 進行中, use a live dispatch run (band 進行中) rather than a long Bash.
5. FINDING: task in_progress + no run -> band 待命 (check.js expects 進行中).
6. FINDING: live run + all tasks complete -> band 進行中, check.js expects 完成待驗收 (it ranks completion first).
7. Stall cell: a codex hand narrates ~every 3 min and the watcher probe refreshes the run only every few minutes, so stall:true never appeared in 7 min of `sleep 420`. A genuinely silent hand/runner (or a manifest with an old log mtime) is needed. dispatch-hetero: `--model gpt-5.5-codex` is rejected on this ChatGPT account (400); ~/.codex/config.toml default is gpt-6-astra. The hand then exits 0 with no commit -> hetero reports no_op/exit 1 (expected; leaves a worktree + branch gate-stallN in gate-sandbox).
8. Runbook (c) literal `diff` of ps output is never empty (etimes column); compare PIDs.
9. The driven session did a `find /` on its own when told to use dispatch-hetero: give it the absolute script path up front.
10. Wait loops over ~120 s in my own Bash tool get backgrounded; keep loops < 110 s or use until-loops under Monitor.

Band lines of each capture (eyeballed; band.txt)
### df-ask/20261005T074954Z
### df-author/20261005T081017Z
✓ 完成待驗收 gate-sandbox · — · 22m · 2 done*                                                             [-] │
任務 2/2 都完成，等你驗收 · 4 件派工無決策紀錄                                                                │
### df-done/20261005T074936Z
✓ 完成待驗收 gate-sandbox · — · 2m · 2 done*                                                              [-] │
任務 2/2 都完成，等你驗收                                                                                     │
### df-idle/20261005T074259Z
◌ 待命 gate-sandbox · — · 1m · —                                                                          [-] │
沒有派工在跑 · 停在等你指示 0 分                                                                              │
### df-perm/20261005T074335Z
### df-running/20261005T074449Z
▲ 要你決定 gate-sandbox · — · 3m · —                                                                      [-] │
等你批准：Bash: for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo tick $i; sleep 6; done（等了 0 分）              │
### df-running-2/20261005T074757Z
◌ 待命 gate-sandbox · — · 0m · 0 done*                                                                    [-] │
沒有派工在跑                                                                                                  │
### df-running-3/20261005T075221Z
● 進行中 gate-sandbox · — · 4m · 2 done*                                                                  [-] │
1 個派工在跑 · 2 件派工無決策紀錄                                                                             │
### df-stall/20261005T080531Z
● 進行中 gate-sandbox · — · 17m · 2 done*                                                                 [-] │
1 個派工在跑 · 3 件派工無決策紀錄                                                                             │

df-perm / df-ask (band.txt empty) - top-right panel text instead:
  要你決定 / 等你批准：Bash: touch /tmp/gate-perm-test（等了 0 分）
  要你決定 / 等你回答：請選擇 A 還是 B？（等了 0 分）
Readability: all lines readable at 200 cols; the side panel truncates long run lines with an ellipsis.
