# Local GPU models as team seats: qualification prep (2026-11-08)

Self-exam of two locally served vLLM models for the roles implementer, reviewer, verification_author, consult.
Sections 1 to the end were written in advance (dry-run only, see `dry-results.txt`). The live results are in "2026-11-08 正式結果" at the end; the cells were then sat on 2026-11-08 and the rows below are from `out/`.

## Deployments (pin, per local-model-team-recipe.md step 4)

| lane | endpoint name | URL | served id (verbatim `--model`) | max_model_len | parsers | window |
|---|---|---|---|---|---|---|
| qwen | `qwen_local` | `http://<private-ip>:8001` | `Qwen3.8-27B-QUASAR-NVFP4` | 262144 | tool `qwen3_coder`, reasoning `qwen3` | ready about 05:30Z |
| glm | `glm_local` | `http://<private-ip>:8000` | `GLM-5.3-Flash-NVFP4` | 1048576 | tool parser **unconfirmed**, reasoning parser unknown | 06:30-09:00Z only |

Both vLLM; `/v1/messages` (Anthropic, tool_use) and `/v1/chat/completions`; no auth in the trial period; overload or unhealthy
answers 503 with Retry-After. Checkpoint revision and vLLM build are not recorded yet: fill them in here before the first row is
recorded (the seat identity hashes the model token, not the weights). Endpoint addresses are redacted per leak-guard; the real values live in the host endpoints config (`endpoints.env`). Endpoints are defined in `~/.autopilot/endpoints.env`
(keys `AUTOPILOT_ENDPOINT_{QWEN,GLM}_LOCAL_{URL,TOKEN,TRANSPORT}`, token placeholder, transport `plaintext-private`, mode 600; not in the repo).
Until the endpointenv lane merges, `resolve-endpoint.sh` does not read that file by itself: always
`source scripts/load-endpoints-env.sh && autopilot_load_endpoints_env` first (every cell does).

## Health check (run before each cell; 200 expected)

    curl -s -o /dev/null -w '%{http_code}' http://<private-ip>:8001/v1/models
    curl -s -o /dev/null -w '%{http_code}' http://<private-ip>:8000/v1/models

503 = overloaded or unhealthy: wait for Retry-After, do not start a cell. A non-200 live ping also makes the cell exit rc=2 before any case is sent.

## Cells (all from repo root; per-cell provenance in `cell-local.sh` header)

| cell script | runner | model (served id) | effort label | what is sent | recipe source |
|---|---|---|---|---|---|
| `cell-<lane>-reviewer.sh` | `anthropic-compatible` (HTTP Messages via `qualification-review-provider.js`, `QRP_HTTP_PROTOCOL=messages`) | served id | `default` | no `output_config.effort` (effort_check=match) | `2026-10-14-reviewer-requalify-minimax-glm-qwen/cell-msg-rv6.sh`, `cellx2.sh` |
| `cell-<lane>-implementer.sh` | `cc-shim` (`engine-qualify.js implementer --endpoint <name>`) | served id | `high` (nominal; cc-shim forwards nothing, and `default` is rejected by the cc-shim argv enum) | nothing | `cellx.sh` minimax31 branch, `local-model-team-recipe.md`, `2026-09-03-flash-next-implementer-qualify/` |
| `cell-<lane>-author.sh` | `anthropic-compatible` | served id | `default` | nothing | `cellx2.sh` (verification_author, the shipped provider now passes unparseable replies through to be graded, so no patch wrapper) |
| `cell-<lane>-consult.sh` | `anthropic-compatible` | served id | `default` | nothing | `cellx2.sh` (consult, `--execute`); stands in for summarisation-type work |

`<lane>` is `qwen` or `glm`. Output lands in `out/<lane>-<role>/` (`run.log`, `stdout.json`, `stderr.log`, `raw/`, `rc`, `emit-row.json`).
rc: 0 pass, 1 fail verdict, 2 precondition, 124 wall timeout. The fingerprints are derived by `derive-local.js` (adapted from `derive-matrix.js`;
results in `identity/`); implementer fingerprints are the pinned corpus hashes (re-verified equal to the current `evals/impl-*` files).

### Effort evidence

Upstream vLLM `main` (`vllm/entrypoints/anthropic/protocol.py`: `AnthropicOutputConfig.effort: Literal[low,medium,high,xhigh,max]`;
`serving.py`: `req.reasoning_effort = output_config.effort`) maps `output_config.effort` to `reasoning_effort`. So an effort variant
(`QRP_HTTP_EFFORT=high`, `--effort high`, add `--provider-env QRP_HTTP_EFFORT`, as `cell-msg-rv6.sh` does) is plausible, but that is the
upstream source as read on 2026-11-08, **not verified against the deployed vLLM build or the served chat template**. First pass stays `default`.
If you later add an effort cell, run the `capture-effort.js` plus live ping pair first (the cell already does both for `default`).

## Order and estimated wall time (estimates are 未證實 guesses from other bundles; wall caps are the real limits)

Per model: **reviewer, then implementer, then author, then consult.** One cell at a time on a model (single GPU slot, 503 under load).
qwen starts when its health check is 200 (about 05:30Z). glm only inside 06:30-09:00Z: start with the reviewer as soon as the window
opens; if the window cannot hold the next cell, stop and resume the next day rather than start it.

| cell | estimate | wall cap (`timeout`) |
|---|---|---|
| reviewer | 30-90 min | 18000 s |
| implementer | 10-15 min (flash-next: 24 cases in 371 s dispatch on a similar local model) | 10800 s |
| author | 30-60 min | 10800 s |
| consult | 60-120 min | 21600 s |

Commands:

    bash docs/plans/evidence/2026-11-08-local-models-qualify/cell-qwen-reviewer.sh
    bash docs/plans/evidence/2026-11-08-local-models-qualify/cell-qwen-implementer.sh
    bash docs/plans/evidence/2026-11-08-local-models-qualify/cell-qwen-author.sh
    bash docs/plans/evidence/2026-11-08-local-models-qualify/cell-qwen-consult.sh
    # glm: same four with cell-glm-*.sh

Run each detached (`setsid nohup ... &`, wait on `out/<lane>-<role>/rc`); a cell over 5 minutes must not run in the foreground.
Dry run (no network): `DRY_RUN=1 bash cell-<lane>-<role>.sh`, or `bash dry-all.sh` for all eight.
Reviewer/author dry runs end rc=1 by design (the fake provider cannot answer; argv was accepted); consult and implementer end rc=0.

## Collecting results

1. Read `out/<lane>-<role>/emit-row.json` and `stderr.log`; check `effort_check` is `match` (broker roles) and `rc`.
2. Record on the team account (local self-exam, direct record allowed): `bash record.sh <lane> <reviewer|implementer|author|consult>`
   (wraps `node scripts/engine-scorecard.js record --file out/<lane>-<role>/emit-row.json`). Failed rows are append-only: never delete, re-run into a new output.
3. Append the served checkpoint revision and vLLM build to the deployment table above.

## Unverified / no precedent

- Local vLLM served ids as `--model` for reviewer/author/consult over `QRP_HTTP_PROTOCOL=messages`: no previous bundle (precedents are cloud vendors); the `/v1/messages` shape on vLLM is untested by us.
- `QRP_MAX_TOKENS=32768` for all broker roles (copied from the thinking-model precedent); a 262144 context may allow more, a thinking parser mismatch on GLM is unknown.
- GLM tool parser unconfirmed: the implementer cell needs working tool_use, so a GLM implementer failure may be a parser problem, not the model.
- Implementer `--harness-version dispatch-hetero:7481ead3` is copied from the minimax31 cell, not recomputed.
- Time estimates above.

## 2026-11-08 正式結果

### 正式列（可作為資格依據）

qwen reviewer：模型 `Qwen3.8-27B-QUASAR-NVFP4`，runner `anthropic-compatible`，effort `default`，endpoint `qwen_local`，
chat thinking 協定（`THINK_PROTOCOL=chat`，`response_format=json_schema`），server 預設取樣（1.0 / 0.95 / 20，來源不是 `out/`：這三個值未記錄在 `out/` 檔案中，出處是 develop 已合併的 qrpsamp，commit 11eb18a29，provider 開 thinking 時不再送 temperature 0，改用 server 的預設取樣），
autopilot develop `046f7fcde4974f45491f5be31b661974fd9ce6f2`，cell 目錄 `out/qwen-reviewer-think-rf-formal/`（腳本 `cell-local-rf-formal.sh`）。

| 項目 | 值（皆已與 `out/qwen-reviewer-think-rf-formal/emit-row.json` 逐項核對） |
|---|---|
| status | qualified |
| corpus_pass | 42/42 |
| false_pass_critical | 0 |
| specificity（cleanFalse/cleanTotal，越低越好） | 0/38 |
| repeated_trials | 2 |
| 題數 / total_wall_s / total_tokens | 82 / 417.305 / 229929 |
| 起訖 | 2026-11-08T17:41:31Z 至 17:48:35Z（run.log 為 +08:00 的 01:41:31 至 01:48:35） |
| evidence_store.event_id | 15 |
| evidence_id | 45d2727dc900272c80eb31524b388426fb84778ed03aa485cc1dfd07e7359ef7 |
| effort_check | match（default，未送 output_config.effort） |
| scorecard record 事件（`record-out.json` 的 `event_id`） | 12 |

核對註記：簡報寫的 "scorecard event_id 15" 在檔案裡是 `evidence_store.event_id`（證據庫事件）；寫進 scorecard 的 record 事件是 12（`record-out.json`），兩者不同，不要混用。

### 全部 cell 一覽（取自各 cell 的 `emit-row.json`）

| cell（`out/` 子目錄） | role | status | 關鍵數字 | 備註 |
|---|---|---|---|---|
| qwen-reviewer-think-rf-formal | reviewer | qualified | 42/42，fpc 0，spec 0/38，82 題 417 s，229929 tok | 正式列，見上 |
| qwen-reviewer-think-rf | reviewer | qualified | 42/42，fpc 0，spec 0/38，329.5 s | 非正式預考：provider 取自 qrpschema 尖端 1a5cbebb7（當時未進 develop）；未寫入 scorecard |
| qwen-reviewer-think | reviewer | failed | 34/42，fpc 0，spec 0/38 | thinking 重考（未用 json_schema）；已記入 scorecard（event 11） |
| qwen-reviewer | reviewer | failed | 32/42，fpc 0，spec 16/38，74.8 s | 無 thinking 的首考；已記入（event 3） |
| qwen-verification_author-think | verification_author | qualified | 24/24，fpc 0，spec 0/24，100.3 s | 已記入（event 10） |
| qwen-verification_author | verification_author | failed | 20/24，spec 4/24，38.3 s | 無 thinking 首考；已記入（event 4） |
| qwen-consult | consult | qualified | 60/60，全部違規欄 0，37.0 s，67167 tok | 已記入（event 2） |
| qwen-implementer | implementer | qualified | 24/24，fpc 0，336.9 s | cc-shim，effort medium；已記入（event 5） |
| glm-reviewer | reviewer | failed | 39/42，fpc 0，spec 0/38，367.8 s，135107 tok | 已記入（event 9） |
| glm-verification_author | verification_author | qualified | 24/24，spec 0/24，86.4 s | 已記入（event 8） |
| glm-consult | consult | qualified | 60/60，全部違規欄 0，229.1 s | 已記入（event 7） |
| glm-implementer | implementer | failed | 23/24，fpc 1，integrity_violations 1，339.6 s | GLM tool parser 未確認，失敗可能來自 parser 而非模型；已記入（event 6） |

fpc = false_pass_critical。

### 作廢或非考試的列（失敗列只能附加不能刪，所以保留小檔）

| cell | 為什麼作廢 |
|---|---|
| qwen-implementer-r1-effort-high-adminfault | 施測錯誤：cc-shim 會轉送 effort，`high` 讓 qwen_local 回 HTTP 500（該 endpoint 接受 xhigh、medium、low），24 題全數 contract_violations，0/24 不代表模型能力。改用 medium 重考得 24/24（qwen-implementer）。 |
| qwen-reviewer-think-pingcheck-wrongfield | rc=3：live ping（status=200、finish=stop、output_tokens=28）的判定是 `thinking_protocol=chat thinking_content_present=false`，run.log 記「thinking not on in the ping (gpu-lead rule 01M6WSEJFR): not sitting the exam」，沒有送任何題目，沒有 emit-row。這個 cell 沒有留下能說明 ping 為何判成 false 的檔案，git 歷史也找不到對應的提交，所以不寫原因；之後的 think / rf / formal 取代它。 |
| qwen-reviewer-think-r1-budget32k | thinking 重考的早期嘗試（QRP_MAX_TOKENS 32k），`transport_fail` 列（沒有可判定的結果），之後的 think / rf / formal 取代它。 |
| dry-* | `DRY_RUN=1` 只驗參數層，沒有網路；reviewer 與 author 的 dry 列依設計是 `transport_fail`（假 provider 答不出來）。 |

這些列的 `raw/` 原始串流（每個 cell 約 140 KB）沒有放進證據包；判定只需要 `emit-row.json`、`stdout.json`、`run.log`、`rc`、`record-out.json`。`qrp-lenient.js`（來源已刪除）與 `*.bak.*` 備份檔也沒有帶。

`cell-local-think.sh`、`cell-local-rf.sh`、`cell-local-rf-formal.sh` 是照原樣保存的施測腳本，保存的腳本與 log 已遮蔽家目錄路徑與內網 IP，QRPT 改為預設 repo 根目錄，其他內容不變；檔頭的「QRP_MAX_TOKENS 65536」與「chat 無法加 chat_template_kwargs、rc=2」是較早的描述，實際預設為腳本內的 `${THINK_MAX_TOKENS:-32768}`，chat 路徑也能開考；為保持證據一致不改腳本。重跑腳本會覆寫 `out/` 下同名目錄，重跑要另開輸出目錄（照失敗列只能附加的規則）。
