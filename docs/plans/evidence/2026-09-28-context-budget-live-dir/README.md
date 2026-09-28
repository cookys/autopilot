# v2.36.100 — context-budget live-dir fix, evidence

Pipeline：implement foreman 派 cursor-grok hands 跑三輪（r1 群組位放太寬 → r2 SHIP-AS-IS 但整包複審打回 →
r3 depth-0 給父目錄規則的 repair），再由 landing foreman 跑兩輪 combined review（第一輪對
`89ba821b`+`8edb870e` 整包複審抓到 🔴，第二輪對加了 `e3e5c46c` 的三個 commit 整包複審 SHIP-AS-IS 後放行）。

depth-0 的 pre-check：落地前先確認真實 `/run/user/1000/autopilot` 的實際權限是 0775、父目錄 `/run/user/1000`
是 0700 ——這個觀察後來被 r2 規則本身忽略掉了（規則寫成排除任何 other 位，觀察到的 0775 case 反而被自己的
規則擋下），直到 landing 整包複審才抓到。

整包複審抓到、per-row review 沒抓到的：r2 的真機驗證跑在已經被 r1 自己 chmod 成 0700 的目錄上，從沒測過一個
「新鮮」的 0775 目錄；per-row review 只看單一 commit 的 diff，看不出前一輪 proof 已經把狀態改掉，只有把三個
commit 疊起來一起看的 combined review 抓到「規則仍拒真實 0775」這個 🔴。

operator 決策：
- **雙邊修**——不只改 `resolveLiveDir()` 的規則本身，也把 `hooks-live-state-misc.test.sh` 裡被舊規則鎖住的
  row-132 pin 一併改掉（原本 brief 允許清單沒列到這個檔案，兩輪 review 都判定為 in-scope）。
- **只看父目錄**——candidate 自身的權限位不再是判斷依據，只要父目錄私有（自己所有、非連結、無 group/other
  位），candidate 帶什麼 group/other 位都 chmod 0700 後接受；父目錄不私有時維持拒絕。

開的 BACKLOG 列（both pre-existing reds, `docs/backlog/preexisting-reds-2026-09-28.md`）：
`engine-qualify-verdict-stability.test.sh`（D6 honest/parity grader-hash drift）、
`migrate-backlog-entries.test.sh`（真實 `docs/BACKLOG.md` 可遷移列數低於 ≥100 閘門）。

檔案：implementer 三輪 brief/hand/review（`implement-brief.md`／`repair-r3-brief.md`／`hand-1*.md`／
`review-1..3-impl-r*.json`／`REPORT-foreman.md`），landing 兩輪 brief/review（`land-brief.md`／
`review-4..5-land-r*.json`／`REPORT-land.md`），這份 closeout 本身的 brief（`closeout-brief.md`）。
