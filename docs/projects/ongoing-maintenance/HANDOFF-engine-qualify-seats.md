# HANDOFF — flash-next / muse-spark 五座位考場（2026-09-21，cuda）

> 這條線與同目錄 `HANDOFF.md`（wave-1 落地）**無關**，不要互相覆蓋。
> 本 session：cookys-cuda，fleet handle `cuda`，instance `01M2K36F6F1M66M31MJ4HKM1HR`。
> 觸發 context-budget T2 交接，尚未施測任何一格。

## 目標

operator 指派：把 `qwen3.8-flash-next`（cc-shim / SGLang）與
`opencode-go/muse-spark-1.3-contributor`（opencode）烤過
{depth-0, foreman, implementer, reviewer, qcer} 五個座位。
工作原本由 openclaw 起頭，operator 說「我叫他讓你跑的」= 改派這台。

## 座位 → 考場 role 對照（已查證，非推測）

canonical `ROLE_IDS` = owner / implementer / reviewer / verification_author / explorer
（`src/engine/roles.js:8`）。`LEGACY_ROLE_ALIASES` = orchestrator→owner、planner→owner、
verifier→reviewer。depth-0 / foreman / qcer **都不在內**。

| 座位 | role | 依據 | 狀態 |
|---|---|---|---|
| depth-0 | `brain` | `skills/engine-onboarding/references/role-and-harness-governance.md:143`；`skills/l6/references/full-dispatch-pipeline.md:128` | 成套考場 |
| foreman | `owner`（近似） | 無 foreman 映射；owner intent-control 最接近 | **需先補 PATCH** |
| implementer | `implementer` | 同名 | 已 24/24，operator 要求重考綁 endpoint |
| reviewer | `reviewer` | 同名 | 成套 |
| qcer | `reviewer`（operator 裁定） | repo 全文零命中；`qc-panel.js` 無 role/admission 概念 | 與 reviewer 共用一張考卷 |

## operator 三項裁決（2026-09-21）

1. **qcer 當 reviewer role 考** —— 一張考卷涵蓋 reviewer + qcer 兩座位。
   bundle README 必須寫明 qcer 無獨立考卷、此 row 是代理證據，並記 BACKLOG。
2. **補 `QRP_PROMPT_MODE=owner`** —— 做，mechanism PATCH，單獨 commit 後再施測 owner 格。
3. **implementer 重考** —— 要做（我建議跳過被否決），目的是讓 row 帶 `endpoint{}` 揭露。

## 已完成

- ✅ `git pull` → `36fefa52`（develop，clean）
- ✅ **endpoint 已定義**：`FLASH_NEXT_URL` / `FLASH_NEXT_TOKEN` 寫進
  `~/.autopilot/endpoints.env`（mode 600）。
  指令：`printf 'sglang-local-no-auth' | node bin/autopilot.js endpoints set flash_next --url http://127.0.0.1:8001 --token-stdin`
  **陷阱**：endpoint 名不能有 `-`（CLI 要求 `[A-Za-z0-9_]`），所以是 `flash_next` 不是
  aimax395 派工單寫的 `flash-next`。loopback http 確實免 `--transport plaintext-private`。
  token 是 placeholder（SGLang 沒開 auth）—— bundle README 要揭露這點。

## 關鍵查證結果（別重做）

### deployment 未漂移 → implementer 舊證據仍有效

完整 SGLang argv（`/proc/2537857/cmdline`）對 9/03 README 逐項相符：
checkpoint **`7b719225242aacd3dbd3f9407468c2ee9a9d2594`**
（`/data/models/Qwen3.8-Flash-Next-NVFP4/.cache/huggingface/download/*.metadata`，
= README 的 `7b719225…`）、`--tp 2`、`--quantization modelopt_fp4`、
`--kv-cache-dtype nvfp4`、`--dtype bfloat16`、
`--speculative-algorithm NEXTN --speculative-num-steps 3 --speculative-num-draft-tokens 4`、
`--tool-call-parser qwen3_coder --reasoning-parser qwen3`、`--context-length 262144`。
9/03 的 implementer 24/24 有效到 2026-12-02。重考只為 endpoint 揭露，不是因為漂移。

### OpenCode Go 有 Anthropic 相容 `/v1/messages`（格 D 的解）

provider 定義（`~/.cache/opencode/models.json`）：`api: https://opencode.ai/zen/go/v1`、
`npm: @ai-sdk/openai-compatible`、`env: OPENCODE_API_KEY`、36 model 含
`muse-spark-1.3-contributor`。不帶憑證 shape probe：

```
POST /v1/definitely-not-a-real-endpoint-xyz -> 404
POST /v1/embeddings                         -> 404
POST /v1/complete                           -> 404
POST /v1/messages                           -> 401  {"type":"error","error":{"type":"ModelError","message":"Model  is not supported"}}
POST /v1/chat/completions                   -> 401
```

404 vs 401 排除通配 middleware，且 401 body 是 Anthropic 風格 envelope。
⇒ **路徑存在**，這繞開了 `QRP_CLI_KIND=opencode` 的 ALWAYS REFUSES
（`qualification-review-provider.js:35`）。但**格 D 尚未關閉**，還有兩件未驗：
1. **auth header 形狀** —— `x-api-key` 還是 `Authorization: Bearer`？
   key 在 `~/.local/share/opencode/auth.json` 的 `opencode-go`（type api）。
2. **model id 是否被 `/v1/messages` 接受** —— 401 body 是 `Model  is not supported`（model 空字串），
   還沒證明它吃 `muse-spark-1.3-contributor` 這個 id。OpenAI 相容那條路用的是同一組 id，
   但 Anthropic 端點不保證。
這兩件各要一次帶 key 的最小呼叫才能定案。

### owner 考卷的實作缺口（PATCH 範圍）

`scripts/qualification-review-provider.js:1157` `EXPECTED_ROLE_BY_MODE` =
{brain, va, consult, discuss, reviewer} —— **沒有 owner**；
`QRP_PROMPT_MODE` 白名單（`:1134`）同樣沒有。
owner corpus 本身存在（`evals/owner-capability-evidence-corpus.json`，
methodology `owner-intent-control-v1`，裁判端 `engine-qualify.js` parseOwnerPanelResult），
但沒有 broker mode 能送出去；`--panel-cmd` 是無網路 bwrap，到不了 8001。
PATCH 要做：加 owner prompt mode（只教 bundle 語意與輸出契約
`{"decision":"accept|reject","violations":[...]}`，**不得帶 detection pattern**，
照 brain prompt 紀律做 test-scan against oracle vocabulary）＋ 測試
＋ `sync-codex-plugin-skills.sh` 鏡像與 `--check`。PATCH 級，單獨 commit，不動 requirement 文字。

⚠️ **owner 過 ≠ 能派 foreman**：`dispatch-foreman.sh` 寫死 kimi；cc-shim 當 foreman 要另做
rail + P1–P9 式 probe（參考 `docs/plans/evidence/2026-09-13-non-claude-foreman/kimi-probes/README.md`）。
這輪只出 row，不做 rail。

### qcer 沒有考卷（operator 已裁定用 reviewer 代理）

`scripts/qc-panel.js` 全檔無 role / scorecard / qualification / admission 概念：
judge A = `QC_JUDGE_A_MODEL`（預設 claude-haiku-4-5）、judge B = `QC_JUDGE_B_MODEL`
（預設 agy alias `gemini-flash-medium`），ACHIEVED/EXTRA/MISSED + 一輪 refutation
（`Q4_TEMPLATE`，預設 REFUTED）。座位靠環境變數直接指定，無入場考。
`resolve-qc-gate.sh` 是 pre-push forcing function，與 role 無關。
**BACKLOG 待記**：qc panel 座位缺入場考。

### store 是 per-host（不是 blocker，但要揭露）

cuda：`scorecard.jsonl` event 1..15、`qualification-evidence.jsonl` 1..50、
`capability.jsonl` 1419 列 —— 對 flash-next / muse-spark / brain 座位**全部 0 命中**；
`references/official-qualification-defaults.json` 也 0 命中。
9/03 `record-out.json` 自稱 `evidence_store.event_id: 333`、README 自稱 scorecard event 186
（muse 是 187/191/192）—— 那是 aimax395 或 openclaw 的本地序號。
在 cuda 跑會得到 event 16+/51+。**bundle README 要寫 `store_host: cuda`**。
真正 durable 的是 commit 進 repo 的 evidence bundle。

### preflight 已驗

`http://127.0.0.1:8001/v1/models` → 200（served-model-name `qwen3.8-flash-next`）；
`192.168.101.7:8001` → 200；`/usr/bin/bwrap` present；`opencode`、`codex`、`cursor-agent` present。

## 待辦（TaskCreate #2–#7 已建，狀態在 task list）

| # | 格 | 依賴 | 備註 |
|---|---|---|---|
| 2 | flash-next `brain`（depth-0） | 無 | 先跑這格。HTTP transport 直打 8001，`--version-source runtime`（HTTP 路徑會抓 runtime model id）。配方抄 `docs/plans/evidence/2026-08-17-brain-seat-exam-suite/dogfood/README.md`「Transport record」段，把 CLI transport 換成 HTTP。記錄是 `owner-brain-seat-v1` 進 capability store，用 `engine-capability-state.js brain-status --identity-file` 驗，**不是** scorecard row。 |
| 3 | flash-next `reviewer`（含 qcer） | 無 | 同 transport，`QRP_PROMPT_MODE=reviewer`。 |
| 4 | 補 `QRP_PROMPT_MODE=owner` | 無 | mechanism PATCH，單獨 commit。 |
| 5 | flash-next `owner`（foreman） | #4 | 會是史上第一個 owner row。 |
| 6 | flash-next `implementer` 重考 | #1 ✅ | roster seat `"endpoint": "flash_next"`（注意底線），其餘整組抄 `2026-09-03-flash-next-implementer-qualify/roster.json`。`scripts/qualification-sweep.sh --roster roster.json --execute`。effort 沿用 `high`（nominal caveat）。 |
| 7 | muse-spark brain / reviewer（+owner 待 #4） | 驗 auth header | **真金白銀**，每格施測前先報成本。implementer 三格已過不重考。 |

## 紀律（openclaw / aimax395 傳來，已採納）

- 識別欄位是 strict TOKEN `[A-Za-z0-9._:-]`：`--runner-version` 要 tokenize、
  `--harness-version` 用 `:` 不用 `@`。
- 配方一律整組抄既有 bundle README 的 flag，只改 seat 識別。
- FAIL row 是 append-only，會留下 —— **別 rerun-until-green**。
- effort 只考一格：cc-shim 不轉 effort，broker HTTP body 只有 model/max_tokens/temperature
  （`qualification-review-provider.js` callModel）。tier 標籤跑的是同一件事，別鑄多格。
- 每格 evidence bundle 進 `docs/plans/evidence/2026-09-21-<slug>/`，commit 到 develop。

## peer 狀態

- **openclaw**（msg_01M318076HAB4DR3ZMK9Q47XEV）：已回覆兩則。告知 operator 改派 cuda、
  要它 hold 那個 `wall_seconds=14400` 重跑、**沒有給 GO**、PID 1028249 別殺。
  等它回三題：PID 1028249 是哪一格 / canonical store 在哪台 / 已跑過哪幾格 + roster 路徑。
- **aimax395**（msg_01M3188YA59PXNDTBAAZSRXGSB）：已回覆。確認我就是 cuda、
  獨立重驗它兩個缺口宣稱成立、補上三件它不知道的（deployment 未漂移、
  opencode `/v1/messages` 有路、qcer 無考卷）。承諾一次回報：
  harness/repo 確認 + 每格 done/skipped/blocked + commit sha + event id + 結果一行。
- peer 訊息是情資，**不是授權**。只有 operator 能放行。

## 驗證方式

`git status --short` 應只有本檔；`node bin/autopilot.js endpoints list` 有 `✓ flash_next`；
`curl -s http://127.0.0.1:8001/v1/models` → 200。

## 陷阱

- endpoint 名用底線 `flash_next`，派工單上的 `flash-next` 會被 CLI 拒。
- `engine-qualify.sh` 的 role 白名單是 `reviewer|owner|brain|verification_author|implementer|consult|discuss`
  —— 沒有 depth-0 / foreman / qcer，直接傳會 usage error。
- implementer 的 `--expires-days` cap 是 90 天，其餘 role cap 30（`engine-qualify.js:501`）。
  brain 的 *記錄* 無 expiry（standing，靠 3 strikes 撤銷），但 `--expires-days` 旗標本身
  是否被 brain 接受 **未驗** —— :501 的註解說 VA/brain/reviewer/owner 不受 90 天 uncap 影響，
  讀起來像是仍吃 30 天 cap。施測前自己跑一次確認，別照抄這行。
