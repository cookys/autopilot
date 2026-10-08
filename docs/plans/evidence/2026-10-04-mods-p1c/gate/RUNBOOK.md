# W4 真機驗收手冊（owner 用，ssh + tmux）

這份手冊讓你在自己的機器上，把 band 的每一格對照到「同一時刻的來源檔」。你只需要做三件事：在 tmux 裡觸發一格、跑 `capture.sh` 把當下的畫面和來源檔存起來、跑 `check.js` 看 PASS 或 FAIL。判斷不靠你的眼睛：`check.js` 是獨立寫的檢查器，它從來源檔重新推出 band 該寫什麼，再跟畫面比對。

計畫依據：`docs/plans/2026-10-03-mods-visible-dispatch.md` §4 P1W 的 W4 門檻（R5.5–R5.9）。

## 0. 準備（做一次）

1. 落地版已經是這台機器的 live plugin（主 checkout `/home/cookys/projects/autopilot` 在 2160351c，Claude Code 透過 dev symlink 載入它），直接開 `claude` 就是新版，不需要 `--plugin-dir`。
2. 測試 repo 用 `~/projects/gate-sandbox`（已接 autopilot、預設分支 develop、origin 是本機 bare repo `~/projects/gate-sandbox-origin.git`，可以放心改、merge、刪）。**不要拿 autopilot 本身當測試 repo**：它就是正在運作的 plugin。
3. 用 sonnet 或 opus 時，你要在啟動 `claude` 前設 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`，否則任務清單那一格不會有資料。
4. 你要開兩個 tmux 視窗：視窗 A 跑 Claude Code，視窗 B 跑下面的 capture 與 check 指令。
5. 下面的指令都假設你先設好這個變數（路徑換成你的 clone）：

```bash
G=/home/cookys/projects/autopilot/docs/plans/evidence/2026-10-04-mods-p1c/gate
```

## 1. 每一格怎麼做

固定流程：視窗 A 觸發 → 等 20 秒（mod 每 5 秒讀一次、watcher 每 10 秒寫一次）→ 視窗 B 執行 capture → 執行 check。

```bash
# 視窗 B。<cell> 是你取的格子名，<target> 是視窗 A 的 tmux 目標，一律寫成 `<名稱>:`（例如 gate-l5:）
bash $G/capture.sh <cell> <target>        # 印出存檔目錄（<G 的 runs>/<cell>/<時間>/）
node $G/check.js <上一行印出的目錄>
```

tmux 的細節（兩個 session 同時開時最容易出錯）：
- 目標一律寫成 `-t <名稱>:`，結尾要有冒號。只寫 `-t c` 時，tmux 會把它當成前綴去配對，另一個叫 `df` 的 session 可能收到你的按鍵（pilot 實際發生過）。不要依賴預設目標。
- 用私有 tmux server 的話（agent 驅動就是這樣，見 `DRIVER.md`），啟動時設 `GATE_TMUX_SOCKET=gate`：`GATE_TMUX_SOCKET=gate bash $G/capture.sh <cell> gate-l5:`，它會改用 `tmux -L gate`。
- 第一次在測試 repo 啟動 `claude` 會跳出信任資料夾的對話框，預設選項是「No, exit」：按 Down 再按 Enter 才是信任。
- 被驅動的 session 裡，Bash 工具會擋掉單獨的前景 `sleep N`。要等就寫成迴圈（`for i in 1 2 3; do echo tick $i; sleep 6; done`），迴圈第一次會問權限，核准即可。
- 叫 depth-0 派工時，把腳本的絕對路徑一起給它（例如 `/home/cookys/projects/autopilot/scripts/dispatch-hetero.sh`），否則它會自己 `find /` 去找。
- 這台機器的 ChatGPT 帳號不接受 `--model gpt-5.5-codex`（回 400）。派 codex 時要帶 `--model gpt-6-astra`：`dispatch-hetero.sh` 對非 agy 的 runner 不帶 `--model` 會直接拒絕，而且 codex 是用 `--ignore-user-config` 啟動，`~/.codex/config.toml` 的預設不會生效。

`capture.sh` 只讀、不寫 live 目錄和 marker 目錄；它會自己從 pane 的目錄找到最新的 session marker。找錯時，把 session id 當第三個參數傳進去。

**P7 一行 band（stage-graph alpha.2 起）。** band 現在只有一行：`<結論> │ <位置> │ <單元> │ <派工> │ <review> │ <決策> │ <花費> │ <衛生> │ ⓘ`，空的槽整個省略，窄螢幕依寬度表拿掉槽（< 160 衛生；< 140 花費、決策；< 120 ◷ 時間、review；< 80 只剩結論、派工、單元進度條、ⓘ）。契約：`docs/plans/evidence/2026-10-06-stage-graph/p7/contract.md` §②。原來的第二行（理由）搬到面板的 Now 分頁，不再由 `check.js` 判。

`capture.sh` 除了 `pane.txt` 也存彩色的 `pane.ansi`，並把 D1–D4 與 qc / review / load-source / residue / stage 檔、session marker 一起複製進存檔目錄，`meta.json` 記 `window_width`、`mode`（`GATE_MODE`，沒設就取格子名第一段）。`check.js` 從這些檔獨立推出每一槽，每槽印一行 `PASS|FAIL|ABSENT <槽> expected … got … [來源]`，最後一行固定是 `PASS <mode> fields=<n>` 或 `FAIL <mode> fields=<n> failed=<槽,…>`（n = 判了幾槽，含 `layout`：整行順序、分隔、寬度）。寬度表被拿掉的槽必須是 ABSENT，畫出來就 FAIL。寬度表套在 `bodyColumns` 上，假設 `bodyColumns = window_width - 5`（引擎右邊留 5 格，沒有 docked pane）；有 dock 時在 `meta.json` 寫 `body_columns` 或用 `check.js <dir> --body-columns N` 覆蓋。位置槽的 ◷ 時間容許 ±2 分鐘。

### 三個寬度 + 彩色截圖

```bash
GATE_TMUX_SOCKET=gate bash $G/widths.sh <cell> gate-l5: <sid>   # 把視窗依序調成 209 / 120 / 80 欄，各等 >= 8 秒重畫，存 <cell>-w209 / -w120 / -w80，並產生截圖
for d in <印出的三個目錄>; do node $G/check.js $d; done
bash $G/screenshot.sh <capture-dir>                              # 單獨補截圖：band-<W>.png（只有 band 那一行）與 pane.png，路徑寫進 meta.json
```

截圖流程是 `pane.ansi` → `docs/plans/evidence/2026-10-06-tui-band/ansi2html.py` → headless chrome，視窗每欄 10 px，看得到整個寬度。純文字的 `capture-pane -p` 沒有顏色，主題色要看 PNG（用 Read 看圖）。FAIL 的存檔目錄一樣不覆蓋重跑。

**面板 / dialog 表面不變：** dialog 蓋住 band 時 `check.js` 判右上角面板（結論詞 + 理由），或只憑 `attention.json` 判結論；其餘槽印 `SKIP`，不算進 fields。

「來源未接」：sources 清單（`sources.json`）說某個寫入端沒裝或被關掉時，band 該格寫「來源未接」就是 PASS，`check.js` 會自己依清單判斷，你不用特別處理。

### 六個結論詞的觸發方式（每個模式都做一遍）

| 格子 | 你在視窗 A 怎麼觸發 | 存檔時機 |
|------|--------------------|----------|
| 要你決定（權限） | 用預設權限模式（不要 bypass），叫 Claude 執行一個需要權限的指令，例如「跑 `touch /tmp/gate-perm-test`」。權限提示出現後，你不要回答。 | 提示還開著的時候 |
| 要你決定（AskUserQuestion） | 對 depth-0 說「先用 AskUserQuestion 問我選 A 還是 B，我答了你再繼續」。問題出現後，你不要回答。這一格會同時有 attention 檔和 decision 檔。 | 問題還開著的時候 |
| 進行中 | 兩種擇一。(1) 叫 Claude 建立兩個任務，只開始其中一個（狀態 in_progress），然後停在那裡：session 在工作中，沒有派工在跑，band 讀 進行中，理由是「任務進行中：<任務名>」。(2) 派一個會跑一陣子的派工，派工在跑時存檔，理由是「n 個派工在跑」。**不要用長時間的前景 Bash 來造這一格**：核准權限之後，attention 要等那個工具結束才會清掉（已知限制，見下），band 會一直停在 要你決定。 | 任務開始之後、或派工在跑的時候 |
| 疑似卡住 | 派一個會沉默的派工，然後把它的行程暫停（見下面「疑似卡住怎麼造」）。派工的 log 超過 180 秒沒有新內容，watcher 就在 envelope 標 `stall: true`（門檻是 `dispatch-status.js --stall-secs 180`）。 | 暫停後等 180 秒加兩次 watcher 更新（共約 200 秒以上）再存 |
| 完成待驗收 | 兩種擇一。(1) 用 /l4–/l6 跑一個只改一個 docs 檔的小 campaign 到終態，讓凍結進度 done 等於 total。(2) 任何模式：叫 Claude 建立兩個任務，再把兩個都完成（需要第 0 節的 TODO 環境變數）。**條件是「沒有派工在跑」**：任務全完成但還有一個派工活著時，band 讀 進行中才是對的，`check.js` 也這樣判。 | 終態或全部任務完成、沒有派工在跑之後 |
| 待命 | 讓 Claude 回答完一個簡單問題，沒有任務在 in_progress，然後你什麼都不做，等 60 秒。待命的意思是「這回合結束，沒有別的事在進行」：回合結束的信號（attention 的 idle）在 Stop 之後約 60 秒才會寫出來。 | 回合結束後 70 秒以上 |

### 疑似卡住怎麼造

codex 派工會每三分鐘左右自己吐一行旁白，log 不會安靜 180 秒；pilot 試過 `sleep 420` 的 hand，band 全程停在 進行中。要造真的沉默，改成暫停行程：

1. 派一個 hand（絕對路徑的 `dispatch-hetero.sh`，給它一個長工作），從 manifest 的 pid 找到它的行程；manifest 沒有 pid 時，用 `ps -eo pid,args` 在輸出裡找它 worktree 的路徑（不要用 `pgrep -f`，它會比對到自己）。
2. 動手前先確認這個 pid 真的是那個 hand：`readlink /proc/<pid>/cwd` 是它的 worktree，`tr '\0' '\n' < /proc/<pid>/environ` 看得到它的派工環境。確認完才 `kill -STOP <pid>`，只用 pid，不用名稱比對。
3. 等 180 秒（stall 門檻）再加兩次 watcher 更新。watcher 的 tick 是 10 秒（`src/status/runs-watch.js` 的 `DEFAULT_INTERVAL_S`），所以約 200 秒就夠；pilot 沒有另外量出逐派工探測的更新間隔，所以請看 capture 裡 envelope 該 run 的 `probe_age_s`：它大於約 30 秒時，探測還沒更新，再等一下。
4. capture、check，band 該讀 疑似卡住，理由是最安靜那個派工的 `last_event_age_s`。
5. 結束後 `kill -CONT <pid>`，讓它跑完；不想等就把它殺掉。

如果疑似卡住的派工沒有真的卡住（band 沒變），你可以用同一個探測看看 watcher 看到什麼：`node <clone>/scripts/dispatch-status.js --run <run-id> --stall-secs 180`。這個輸出也請貼進結果表的備註。

### 已知限制：核准權限之後 attention 不會馬上清掉

核准一個權限之後，要到被核准的那個工具跑完（PostToolUse）attention 才會清掉：核准和 PostToolUse 之間沒有任何 hook 事件。所以一個要跑 72 秒的前景工具，band 會在整段時間裡讀 要你決定，而不是 進行中。這是已知限制，不算 FAIL，不要為它改 check.js；造 進行中 的格子請照上面的表。

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

每個模式做完六個結論詞（要你決定分權限和 AskUserQuestion 兩格），共 36 格。同一個 session 可以連續做多格，每格之間讓 session 回到你可以重新觸發的狀態（回答掉問題、核准掉權限）。

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
diff /tmp/gate-c-before.txt /tmp/gate-c-after.txt; diff <(awk '{print $1}' /tmp/gate-c-ps-before.txt) <(awk '{print $1}' /tmp/gate-c-ps-after.txt); diff /tmp/gate-c-runs-before.txt /tmp/gate-c-runs-after.txt
```

比 watcher 時要比 PID，不要比 `ps` 的整行文字：整行有 `etimes`（已跑秒數）一欄，兩次之間一定不同，直接 `diff` 永遠不會是空的。PASS 的條件：三個 `diff` 都沒有輸出，也就是 `~/.autopilot/session-mode/` 沒有新檔、沒有新的 watcher 程序、live 目錄的 `runs/` 沒有新檔。這一格不需要跑 `check.js`。注意：另一個正在跑的、已接 autopilot 的 session 可能造成雜訊；做這一格時，請先關掉其他 session。

## 2b. 合併 review 加的三格（2026-10-05）

- **(d) /l5 的「代你決定」算在 campaign 那一格**：/l5 跑到 engine 裁決過至少一個 finding 之後，capture 一次。看 band 第二行有沒有「代你決定 m 件」，並在視窗 B 跑 `grep -c . $(git -C ~/projects/gate-sandbox rev-parse --path-format=absolute --git-common-dir)/autopilot/ledger/decisions.jsonl`。ledger 有列、band 卻寫 0 件，就是 FAIL（表示 ledger 列的 root 跟 campaign scope 對不上）。
- **(e) 一般 session 用 dispatch-author 派工，派工掛在這個 session 底下**：在 dev-flow 模式叫 Claude 用 dispatch-author 派一個小工作，capture 後確認 band 的派工數有算到它；`cat ~/.autopilot/session-mode/<sid>.json` 的 `root_run_id` 要等於該派工 manifest 的 `root_run_id`。
- **(f) 一般 session 進入 /lN 會換編號（已知行為，記錄就好）**：同一個 session 先做 dev-flow、再打 `/l3 …`，capture 前後各一次。marker 的 `root_run_id` 會變成新的值，band 會換到新的 scope。這是現行規則，不算 FAIL；請記下你覺得 band 的連續性能不能接受。

## 3. 結果表

每格填 PASS、FAIL 或來源未接，後面寫存檔目錄（`gate/runs/<cell>/<時間>/`）。FAIL 的格子，把 `check.js` 的 FAIL 行抄進備註。

| 模式 | 要你決定（權限） | 要你決定（AskUserQuestion） | 疑似卡住 | 完成待驗收 | 進行中 | 待命 |
|------|------------------|-----------------------------|----------|------------|--------|------|
| dev-flow | | | | | | |
| /l3 | | | | | | |
| /l4 | | | | | | |
| /l5 | | | | | | |
| /l6 | | | | | | |
| ceo-agent（無 /lN） | | | | | | |

| 額外格 | 結果 | 證據（輸出或存檔目錄） |
|--------|------|------------------------|
| (a) AskUserQuestion payload：decision 檔內容 | | |
| (b) /l5 跨 /compact：marker 雜湊前後相同 | | |
| (c) 未接 repo：session-mode 無新檔、無新 watcher、runs 無新檔 | | |

全部 PASS（或來源未接）才算 W4 門檻通過。任何一格 FAIL，你把表和對應存檔目錄交給 depth-0，由它判斷是來源寫入端的缺陷、band 的缺陷，還是這份檢查器的規則寫錯；這個判斷不由檢查器自己下。
