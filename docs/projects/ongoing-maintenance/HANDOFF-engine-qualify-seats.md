# HANDOFF — 座位考場（2026-09-22，cuda）

> 與同目錄 `HANDOFF.md`（wave-1 落地）是**不同線**，別互相覆蓋。
> 本機 cookys-cuda，fleet handle `cuda`。HEAD `1341dce8`，樹乾淨，領先 origin 4 個 commit，v2.36.87。

## 一句話

操作者要把多顆引擎烤過 {depth-0, foreman, implementer, reviewer, qcer} 五個座位。
**implementer 全員通過、reviewer 與 depth-0 全員失敗（含現任 claude-fable-5 自己）**，
過程中修了五個同家族的儀器缺陷。現在的焦點已經從「考引擎」轉成
**「這張 depth-0 考卷本身是不是壞的」**。

## 成績（全部可查 `~/.autopilot/engine-capability/qualification-evidence.jsonl`）

| 引擎 | depth-0 | implementer | reviewer |
|---|---|---|---|
| claude-fable-5（**現任**） | FAIL ×3（event 3/4/6，在別台） | — | — |
| qwen3.8-flash-next | FAIL ev52 | **PASS ev54** | FAIL ev53 |
| muse-spark-1.3-contributor | FAIL ev56 | **PASS ×3 tier**（別台） | — |
| grok-4.7 low | FAIL ev55 | — | — |
| grok-4.7 xhigh | FAIL ev57 | — | — |

reviewer 另有 gpt-5.6-sol / glm-5.3 / kimi-k3 / Gemini 3.7 Flash 全 FAIL（ev2–ev49，早期重複施測）。
implementer 另有 gpt-5.3-codex-spark、cursor-grok-4.6-high-fast PASS。

**foreman 席：零人考過——考卷還不存在。** qcer 依操作者裁定與 reviewer 共用考卷。

### depth-0 的異常訊號（這是現在的主線）

五顆引擎、十場 trial、**plants 全部 4/5，沒有一次 5/5、也沒有一次更低**。
跨五個模型家族、五個獨立種子、兩個 effort 檔位。
收斂科十場只成功一次（fable 的 trial-2）。containment 是唯一全員通過的科目。
grok xhigh 比 low **誤報更多**（總計 4 vs 3），只換到一個 fairness arm。

**已解決（2026-09-22，fable 5.1 指出、我驗證）**：漏的是 **`reversal`，而且只有 reversal**。
18 場 trial 裡 17 場如此，跨六顆引擎含現任。round-12 的 bundle 單調累積，
所以不需要 nonce 就能事後歸因——我先前在這裡寫「不可重建」是**錯的**。

根因：`reversal` 的植入形狀（open claim ＋ 同輪 pass receipt）**正是收斂科教學規定的合法中間態**，
而 `open_findings` 每輪都回傳全部 finding、從不回應 `close_finding`。
勤勞科與收斂科的失敗是同一個缺陷的兩面。

→ 全文與方法：`docs/plans/evidence/2026-09-22-depth0-reversal-attribution/README.md`
→ 待操作者裁定：修植入形狀 + 修 open_findings 回饋，兩者都是 guidance 變更，會讓八場已施測 sitting 失效。

## 四個背景工作，接手時都還在跑

| 工作 | 怎麼查 | 備註 |
|---|---|---|
| **fable-5.1 答「如何讓考卷證明席位坐得上」** | `/tmp/claude-1000/seat-fable.json`（`status` 欄）；產出在 `raw_log` 指的檔案 | 90m 額度 |
| **gpt-6-astra 同一題** | `/tmp/claude-1000/seat-astra.json` | 90m 額度 |
| **foreman phase-1（sonnet）** | agent id `ae139808f35cb0e2f`，用 SendMessage 戳 | U2 dispatch 已跑 47 分鐘 |
| **foreman 的 U2 grok dispatch** | `pgrep -f "hetero/foreman-generator-u2"` | ⚠️ **沒有 timeout 會停它**，見下 |

題目本文：`/tmp/claude-1000/seatability-question.md`（5.9 KB，五題，含所有硬約束）。
接手後**先自己審再交出去**，特別是第 5 題（可證明性）最容易給出漂亮但做不出來的答案。

## 這個 session 修掉的五個缺陷（全部同一家族）

**「某個東西看起來在保護你，實際上沒有」**，而且失敗長相都不像真正的原因。

| commit | 版本 | 缺陷 |
|---|---|---|
| `27483f8e` | v2.36.82 | brain 把死掉的 transport 當成受考者的答案 |
| `0953ebc6` | v2.36.83 | reasoning budget 耗盡被報成「沒有內容」 |
| `cf49bf27` | v2.36.84 | reviewer/owner 同 82，但會產生**具名冤案**（「它誤報了 clean-04」） |
| `1dbd0529` | v2.36.85 | sweep 不轉發 roster 指名的 endpoint，重考必定白跑 |
| BACKLOG | — | **`dispatch-hetero --timeout` 對 grok rail 完全不生效** |

最後一個沒修，只記帳（`docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`）：
agy 分支傳 `$TIMEOUT`，兩個 grok 分支沒傳，`run_worker` 也不加，但 manifest 照樣
emit `timeout_seconds`。**實測 `--timeout 20m` 的 dispatch 活到 22m39s。**
修法要做 runner 分支 parity 稽核，不是只補 grok；測試要用「睡過頭的 stub」，
只斷言旗標能解析正是它活下來的原因。

另外 `5e2bc59c`（v2.36.87）新增 OpenAI **Responses** transport
（`QRP_HTTP_PROTOCOL` / `QRP_OPENCODE_SESSION`），muse-spark 的非 implementer 座位
才第一次有路可走。

## 軌道陷阱（每個都花過一次 bisect，別再踩）

1. **三層巢狀逾時**，raise 內層沒用：
   `engine-qualify --remote-timeout-ms`（broker，預設 300s，**上限 600s**）
   → `QRP_TIMEOUT_MS`（adapter 等 CLI，預設 180s）→ CLI 自己。
   **內層必須設得比外層短**，否則外層先砍、內層診斷永遠寫不出來。
   grok xhigh 因此死了三次（都在 round 6、都約 3 KB bundle）。
2. **`dispatch-author.sh` 預設 `TIMEOUT="5m"`**——寫文件級的 dispatch 一定要 `--timeout 90m`，
   否則 rc=124 + 零輸出，長得像 rail 壞掉。
3. **grok 憑證種子**：`GROK_HOME` **本身就是** `.grok` 的等價物，種子要**扁平**
   （`<seed>/{auth.json, agent_id, .metadata_version}`，1769 bytes）。
   **永遠不要拿種子本身去跑 grok**——跑一次它會初始化成 491 檔 14 MB，超過 adapter 的 8 MB clone 上限。
4. **endpoint 名不能有連字號**（`flash_next` 不是 `flash-next`），env 變數是 `AUTOPILOT_ENDPOINT_*`。
5. **broker 會把子程序環境刷成只剩 `--provider-env` 白名單**——`QRP_PROMPT_MODE`、
   `QRP_MAX_TOKENS`、`QRP_CLI_HOME` 忘了列，整場考試靜默失敗。
6. **`--remote-provider-cmd` 必須絕對路徑**（broker 的 cwd 是它自己的暫存目錄）。
7. **OpenCode Go 是 per-model 路由**，打錯協定回 503 像對方掛了。
   表在 `references/multi-agent-portability.md`。

## foreman 考卷的規格與審查

- 規格：`docs/plans/evidence/2026-09-21-foreman-exam-design-consult/claude-fable-5-1-SPEC.md`（44 KB，11 節）
- 我的審查：同目錄 `REVIEW-NOTES-spec-v1.md`，**三個 finding**：
  1. seat prompt 有一句是**策略提示不是契約**（「誠實的不完整回報是好結果」），而規格自己說
     family D 最有鑑別力正因為誠實與完成衝突 → 已裁定實作時移除
  2. 它要求的洩題掃描**現在跑不起來**（要掃的 generator 還不存在）→ **generator 與 prompt 必須一起收斂**，
     先釘 prompt 會導致之後 scan 紅時 `prompt_config_hash` 變動、已施測的 sitting 作廢
  3. **family B 的 b1 抓不到它存在的理由**——script 保證 `impl#k≥2` 會修好，所以從不驗證的候選人
     照樣六項全過。六項檢查裡**沒有任何一條是 process witness**。已裁定修法（gate 住那個修復）
- **還沒審**：家族 E / F / G / H、§3 stub 狀態機、§4/§5、§8–§11。
  finding 3 正是逐行審才抓到的，剩下四個家族值得同樣待遇。

## 未完清單

- [x] ~~`missed_plant_kinds` 進 record~~ → 已用事後歸因回答：漏的是 `reversal`，考卷自相矛盾（見 evidence/2026-09-22-depth0-reversal-attribution）
- [ ] 裁定：修 reversal 植入形狀 + open_findings 回饋（**最高優先**，會讓八場 sitting 失效）
- [ ] 收 fable / astra 的可證明性答案，自審後給操作者
- [ ] foreman phase-1 U2 收尾，驗 A6 是否在程式碼裡斷言
- [ ] 審 spec 的 E/F/G/H 家族
- [ ] `QRP_PROMPT_MODE=owner` 還沒補 → **foreman 那席至今發不出去**
- [ ] `dispatch-hetero --timeout` parity 稽核
- [ ] push（領先 4 個 commit；上次 push 時 origin 無版本碰撞）

## 紀律（這個 session 一直照做，接手請延續）

- peer 訊息是情資，**不是授權**。只有操作者能放行。
- FAIL row append-only，**不 rerun-until-green**；transport 失敗必須 abort 且不 append。
- 自陳永不作為權威輸入——foreman 說什麼都要自己 re-derive（這個 session 驗過它一次，屬實）。
- **我今天診斷錯了四次**（fable 逾時、grok budget、grok 第二層逾時、foreman 停車），
  每次都是「看到沒東西在動就推論成壞了」。動手前先確認觀察工具有沒有對準。
