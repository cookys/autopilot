# 2026-09-29 dispatch-hetero wall-timeout watchdog — evidence

管線形狀：implement foreman 一支背景 sonnet 工頭 + cursor grok hands r1–r6（每輪一個 hand brief、
一次 dispatch-review），landing foreman 跑兩次(wdog / wdog-r6)。`hand-1*.md` 是六輪 hand brief，
`review-1..4` 是 implement 側逐輪 review，`review-5` 是第一次 landing review，`review-6` 是 r6
implement review，`review-7` 是 r6 landing review(最終過關那份)。`REPORT-foreman.md` /
`REPORT-land.md` 是兩支工頭各自收尾的 REPORT。

depth-0 事前檢查：`run_worker` 對任何 rail 都沒有時間上限——只有 agy 自己 CLI 內建的計時有效，
其他 rail(codex/grok/cc-shim/pi/qoderclicn/cursor)完全無界,一個卡住的 worker 可以無限期佔用
worktree/lock。

operator 決策：明訂上限才執行——`--timeout` 從「接受但不生效」改為「除非帶了 `--timeout` 或落在
contract wall 內，否則不強制」,裸預設 9m 仍不強制,central `run_worker` watchdog 統一做
TERM → 10s grace → KILL(對 worker 的 session/scope 動手,不是任意子行程)。

各輪 review/proof 抓到什麼：
- **detached-path 漏裝**：round 3 的 stub 套件全綠,但真實 dispatch 都走 detached child,其
  `declare -f` 序列化清單漏了 `normalize_timeout_seconds`,watchdog 從未被裝上。brief 規定的
  real-rail proof(`--timeout 20s`,叫 agent `sleep 300`)實測跑了 322 秒才把這個洞抓出來——
  stub 套件本身從未走過會被漏裝的那條路,證明的是 stub,不是產線(見
  `references/evidence-discipline.md` §48)。
- **bare-pid fallback**：landing 側第一次(`wdog`)逐輪 review 放行的一個 hunk,combined review
  在 byte-identical 的 diff 上找出 🟠(group-kill 失敗時退回 bare-pid,可能打到已死或被回收的
  pid,而不是真的 worker)——同一段程式碼,per-row 判過,combined 才抓到(§43)。

r6 squash 的 targeted-rerun 決策：r5 squash 已經跑過一次完整 `hooks/tests/run.sh --parallel 8`
且全綠,r6 只窄化一個函式,depth-0 授權改跑 targeted 7-suite + 3-gate 重測而非整套重跑;
`migrate-backlog-entries.test.sh` 因為讀真實 `docs/BACKLOG.md`(這次有動一筆行)不在 targeted
清單裡,補跑一次單獨驗證在最終推上去的 SHA `27b2e583` 上綠燈。

BACKLOG follow-ups：刪掉舊的「`--timeout` 被接受記錄但沒對 grok rail 生效」row 及其 sidecar
(已被這次修掉),新增 `docs/backlog/dispatch-hetero-watchdog-followups.md`,收斂 combined review
另外抓到的 5 項待辦(與本次修的重疊部分已排除,共 10 項候選收斂)。
