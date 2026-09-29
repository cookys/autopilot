# 2026-09-29 dispatch-hetero watchdog follow-ups (v2.36.104) — landing evidence

管線形狀：implement foreman 一支背景 sonnet 工頭 + cursor grok hands（R1–R5，R2 與 R3 各有一次 repair），
再由 landing foreman 做四輪 combined review（`review-land-1..4`）；implement 側逐 hand 的 review 是 `review-impl-*`。
每支 hand 的 dispatch 都回報 status failure「wall timeout 2400s」，但 worktree 裡有已驗證的 commit；
depth-0 自己在 hand worktree 跑 suite，驗過 red-at-base / green-at-head，沒有採信 hand 的 green。

探測與結果：v2.36.101 watchdog 的 alive-check 在 `ps` 不可用時把「無法證明活著」當成「已死」，
watchdog 靜默退出、run 無界、manifest 仍寫 `timeout_enforced: true`。sidecar 第 4、7 項經核對為非缺陷，未列入 BACKLOG。

combined review 抓到而逐 row review 漏掉的：同一個 fail-open 缺陷連抓三輪——round 1 是 `ps` 不可用時 watchdog 退出；
round 2 是 SCOPE_UNIT 分支在 fallback pgid 為空時同樣退出；round 3 是 `WORKER_RP` 與 fallback 都為空時同樣退出。
三次逐形狀修補沒有收斂；operator 改採單一規則重寫（「只有被正向證明已死才算死，其餘一律當活著」），round 4 SHIP-AS-IS。
教訓：逐 row review 無法取代 combined review（§43），逐形狀修 fail-open 也不收斂（§49）。

BACKLOG：review 的 🔵/🟡 殘留另開一列「dispatch-hetero watchdog round-2 cleanups」，細節在
`docs/backlog/dispatch-hetero-watchdog-round2-cleanups.md`。

備註：v2.36.104 release commit 的 trailer 審查編號 `axDOqP` 是 raw_log 路徑尾碼（manifest 沒有 run-id 欄位）——已知的格式不一致，非缺陷。
