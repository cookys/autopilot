// P5a: the design's free text per step (gen.py S: reply rows, fixed warning rows, context rows), written out once; the glyph table's swaps are applied on read.
const SWAP: [string, string][] = [['▲', '⏶'], ['★', '✧'], ['⚠', '△'], ['▏', '_'], ['●', '◉']]
const sw = (s: string): string => SWAP.reduce((a, [x, y]) => a.split(x).join(y), s)
type Txt = { reply: string[]; pin: string[]; detail: string[] }
const RAW: Record<string, Txt> = {
  '1-N': { reply: ["待決 3 張要你選，另有 1 張要先動手做完再選。", "最舊的一張開了 3 小時：要不要把 tui 共用計畫合進 develop。", "按 2 到待決頁作答；按 o 展開這一段的清單。"], pin: [], detail: ["pm status 09:41 更新（1 分鐘前）。", "艦隊 12 條產線：執行 8、失敗 2、卡住 2。", "失敗：hangar 換池（3 輪）、docs 建置（1 輪）。", "本席 ctx 42%，本 session 240k tokens。", "QC 欠審 1 條；代理決策 4 條（今天）。"] },
  '1-E': { reply: ["✓ 目前沒有要你處理的事。", "3 條產線都在跑；最近一次失敗是昨天 22:10，已重跑通過。", "有新卡時底列會亮黃色「待決 N」。"], pin: [], detail: ["pm status 09:41 更新（1 分鐘前）。", "艦隊 3 條產線全部執行中，沒有失敗或卡住。", "本席 ctx 18%；QC 全過；代理決策 0 條。"] },
  '1-M': { reply: ["待決 12 張、動手 2 張，最舊的開了 2 天。", "失敗 7 條產線裡有 4 條是同一個原因：hangar 換池逾時。", "建議先到 2 待決處理最舊的 3 張，再到 3 派工看失敗的產線。"], pin: [], detail: ["失敗的產線（7）：", "  hangar 換池 · 3 輪逾時", "  docs 建置 · mdbook 版本不符", "  codeforge check-all · clippy 2 條", "  autopilot mods/live · 10 紅（基準同）", "  lab gate · private-leaks 1 條", "  alfred 部署 · 等 PM go", "卡住的產線（5）：", "  pinball 美術 · 等操作員選版", "  308 地圖 · 等素材", "  revival 物理 · 等 GPU slot", "  twgame 音效 · 等授權", "  mple2 回收 · 等驗收"] },
  '1-L': { reply: ["焦點：失敗的 hangar 換池。原因很長，全文在來龍去脈。", "已連續 3 輪逾時，每輪都停在同一步：等 NAS 回應。", "按 3 到派工頁看這條產線的每一輪。"], pin: [], detail: ["hangar 換池 · 失敗原因（第 3 輪）", "09:02 開始換池：team 帳號 → pool-b。", "09:03 備份設定檔，sha16 記錄完成。", "09:04 停 courier；等 4 個 session 到安全點。", "09:10 4 個 session 都回「可以」。", "09:11 改用同一台主機上既有的 token。", "09:12 重啟 courier，等 NAS 掛載點回應。", "09:22 逾時 600 秒：NAS 沒有回應 stat。", "09:22 自動回滾到 pool-a，回滾成功。", "09:23 第 3 輪結束，標失敗；下一輪排在 10:00。", "前兩輪同樣停在 09:12 那一步。", "判斷：NAS 掛載點的問題，跟換池腳本無關。", "建議：先查 NAS，再排第 4 輪。"] },
  '1-X': { reply: ["pm status 讀不到，艦隊數字改用 console（2 分鐘前）。", "本席與 QC 的即時資料讀不到，這兩格不顯示數字。", "待決與殘留照常，可以照常作答。"], pin: ["⊘ pm status 讀不到（連線逾時）→ 改用 console", "⊘ live 讀不到：本席、QC、代理決策"], detail: ["console 09:39 更新：產線 12，執行 8、失敗 2、卡住 2。"] },
  '1-S': { reply: ["艦隊和本席的數字是 12 分鐘前的，可能已經變了。", "待決卡是即時的，可以照常作答。"], pin: ["⚠ pm status 12 分鐘前（超過 5 分鐘算過時）", "⚠ console 12 分鐘前", "⚠ live 本席 12 分鐘前"], detail: ["艦隊 12 條產線：執行 8、失敗 2、卡住 2（09:29）。", "本席 ctx 42%（09:29）。"] },
  '1-X2': { reply: ["pm 和 console 都讀不到，艦隊只剩 fleetSummary 的 lane 忙閒。", "產線的失敗和停住的看不到；要看每個 agent 請到 7 艦隊。"], pin: ["⊘ pm status 讀不到", "⊘ console 讀不到 → 改用 fleetSummary"], detail: ["fleetSummary 09:40：lane 9，忙 5、閒 4。"] },
  '3-N': { reply: ["甲線 codex 正在改 console/gen.py，第 3 次 commit。", "預計 10 分鐘內交件，交件後本席審。"], pin: [], detail: ["run hetero-1795623455 · codex gpt-6.1 · effort high", "09:30 開始；分支 design/console-gen2", "已 commit 3 次；最後一次 09:41", "Fleet-Task 01M89Q2Z"] },
  '3-E': { reply: ["目前沒有在跑的派工。", "最近一輪：丁線 docs，09:10 完成。"], pin: [], detail: ["今天派工 6 輪：完成 5、失敗 1。"] },
  '3-M': { reply: ["乙線 claude 在修 mods/live 的 frameWrap 迴歸。", "已跑 8 分鐘，測試 10 紅與基準相同。"], pin: [], detail: ["run hetero-1795620011 · claude sonnet", "09:34 開始；分支 fix/framewrap"] },
  '3-L': { reply: ["✗ 丙線第 2 輪失敗：測試逾時後被 wrapper 收掉。", "原因全文在來龍去脈；最後是判斷。", "這一輪沒有 commit，worktree 保留著。"], pin: [], detail: ["丙線 hangar · run hetero-1795619800 · codex", "第 1 輪 08:40–09:02：通過 12/14，2 條 shellcheck。", "第 2 輪 09:05 開始，改 bin/pool-switch.sh。", "09:12 跑 tests/pool-switch.test.sh。", "09:14 測試停在「等 NAS stat」。", "09:24 測試逾時 600 秒。", "09:24 wrapper 送 SIGTERM，子程序 3 個沒有結束。", "09:25 wrapper 送 SIGKILL：rsync、stat、sleep。", "09:25 worktree 保留，沒有 commit。", "09:26 標失敗：timeout（不是測試紅）。", "判斷：NAS 掛載點沒有回應，跟程式碼無關。", "下一步：等 NAS 恢復後重派，不用改 brief。"] },
  '3-X': { reply: ["live.rows 讀不到，看不到每一輪。", "摘要改用 fleetSummary：lane 忙 5、閒 4。"], pin: ["⊘ live.rows 讀不到", "⊘ pm／console 讀不到 → 摘要改用 fleetSummary"], detail: ["fleetSummary 09:40：lane 9，忙 5、閒 4。"] },
  '3-S': { reply: ["派工清單是 15 分鐘前的；甲線可能已經交件。"], pin: ["⚠ live.rows 15 分鐘前（過時）", "⚠ pm 摘要 15 分鐘前"], detail: ["run hetero-1795623455 · codex", "09:26 的狀態：已 commit 2 次"] },
  '4-N': { reply: ["codeforge 7d1c：codex 第 2 輪 PASS，沒有 blocking。", "已 --no-ff 合進 develop；受保護檔案沒有被改。"], pin: [], detail: ["審查範圍 develop..7d1c（12 檔）。", "第 1 輪 3 blocking，全部修完。", "第 2 輪 0 blocking、2 note。"] },
  '4-E': { reply: ["今天還沒有審查紀錄，QC 也沒有欠審。"], pin: [], detail: ["昨天審查 5 次，全部 PASS。"] },
  '4-M': { reply: ["09:30 本席決定換池 team → pool-b（同一台主機既有的 token，不算新登入）。", "依據：standing go 2026-11-12；hangar 換池腳本執行。"], pin: [], detail: ["決策 id dl-0930；可回滾：pool-switch.sh --to pool-a。"] },
  '4-L': { reply: ["codex 第 2 輪 PASS；note 2 條和第 1 輪的 blocking 全文在來龍去脈。"], pin: [], detail: ["note 1｜src/cli/statusline.rs:212｜窄寬度時配額列會先截掉重置時間，", "        操作員看不到幾點重置；建議改成先截掉 fleet 那一段。", "note 2｜scripts/check-all.sh:88｜flake guard 重跑一次就算過，", "        同一條連續兩天都要重跑，應該登進 flaky 清單。", "第 1 輪 blocking 1｜CJK 專案名時切到半個字。", "第 1 輪 blocking 2｜quota 檔不存在時印出空白而不是「—」。", "第 1 輪 blocking 3｜80 欄時分隔線多一格。", "三條都修完，第 2 輪重看確認。", "審查席：codex gpt-6.1 · effort high"] },
  '4-X': { reply: ["審查、QC、代理決策都讀不到，無法判斷有沒有欠審。"], pin: ["⊘ live.review、qc、decisions 讀不到"], detail: ["上次讀到是 09:20。"] },
  '4-S': { reply: ["QC 是 20 分鐘前的；欠審那一條可能已經審完。"], pin: ["⚠ qc 20 分鐘前（過時）"], detail: ["hangar 5cab 在 09:21 進 QC 佇列。"] },
  '5-N': { reply: ["5h 已用 42%：2h10m 後重置，照目前速度要 3h03m 才用完，重置前不會撞頂。", "不用調整；長任務可以照排。"], pin: [], detail: ["5h 已用 42%，每小時約用 19%。", "撞頂：剩下 58% 照這個速度約 3h03m 用完。", "重置：5h 視窗 2h10m 後歸零。", "重置先到，所以這個視窗不會撞頂。", "7d 已用 18%，4d 後重置。", "今日 380k tokens；24h 趨勢比昨天高 12%。"] },
  '5-E': { reply: ["今天還沒有用量；5h 視窗從第一次請求開始算。"], pin: [], detail: ["7d 已用 3%，6d 後重置。"] },
  '5-M': { reply: ["cookys 池 77%：照目前速度約 1h03m 後撞頂，重置在 2h40m 後。", "撞頂比重置早，建議把 cookys 上的長任務移到 ops 池（12%）。"], pin: [], detail: ["cookys 池每小時約用 22%。", "撞頂：剩 23% ÷ 22%/h ≈ 1h03m。", "重置：2h40m 後。"] },
  '5-L': { reply: ["焦點：5h 額度的估算方式，全文在來龍去脈。"], pin: [], detail: ["5h 已用 42%，每小時約用 19%。", "撞頂：剩下 58% 照這個速度約 3h03m 用完。", "重置：5h 視窗 2h10m 後歸零。", "重置先到，所以這個視窗不會撞頂。", "7d 已用 18%，4d 後重置。", "今日 380k tokens；24h 趨勢比昨天高 12%。", "估算用最近 30 分鐘的燃燒率，不是整個 5h 的平均。", "燃燒率每 5 分鐘更新一次。", "「撞頂」指剩餘用完；「重置」指視窗結束歸零。", "兩個時間比較，先到的那個決定要不要調整。", "額度池的數字由 capacity 提供，不是本機算的。", "今日用量只算本機轉錄檔裡的數字。"] },
  '5-X': { reply: ["seats --quota 讀不到，5h 和 7d 都沒有數字，無法估撞頂時間。", "額度池和今日用量另有資料，照常顯示。", "輸出速度：本 session 還沒有請求。"], pin: ["⊘ seats --quota 結束碼 1，也沒有快取", "⊘ 輸出速度：本 session 還沒有請求"], detail: ["額度池 09:40 更新；今日用量 09:41 更新。"] },
  '5-S': { reply: ["quota 指令失敗，顯示的是 18 分鐘前的快取（黃色 ⏶）。", "最後一次請求在 09:06（35 分鐘前），41 tok/s 是那時的速度。", "撞頂估算暫停，等新數字回來。"], pin: ["⏶ seats --quota 失敗，用 18 分鐘前的快取", "⚠ 額度池 14 分鐘前", "⚠ 最後一次請求 09:06（35 分鐘前）"], detail: ["今日 380k tokens（09:06）。"] },
  '5-X2': { reply: ["額度池和今日用量讀不到；5h、7d 照常。", "不能比較各池，換池建議暫停。"], pin: ["⊘ capacity 額度池讀不到", "⊘ 今日用量、24h 趨勢讀不到"], detail: ["5h 已用 42%，每小時約用 19%。", "撞頂：剩下 58% 照這個速度約 3h03m 用完。", "重置：5h 視窗 2h10m 後歸零。", "重置先到，所以這個視窗不會撞頂。", "7d 已用 18%，4d 後重置。"] },
  '6-N': { reply: ["tri-merge 這個 worktree 4 天沒動，裡面有 2 個沒合併的 commit。", "人工處理：在 codeforge 主 clone 跑", "  git -C .claude/worktrees/tri-merge log develop..", "看完確定不要，再自己移除（這頁只看不刪）。"], pin: [], detail: ["路徑 .claude/worktrees/tri-merge · 分支 design/tri-merge", "最後 commit 11-21 · 沒有對應的活單", "規則：超過 3 天、沒有活單 → 開單接著做或刪掉"] },
  '6-E': { reply: ["✓ 沒有要你處理的殘留。", "自動清理今天清了 4 個暫存檔。"], pin: [], detail: ["上次掃描 09:30。"] },
  '6-M': { reply: ["tri-fable 5 天沒動，已經合進 develop，沒有沒合併的 commit。", "人工處理：git worktree remove .claude/worktrees/tri-fable"], pin: [], detail: ["分支 design/tri-fable 已合進 develop（d05a850）。"] },
  '6-L': { reply: ["tri-merge 有 2 個沒合併的 commit，全文在來龍去脈。", "人工處理前請先看完。"], pin: [], detail: ["路徑 .claude/worktrees/tri-merge · 分支 design/tri-merge", "commit 1  29a1b1c  合併稿三家版本（11-21）", "          改 doc/design/tri/merge/ 18 檔", "commit 2  4c0e2d1  合併稿 NOTES（11-21）", "          只改 NOTES.md", "這兩個 commit 的內容已被 v2 取代（74f24a9）。", "刪除前規則：沒合併的工作先打 archive tag，", "再 git bundle create 到備份目錄並 verify。", "做完才算可回復（tier 1）。", "之後才跑 git worktree remove 和 git branch -D。", "這一頁不會替你做任何一步。"] },
  '6-X': { reply: ["殘留掃描讀不到，不知道有沒有要你處理的。", "外掛載入另有資料，照常。"], pin: ["⊘ residue 掃描失敗（結束碼 2）"], detail: ["上次成功掃描 08:30。"] },
  '6-S': { reply: ["殘留清單是 2 小時前掃的；tri-merge 可能已經處理掉。", "人工處理前先在主 clone 重新掃描：", "  node ~/projects/autopilot/scripts/repo-residue-sweep.js scan --repo ."], pin: ["⚠ residue 2 小時前（過時）"], detail: ["路徑 .claude/worktrees/tri-merge"] },
  '6-X2': { reply: ["load_source 讀不到，不知道 forge-stats 是從哪裡載入的。", "殘留清單照常。"], pin: ["⊘ load_source 讀不到"], detail: ["上次讀到：主 clone（develop）。"] },
  '7-N': { reply: ["codeforge--claude 在審 console 設計稿，第 1 輪。"], pin: [], detail: ["模型 opus · 41 tok/s ▆▆▄▃▆（近 5 分鐘）", "最近 run hetero-1795623455（codex，已交件）", "產線：design/console-full · 審查中"] },
  '7-E': { reply: ["目前沒有在跑的 agent。"], pin: [], detail: ["最近一個在 09:10 結束（docs--claude）。"] },
  '7-M': { reply: ["hangar--claude 在換池，第 3 輪。"], pin: [], detail: ["模型 sonnet · 63 tok/s ▆▆▆▄▆", "最近失敗：換池逾時（09:22）"] },
  '7-L': { reply: ["✗ codex 派工：測試逾時，全文在來龍去脈。"], pin: [], detail: ["run hetero-1795619800 · codex gpt-6.1", "09:12 跑 tests/pool-switch.test.sh", "09:14 停在「等 NAS stat」", "09:24 逾時 600 秒，wrapper 送 SIGTERM", "09:25 子程序沒有結束，送 SIGKILL", "09:25 worktree 保留，沒有 commit", "09:26 標失敗：timeout", "判斷：NAS 掛載點沒有回應，跟程式碼無關", "下一步：NAS 恢復後重派", "同一原因今天第 3 次（1 現況、3 派工也看得到）", "這一筆的 tok/s 不顯示：已結束"] },
  '7-X': { reply: ["本機待決卡讀不到；他機卡還沒接線（ctx.others）。", "每個 agent 的速度（agentsColumn）沒有資料，寫「—」。"], pin: ["⊘ decide 讀不到", "⊘ agentsColumn 沒有 steps", "他機卡 others 還沒接線"], detail: ["runs 照常（09:41）。"] },
  '7-S': { reply: ["runs 和他機卡都是 11 分鐘前的。", "他機卡這格畫的是接線後的樣子（fixture）。"], pin: ["⚠ runs 11 分鐘前", "⚠ pm／console 11 分鐘前", "⚠ 他機卡 11 分鐘前（接線後）"], detail: ["模型 opus · 41 tok/s"] },
  '7-X2': { reply: ["runs 和產線摘要讀不到，看不到 agent 在做什麼。", "待決卡照常。"], pin: ["⊘ runs 讀不到", "⊘ pm／console／fleetFeed 讀不到"], detail: ["上次讀到 09:20：執行中 3、失敗 1。"] },
  '9-N': { reply: ["● 進行中  ✓ 完成／已選  ✗ 失敗  ⊘ 讀不到  ⚠ 過時  ⏶ 用快取", "▸ 目前這一筆  ★ 建議  ▲ 要先動手  ⇡ 已送出", "底列左邊是狀態，右邊是分頁；黃色數字是待決。"], pin: [], detail: ["顏色：黃 要注意 · 紅 讀不到或失敗 · 綠 完成 · 灰 說明"] },
  '9-L': { reply: ["焦點「按鍵」：全部按鍵在來龍去脈，新增的標 ＊。", "1–9 切頁 · j/k 換筆 · o 展開 · Esc 回輸入框或關閉"], pin: [], detail: ["1–9        切到第 N 頁", "j/k        換一筆（待決頁用 p/n 換張）", "o          展開焦點列（待決頁沒有）", "a/b/c      選選項（待決、待辦）", "f          沒選的卡填成建議（▲ 卡不填）", "m          寫附註（只有待決）", "s          送出前先預覽", "y / x      預覽中確認 / 取消", "g ＊       複製等你動手卡的網址", "↑↓ ＊      捲回覆區（待決以外的頁，原本是換筆）", "PgUp/PgDn ＊ 捲來龍去脈（原本只有待決有）", "Esc        待決回輸入框；其他頁關閉", "Enter      附註輸入中：存附註"] },
}
export const txt = (id: string): Txt => {
  const t = RAW[id]
  if (t === undefined) throw new Error(`no design text for step ${id}`)
  return { reply: t.reply.map(sw), pin: t.pin.map(sw), detail: t.detail.map(sw) }
}
