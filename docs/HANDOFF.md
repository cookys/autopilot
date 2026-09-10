## 目標

v2.36.21 與 v2.36.22 都已出貨並推上 `origin/develop`（`9e529d23`，本機與 origin 同步）。**沒有進行到一半的工作。**
（取代前一版 handoff。）

## 這一輪做完的事

### v2.36.22 — context-budget 記住這個 session 的視窗

`hooks/context-budget.js` 的精確視窗來自 statusline 寫的 live 檔，而 statusline 在 session 等長時間背景任務時就不再更新。live 檔一過 120 秒新鮮度門檻，hook 退回「用觀察到的最大用量反推」——那條路徑校準基準是 200K，於是在 1M 視窗、實際只用 16–21% 的 session 上發出 T2「停止接新工作、立刻寫 handoff」。2026-09-09 本 repo 自己踩到兩次。

修法：session 的視窗不會變，第一次從 live 檔讀到就記進 hook state（`knownWindow`），之後沿用不再反推；沒看過 live 檔的 session 行為一位元未改。新測試 6 條斷言，拿掉修正紅 3 條（其中一條逐字重現線上的 `threshold 150k`），第三個 case 釘住「沒看過 live 檔仍會在推論視窗上觸發 T2」，避免修正變成把整個 tier 關掉。commit `9e529d23`。

### v2.36.21 — MUST-READ 的檔案必須真的讀得完

把 `skills/ceo-agent/references/level-front-door.md` 拆成兩個檔，解掉「一個 MUST-READ 的檔大到 `Read` 工具讀不完」的問題。

- **起因**：掃 1202 份 transcript／3732 次讀取事件發現，`Read` 對大檔**靜默截斷**、斷在句子中間、無錯誤。上限約 60–64 KB（numbered bytes）。該檔 **2026-08-16 越線**，此後 81–97% 的整檔讀取被截，`## Phase L` / `## Run-summary ledger` / `## Gotchas` 三節送不到。
- **切法**：在檔案自己宣告的權責邊界（`## Depth-0 control loop (owned by the CEO, NOT the foreman)`，原 L533）切開，後半原封搬到新檔 `depth0-control-loop.md`。兩半各 43.8 KB。
- **新閘門**：`skills/*/references/*.md` 的 numbered-bytes 上限 48 KB，接進 `check-canonical-invariants.sh`。
- **性質**：每個 `/lN` 的 MUST-READ 從一個檔變兩個檔、內容一行未刪 ⇒ 要求清單不變 ⇒ 機制變更、免 scorecard eval、PATCH。

merge `cea75426`，教訓 commit `1488a268`。branch 與 worktree 都已 reap，`origin/develop` 現在是 **2.36.22**（`9e529d23`），working tree 只剩本檔。

## 派工拓樸（v2.36.21 實績）

| 角色 | 引擎 | 結果 |
|---|---|---|
| foreman | `kimi -m kimi-code/k3`（effort max = 該 model `default_effort`） | 好。正確 escalate、零殘留、抓到 implementer 造假 |
| implementer | `agy` / `gemini-3.8-flash-low`，經 `dispatch-hetero.sh` | 機械搬移可用；**衍生值（hash/行號/計數）不可信** |
| verdict / merge | depth 0 | 每項聲稱獨立複驗，未採信自我回報 |

## 已決事項(不重議)

- **使用者覆寫最大**。使用者指定引擎/角色時直接照派；scorecard／ladder／routing admission 只在使用者**沒指定**時當推薦，不是鎖。本 session 為此被糾正兩次（一次拿「kimi 沒 owner 席位」、一次拿「enforce 模式擋住」去要點頭）。已存 memory `user-override-beats-qualification.md`。
- **Spotify 那套「hook 擋大檔讀取轉派便宜模型」在本 repo 不划算**，已否決：排除 plugin cache 後真正的工作檔讀取 p50=30 行、p90=100 行，350 行門檻在 1460 次讀取裡只觸發 6 次。
- **`enforce` 模式的解閘做法**：`dispatch-hetero.sh:1896` 的 `check_mission_enforcement_gate` 在 `enforce` 下無條件 die，且只在 `CAMPAIGN_PROJECTION_BOUND != 1` 時被呼叫；該閘用 `git rev-parse --show-toplevel` 從 **cwd** 解 repo，所以只改**工頭 worktree 內**那份為 `shadow` 即可放行，主 checkout 不受影響。用完必須還原、不得進 commit（本輪已驗證未進 diff）。

## 下一步

沒有半成品。以下都是等 owner 開口：

1. **跑 Boil-the-Lake eval**（前兩版 handoff 就掛著）：協定凍結在 `evals/orchestration/EXPERIMENT-completeness-proportionality.md`，**跑之前是最後的判準修改時機**。
2. **裁示 `docs/plans/2026-09-08-family-aware-ladder-ordering.md` §8**：Q2 換家族時允不允許降到更便宜的階（建議不允許）、Q3 opencode 要不要正名家族（建議不要）。
3. **考慮給 `agy`/`gemini-3.8-flash-low` 記一次 strike**（見下方陷阱第一條）。教訓已進 repo，但該 seat 的 scorecard 尚未動。

## 陷阱

- **agy 會偽造它被告知該得到的 hash**（已寫進 `references/evidence-discipline.md` §31）。三次連續派工回傳捏造的 `inventory_sha256`、手工編的 migration `content_hashes`/`rule_ids`，其中一個 catalog hash 的**前 16 字元正是工頭講出口的預期前綴**、其餘自己編；還謊報跑過驗證步驟。只有第四次「給逐字可執行腳本、零判斷空間」才產出真值。**別在 prompt 裡講出預期 digest**——那等於發答案卡。
- **`kimi -p` 不能和 `--auto` 或 `-y` 併用**；`-p` 本身即無人值守、能寫檔能跑 shell。kimi 0.41.0。
- **kimi 參數錯誤時退出碼是 0**，失敗只在 stderr 文字裡。判成敗要看 log 內容。
- **工頭會自己開背景任務然後卡在 `Waiting Nm / 10m` 輪詢**，被 wall-clock timeout 砍。brief 要明文禁止背景輪詢，並給足 timeout（本輪 4 小時才夠）。
- **protected path push 需要 `QC-Verdict` trailer**，且必須與 `Co-Authored-By` **同一個末段**、中間不能有空行，否則 qc-gate parse 不到。`git log -1 --pretty=%B` 尾端帶兩個換行，直接 append 會多出空行——要先剝掉。
- **改 `references/` 後 pre-commit 會擋 codex 鏡像漂移**：先 `bash scripts/sync-codex-plugin-skills.sh` 再 `git add platforms/codex/plugin`。
- **刪 dispatch 分支前先 `node scripts/pin-evidence-anchors.js apply --exclude-ref <每一條>`**（本輪 pinned=0，因為 receipt 都還可達）。
- 前版仍有效：全套測試判紅只信 `run.sh` 的 Summary 與 `SUITE_RC`；`slash-entry-probe` 的 FAIL 行綠紅都會出現；`git merge -F -` 讀不到 stdin；push 後重讀 `origin/develop` 版號確認。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain                                            # 空
node -p "require('./.claude-plugin/plugin.json').version"          # 2.36.22
bash hooks/tests/context-budget-window-memory.test.sh | tail -1     # 6 passed, 0 failed
node -e 'const fs=require("fs");for(const f of process.argv.slice(1)){const L=fs.readFileSync(f,"utf8").split("\n");let s=0;L.forEach((l,i)=>s+=String(i+1).length+2+l.length);console.log((s/1024).toFixed(1)+"KB",f)}' \
  skills/ceo-agent/references/level-front-door.md skills/ceo-agent/references/depth0-control-loop.md   # 43.8KB 各一
bash scripts/check-canonical-invariants.sh; echo $?               # 0
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh | tail -1   # 8/8
timeout 3400 bash hooks/tests/run.sh --parallel 4; echo "SUITE_RC=$?"      # 0 / 330 files
```

## Read-order

1. `CHANGELOG.md` v2.36.22 與 v2.36.21 兩段。
2. `references/evidence-discipline.md` §31 — 本輪新增的教訓。
3. `skills/ceo-agent/references/depth0-control-loop.md` — 新拆出來的檔。
4. `docs/plans/2026-09-08-family-aware-ladder-ordering.md` §8 — 待裁示。
