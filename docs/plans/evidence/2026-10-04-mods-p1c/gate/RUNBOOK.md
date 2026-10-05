# W4 真機驗收手冊（owner 用，ssh + tmux）

這份手冊讓你在自己的機器上，把 band 的每一格對照到「同一時刻的來源檔」。你只需要做三件事：在 tmux 裡觸發一格、跑 `capture.sh` 把當下的畫面和來源檔存起來、跑 `check.js` 看 PASS 或 FAIL。判斷不靠你的眼睛：`check.js` 是獨立寫的檢查器，它從來源檔重新推出 band 該寫什麼，再跟畫面比對。

計畫依據：`docs/plans/2026-10-03-mods-visible-dispatch.md` §4 P1W 的 W4 門檻（R5.5–R5.9）。

## 0. 準備（做一次）

1. 你要有一份裝好落地版 autopilot（含 `live` mod）的 Claude Code。落地 clone 用 `claude --plugin-dir <落地 clone>` 載入。
2. 你要有一個已接 autopilot 的測試 repo（根目錄下有 `.claude/*-config.md`）。下面稱它為「測試 repo」。
3. 用 sonnet 或 opus 時，你要在啟動 `claude` 前設 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`，否則任務清單那一格不會有資料。
4. 你要開兩個 tmux 視窗：視窗 A 跑 Claude Code，視窗 B 跑下面的 capture 與 check 指令。
5. 下面的指令都假設你先設好這個變數（路徑換成你的 clone）：

```bash
G=<落地 clone>/docs/plans/evidence/2026-10-04-mods-p1c/gate
```

## 1. 每一格怎麼做

固定流程：視窗 A 觸發 → 等 20 秒（mod 每 5 秒讀一次、watcher 每 10 秒寫一次）→ 視窗 B 執行 capture → 執行 check。

```bash
# 視窗 B。<cell> 是你取的格子名，<target> 是視窗 A 的 tmux 目標（例如 gate-l5）
bash $G/capture.sh <cell> <target>        # 印出存檔目錄
node $G/check.js <上一行印出的目錄>
```

`capture.sh` 只讀、不寫 live 目錄和 marker 目錄；它會自己從 pane 的目錄找到最新的 session marker。找錯時，把 session id 當第三個參數傳進去。

`check.js` 的 PASS 長這樣：每個項目一行 `PASS`，最後一行 `RESULT: PASS`。項目包括結論詞（verdict）、專案名、階段、進度、經過時間，以及（有資料時）「代你決定」「n 件派工無決策紀錄」兩個片段和第二行的理由。FAIL 的意思是 band 和來源檔不一致，這是一個發現，不是檢查器的錯：請保留存檔目錄、不要重跑覆蓋，直接記進結果表。

「來源未接」：sources 清單（`sources.json`）說某個寫入端沒裝或被關掉時，band 該格寫「來源未接」就是 PASS，`check.js` 會自己依清單判斷，你不用特別處理。

### 五個結論詞的觸發方式（每個模式都做一遍）

| 格子 | 你在視窗 A 怎麼觸發 | 存檔時機 |
|------|--------------------|----------|
| 要你決定（權限） | 用預設權限模式（不要 bypass），叫 Claude 執行一個需要權限的指令，例如「跑 `touch /tmp/gate-perm-test`」。權限提示出現後，你不要回答。 | 提示還開著的時候 |
| 要你決定（AskUserQuestion） | 對 depth-0 說「先用 AskUserQuestion 問我選 A 還是 B，我答了你再繼續」。問題出現後，你不要回答。這一格會同時有 attention 檔和 decision 檔。 | 問題還開著的時候 |
| 疑似卡住 | 叫 depth-0 派一個會沉默的派工：「用 dispatch-hetero 派一個 hand，請它在 shell 裡只跑 `sleep 420`，不要輸出任何東西」。派工的 log 超過 180 秒沒有新內容，watcher 就在 envelope 標 `stall: true`（門檻是 `dispatch-status.js --stall-secs 180`）。 | 派出後等 200 秒以上再存 |
| 完成待驗收 | 兩種擇一。(1) 用 /l4–/l6 跑一個只改一個 docs 檔的小 campaign 到終態，讓凍結進度 done 等於 total。(2) 任何模式：叫 Claude 建立兩個任務，再把兩個都完成（需要第 0 節的 TODO 環境變數）。 | 終態或全部任務完成、沒有派工在跑之後 |
| 待命 | 讓 Claude 回答完一個簡單問題，然後你什麼都不做，等 60 秒。 | 回合結束後 70 秒以上 |

如果疑似卡住的派工沒有真的卡住（band 沒變），你可以用同一個探測看看 watcher 看到什麼：`node <clone>/scripts/dispatch-status.js --run <run-id> --stall-secs 180`。這個輸出也請貼進結果表的備註。

### 六個模式怎麼開

每個模式都在自己的 tmux session 裡開（`tmux new -s gate-<模式>`），工作目錄是測試 repo：

| 模式 | 視窗 A 怎麼開 | 要注意 |
|------|--------------|--------|
| dev-flow | 啟動 `claude`，第一句說「用 dev-flow 做：在 README 加一行測試字」 | 一般 session，marker 的 level 是 null，band 的 root 是 job root |
| /l3 | 啟動 `claude`，輸入 `/l3 在 README 加一行測試字` | marker level 是 l3 |
| /l4 | 啟動 `claude`，輸入 `/l4 在 README 加一行測試字` | foreman 在背景跑；完成待驗收看 campaign 進度 |
| /l5 | 啟動 `claude`，輸入 `/l5 在 README 加一行測試字` | 額外格 (b) 要在這個模式做 |
| /l6 | 啟動 `claude`，輸入 `/l6 在 README 加一行測試字` | 同 /l5 |
| ceo-agent（沒有 /lN） | 啟動 `claude`，第一句說「CEO mode：在 README 加一行測試字，你全權處理」，不要打任何 /lN | marker 應該是一般 session（level null），不是 l3–l6 |

每個模式做完五個結論詞，共 30 格。同一個 session 可以連續做多格，每格之間讓 session 回到你可以重新觸發的狀態（回答掉問題、核准掉權限）。

## 2. 三個額外格

### (a) 真實的 AskUserQuestion payload

目的：確認 hook 真的在 live session 裡把問題寫成 decision 檔，內容跟你看到的問題一致。

1. 在任一模式做完「要你決定（AskUserQuestion）」觸發，問題還開著。
2. 視窗 B 執行下面的指令，把輸出整段貼進結果表的備註欄：

```bash
cat "$(git -C <測試 repo> rev-parse --path-format=absolute --git-common-dir)"/autopilot/decisions/*.json
```

PASS 的條件：檔案裡有 `"source": "ask_user_question"`、`question` 是你在畫面上看到的問題、`options` 是你看到的選項（只有一個選項時是 null）。你回答問題後，再 `cat` 一次，這個檔應該已經不存在（hook 自動關掉）。

### (b) /l5 跨 /compact，marker 不變

目的：確認 compact 不會洗掉正在跑的 /l5 marker。

1. 在 /l5 session 裡，視窗 B 找到 session id 並記下 marker 的雜湊：

```bash
M=$(ls -t ~/.autopilot/session-mode/*.json | head -1); echo $M
sha256sum $M | tee /tmp/gate-marker-before.txt
```

2. 視窗 A 輸入 `/compact`，等它做完。
3. 視窗 B 再算一次：

```bash
sha256sum $M | tee /tmp/gate-marker-after.txt
diff /tmp/gate-marker-before.txt /tmp/gate-marker-after.txt && echo SAME
```

PASS 的條件：兩個雜湊完全相同，`diff` 沒有輸出，印出 `SAME`。接著再存一次 band，`check.js` 仍然 PASS，而且 marker 的 `level` 仍是 `l5`。

### (c) 沒有接 autopilot 的 repo 不留痕跡

目的：確認沒接 autopilot 的專案不會被寫進任何東西，也不會被起 watcher。

1. 準備一個沒有 `.claude/*-config.md`、你也沒設 `AUTOPILOT_RUNS_WATCH_AUTOSTART=1` 的 repo（下面叫「空 repo」）。
2. 視窗 B 先存下現況：

```bash
ls ~/.autopilot/session-mode | sort > /tmp/gate-c-before.txt
ps -eo pid,etimes,args | awk '/status runs --watch/ && !/awk/' > /tmp/gate-c-ps-before.txt
ls "$(node -e 'console.log(require(process.env.HOME+"/.autopilot/live-pointer.json").live_base)')/runs" | sort > /tmp/gate-c-runs-before.txt
```

3. 視窗 A 在空 repo 啟動 `claude`，送兩個提示（例如「你好」「列出這個目錄」），回合結束。
4. 視窗 B 再存一次，跟 before 比對：

```bash
ls ~/.autopilot/session-mode | sort > /tmp/gate-c-after.txt
ps -eo pid,etimes,args | awk '/status runs --watch/ && !/awk/' > /tmp/gate-c-ps-after.txt
ls "$(node -e 'console.log(require(process.env.HOME+"/.autopilot/live-pointer.json").live_base)')/runs" | sort > /tmp/gate-c-runs-after.txt
diff /tmp/gate-c-before.txt /tmp/gate-c-after.txt; diff /tmp/gate-c-ps-before.txt /tmp/gate-c-ps-after.txt; diff /tmp/gate-c-runs-before.txt /tmp/gate-c-runs-after.txt
```

PASS 的條件：三個 `diff` 都沒有輸出，也就是 `~/.autopilot/session-mode/` 沒有新檔、沒有新的 watcher 程序、live 目錄的 `runs/` 沒有新檔。這一格不需要跑 `check.js`。注意：另一個正在跑的、已接 autopilot 的 session 可能造成雜訊；做這一格時，請先關掉其他 session。

## 3. 結果表

每格填 PASS、FAIL 或來源未接，後面寫存檔目錄（`gate/runs/<cell>/<時間>/`）。FAIL 的格子，把 `check.js` 的 FAIL 行抄進備註。

| 模式 | 要你決定（權限） | 要你決定（AskUserQuestion） | 疑似卡住 | 完成待驗收 | 待命 |
|------|------------------|-----------------------------|----------|------------|------|
| dev-flow | | | | | |
| /l3 | | | | | |
| /l4 | | | | | |
| /l5 | | | | | |
| /l6 | | | | | |
| ceo-agent（無 /lN） | | | | | |

| 額外格 | 結果 | 證據（輸出或存檔目錄） |
|--------|------|------------------------|
| (a) AskUserQuestion payload：decision 檔內容 | | |
| (b) /l5 跨 /compact：marker 雜湊前後相同 | | |
| (c) 未接 repo：session-mode 無新檔、無新 watcher、runs 無新檔 | | |

全部 PASS（或來源未接）才算 W4 門檻通過。任何一格 FAIL，你把表和對應存檔目錄交給 depth-0，由它判斷是來源寫入端的缺陷、band 的缺陷，還是這份檢查器的規則寫錯；這個判斷不由檢查器自己下。
