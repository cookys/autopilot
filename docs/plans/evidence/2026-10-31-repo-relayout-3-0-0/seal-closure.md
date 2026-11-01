# 封存閉包盤點（唯讀）

- 範圍：autopilot develop，HEAD ca97d97b3。
- 依據：plan.md §1、§3、§4、F1 到 F5，加 addendum-c.md D8。
- 全部指令都唯讀。沒有跑任何 hooks/tests/*.test.sh 或 run.sh。跑完 `git status` 沒有新增修改。
- 「基準紅」是指搬家前就已經紅。每個階段要比對的是「紅的集合沒有變」，不是「全綠」。

## 先講三個會卡住搬家的結構事實

1. **sources manifest 的路徑解析基準是 manifest 自己所在的目錄，而且路徑必須留在那個目錄底下。**
   - 位置：`scripts/mission-execution-graph-check.js` 的 `loadSourceCoverageManifest`。
   - 現況：manifest 在 `docs/`，`plan_path` 寫 `plans/...`，所以成立。
   - 計畫把 manifest 搬到 `project/missions/`、plan 搬到 `project/plans/`。這樣 `plan_path` 會變成 `../plans/...`，檢查器會直接拒絕（`must stay under the manifest root`）。
2. **sources manifest、task-authority 都沒有被任何東西雜湊。** 雜湊只掛在 plan、rubric 檔位元組，以及 graph 的正規化內容上。
   - 所以搬 manifest 本身不需要後繼物件。要處理的只有路徑解析規則。
3. **有 5 個 repo 檔被 evals 的凍結檢查直接雜湊（rail digest）。** 另有兩個 legacy FROZEN 的鍵寫成 `../../hooks/tests/...`。P3、P4 搬這幾個檔會讓對應的列失效。

## 物件逐項

### O1 mission sources manifest 與它引用的 plan、rubric
1. 路徑：`docs/mission-*-sources.json`，共 43 檔。
2. 引用：55 個 source 項，共 110 個引用、100 個不重複檔（plan 與 rubric 各半）。其中 50 檔在 `docs/plans/_archive/`，50 檔在 `docs/plans/` 根。10 個檔被多份 manifest 共同引用。
3. 雜湊持有者：manifest 內每項的 `plan_sha256`、`rubric_sha256`，雜湊對象是被引用檔的位元組。manifest 自己沒有被雜湊。
4. 解析基準：相對 manifest 所在目錄（目前是 `docs/`），不可跳出該目錄。
5. 檢查器：
   - `node scripts/mission-execution-graph-check.js --graph <g> --governance .claude/owner-kernel-governance.json --sources <s>`。
   - `node scripts/lib/sealed-docs.js` 的 `sealedDocFiles()` 回傳受保護清單，共 138 檔（plan 與 rubric 100、graph 34、eval 規格 4）。
   - `node scripts/check-plan-graduation.js --json`：現在 rc=0，只有 1 條 `plan_active_lineage` 提示。
6. 階段：manifest 在 P1 進 `project/missions/`；plan 與 rubric 在 P1 進 `project/plans/`；「9 月前 plan 歸檔」也會搬到 `_archive`。
7. 建議：**(a)**，但要先裁決路徑基準（見末尾裁決 1）。
   - 理由：plan 與 rubric 的位元組可以不變地搬走，雜湊自然不變。manifest 沒人雜湊，改 `plan_path` 不會產生後繼物件。
   - 另一個選法是 manifest 搬到 `project/`（不是 `project/missions/`），`plan_path` 連位元組都不用改。
8. 驗證：
   - 我直接重算 110 個引用，**110/110 位元組雜湊相符**（唯讀腳本）。
   - 37 組 graph 加 manifest 跑檢查器：**29 綠、8 紅**。8 個紅是基準紅，清單在 O2。
   - 6 份 manifest 沒有對應 graph（bounded-backlog-intake、controller-execution-discipline、convergence-closeout、convergence-portfolio、repair-lineage-convergence、runtime-convergence-mvp），只能做上面的雜湊重算。

### O2 mission execution graph
1. 路徑：`docs/mission-*-execution-graph.json`，共 37 檔。
2. 引用：圖內字串帶路徑，例如 `output_paths`、`verification_commands`、`allowed_path_prefixes`、`campaign.spec.path`（共 43 個 spec 路徑，指向 `docs/plans/...`）。這些路徑是歷史文字，圖本身不會去讀它們。
3. 雜湊持有者：
   - 12 檔自帶頂層 `graph_digest`，對象是 graph 的正規化內容（不是檔案位元組）。
   - 22 檔沒有 `graph_digest`，由對應 task-authority 的 `mission_graph_digest` 釘住。
   - 3 檔兩者都沒有，不在受保護清單。
4. 解析基準：不適用（圖內路徑是字串）。唯一會讀路徑的是 `checkSpecPlanRegistration`：只認字面 `docs/plans/<stem>.md`，路徑變了就悄悄略過，不會紅。
5. 檢查器：同 O1 的 `mission-execution-graph-check.js`。
6. 階段：P1，搬到 `project/missions/`。
7. 建議：**(a)**，位元組不變地搬。
   - 理由：改圖內任何路徑都會讓 `graph_digest` 不符。圖搬走後，檔案本身仍然有效。
   - 重寫工具（relayout 產生器、check-plan-graduation 的寫入模式）必須跳過這些檔，目前 sealed-docs 已涵蓋 34 檔。另外 3 檔不受保護，產生器要自行排除所有 `mission-*-execution-graph.json`。
8. 驗證：已跑。**基準紅 8 組**：
   - 圖的摘要與內容不符：backlog-actionable-successor、plan-review-codex-trusted-cwd-fix、qualification-verdict-stability、reviewer-output-token-budget-successor、skill-transport-implementer-arm。
   - 驗證指令不符現行規則：codex-payload-residual-spike、codex-payload-residual-spike-successor、hook-test-harness-determinism。
   - 搬家後這 8 組必須仍然是同一批紅，其餘 29 組必須仍然綠。

### O3 task-authority envelope
1. 路徑：`docs/mission-*-task-authority.json`，共 23 檔。
2. 引用：不引用檔，只帶摘要欄位。
3. 雜湊持有者：`mission_graph_digest`、`mission_policy_digest`、`policy_hash`。
4. 解析基準：不適用。`sealed-docs.js` 靠檔名把 `-execution-graph.json` 換成 `-task-authority.json` 找配對，所以兩者必須同目錄、同 slug。
5. 檢查器：沒有獨立檢查器。程式碼只有 `next-touch-validation.js`、`dispatch-local-openai.js` 會讀 envelope 結構。
6. 階段：P1，隨 graph 搬到 `project/missions/`。
7. 建議：**(a)**，位元組不變，與 graph 同目錄。
8. 驗證：我拿每份 authority 的 `mission_graph_digest` 去比檢查器算出的 graph 摘要，**10 份相符、13 份不符**。這 13 份是基準不符，代表它們本來就不能被重新推導，只能當歷史紀錄。搬家驗證只能做「位元組雜湊不變」。

### O4 現行 mission 的路由綁定
1. 路徑：`.claude/mission-routing-config.json`，指向 `docs/mission-blind-review-2d-snapshot-2026-09-19-{execution-graph,sources}.json`。
2. 引用：1 組 graph、1 組 sources，加上 sources 引用的 plan `2026-09-19-blind-review-2d-overlap`（plan 與 rubric）。
3. 雜湊持有者：session 啟動時算出的 admission 摘要（`sources_digest`、`mission_graph_digest`）。這些是內容摘要，不含路徑。
4. 解析基準：相對 repo 根。
5. 檢查器：`check-plan-graduation.js` 的 `plan_active_lineage`。目前它把這份 plan 列為「現行活躍譜系」，不讓它被歸檔。
6. 階段：P1。
7. 建議：**(b)**，這一組（graph、sources、authority、plan、rubric 共 5 檔，加上同 stem 的 plan-review-manifest 共 6 檔）留在 `docs/` 原位，寫進登錄表逐檔例外，等 mission 做終局退場後再搬。
   - 理由：活躍 admission 還在引用，搬了會讓執行中的 session 失去路由。
8. 驗證：`check-plan-graduation.js --json` rc=0，已跑。退場流程沒有跑（會寫檔）。

### O5 eval 規格封存（seal.json）
1. 路徑：`evals/{consult,discuss}-eval-rubric.seal.json` 與 `evals/{consult,discuss}-capability-evidence-corpus.seal.json`，共 4 檔。
2. 引用：各 1 檔，即 `spec_path` 指向的 rubric `.md` 或 corpus `.json`，都在 `evals/`。
3. 雜湊持有者：seal 的 `spec_sha256`。另外 `scripts/lib/qualification-asset-seals.js` 把 6 個資產各釘一個常數，包含兩個 seal 檔自己的合併摘要（`EXPECTED_*_SEAL_HASH`）。
4. 解析基準：seal 內 `spec_path` 相對 repo 根；`qualification-asset-seals.js` 用 `REPO_ROOT/evals/...` 組路徑。
5. 檢查器：
   - `node scripts/rubric-freeze.js check <spec> <seal>`（4 次）。
   - `qualification-asset-seals.js` 的 `checkAssetSeals('consult'|'discuss')`。
6. 階段：無。`evals/` 依計畫原位。
7. 建議：**(b)**，整個 `evals/` 在白名單原位，不需要逐檔例外。
   - 注意：釘死檔案內文有舊路徑字串（例如 generator、grader、rubric 內的 `scripts/...`、`docs/...`）。P4 的全域改寫器必須跳過這批檔，否則會改到位元組。
8. 驗證：已跑，4 次 `rubric-freeze check` 全部 rc=0（FROZEN），`checkAssetSeals` consult 與 discuss 都通過。

### O6 engine-qualify 對 evals 檔的雜湊釘
1. 路徑：`scripts/engine-qualify.js` 內 16 個 `EXPECTED_*_HASH` 常數。
2. 引用：14 個 `evals/` 檔（reviewer、impl、va、brain、owner 的 generator、grader、corpus、driver、state），另 2 個是 canonical JSON 摘要。
3. 雜湊持有者：`engine-qualify.js` 的常數。
4. 解析基準：`REPO_ROOT/evals/...`。`REPO_ROOT` 由腳本位置往上算，P4 搬腳本時要同步改。
5. 檢查器：`engine-qualify.js` 每次呼叫時的 `verifyPinned*EvaluationAssets()`；本次用對照雜湊重算驗證。
6. 階段：evals 檔不搬；`engine-qualify.js` 在 P4 搬到 `scripts/engine/`。
7. 建議：**(b)**，evals 檔原位不動。
8. 驗證：我把 16 個常數對 `evals/` 與 `scripts/qualification-case-broker.js` 的實際雜湊比對，**14 個對得上檔案，2 個是 canonical JSON 摘要**，這 2 個只能靠套件測試（`engine-qualify-*.test.sh`）驗，標為無法獨立驗證。

### O7 skill-onoff 預登錄凍結列與 pack 清單
1. 路徑：`evals/skill-onoff/prereg/FROZEN.json` 的 12 個 stamped 列（qs、qs-v2、qs-v3、dcard、dcard-v2、dcard-v3、gdorm、bpack、findings-batch、-v2、-v3、d0gate），加 `evals/skill-onoff/packs/manifest.json`。
2. 引用：
   - d0gate 列正好 59 檔（arms 2、candidates 1、d0gate 52、lib 1、prereg 1、campaign 與 score 各 1）。
   - 12 列合計約 470 檔，全部在 `evals/skill-onoff/` 內。
   - packs/manifest.json 記錄 560 個 pack，另有 557 筆 `pack_meta`。
3. 雜湊持有者：`FROZEN.json[<row>].files[<相對路徑>]` 是 sha256；`packs/manifest.json` 的 `packs[<id>][<檔>]` 是 sha256。
4. 解析基準：相對 `evals/skill-onoff/`（`--root` 預設值）。
5. 檢查器：`node evals/skill-onoff/stamp-prereg.js --row <row> --check`（唯讀，到達 `--check` 分支就 exit，不寫檔；仍會呼叫該列 campaign script 的 `--check-arms`）。
6. 階段：無。evals 原位。
7. 建議：**(b)**，不搬。pack 是被凍結檔的位元組副本，內含的舊 repo 路徑（例如 `sealed-docs.js` 副本）是歷史，不能改。
8. 驗證：已跑 12 列，**12 列全綠（rc=0）**。
   - packs/manifest.json 的逐檔雜湊由 `run-skill-onoff-eval.sh` 的 `verify_pack` 在跑 cell 時檢查，沒有獨立唯讀指令，標為只能靠 stamp-prereg 間接覆蓋（d0gate 等列的 `freeze_packs`）。
   - 計畫提到 59 檔的 d0gate 對上了。

### O8 skill-onoff 舊式 FROZEN 與修訂（g67、g8、amend）
1. 路徑：`FROZEN.json` 的頂層 `files`（47 檔）、`amendments`（8 項）、`stage-graph-g67`（33 檔加 amend-1 的 11 檔）、`stage-graph-g8`（28 檔）。
2. 引用：多數在 `evals/skill-onoff/`。**3 個鍵跳出 evals：**
   - `../../hooks/tests/skill-onoff-g67.test.sh`
   - `../../hooks/tests/skill-onoff-g8.test.sh`
   - `../../scripts/check-guidance-eval.js`
3. 雜湊持有者：同 O7。
4. 解析基準：相對 `evals/skill-onoff/`，含 `../../`。
5. 檢查器：
   - g8 列：`stamp-prereg.js --row stage-graph-g8 --check`。
   - g67 修訂：`node evals/skill-onoff/stamp-g67-amendment.js --check`。
   - 其餘：我寫的唯讀走訪腳本 `scratchpad/layout/frozen-walk.js`，對 FROZEN 內所有「路徑對 sha256」的表逐檔重算。
6. 階段：那 3 個外部檔分別在 P3（2 個測試）與 P4（`check-guidance-eval.js`）搬走。
7. 建議：**(b)** 針對 2 個測試檔；`check-guidance-eval.js` 已經是基準紅，搬不增加損失。
   - 理由：測試檔搬家一定要改路徑，位元組必變，鍵就會從「相符」變成「不存在」。
   - 替代方案是接受這兩列為「歷史紀錄、不再可驗證」。這要 owner 裁決（見裁決 2）。
8. 驗證：已跑。**基準紅：**
   - `stage-graph-g8 --check` rc=2，不符 4 檔：packs/manifest.json、run-skill-onoff-eval.sh、run-skill-onoff-matrix.sh、stamp-prereg.js。
   - `stamp-g67-amendment --check` rc=2，不符 2 檔：run-skill-onoff-eval.sh、README.md。
   - 走訪結果另有不符：stage-graph-g67（5 檔）、amend-5 的 `lib/stage-graph-cell.js`、amend-7 的 `check-guidance-eval.js`。
   - `stage-graph-g67` 與 `d0gate-v2` 兩列沒有 stamped，`--check` 回「row not stamped」是設計行為。
   - 其餘修訂與列全部相符。

### O9 d0gate 與 d0gate-v2 的 rail digest（runner pin）
1. 路徑：`evals/skill-onoff/run-d0gate-campaign.js` 與 `run-d0gate-v2-campaign.js` 的 `RAIL_FILES`；值存在 `prereg/d0gate.json`（以及 draft 的 `d0gate-v2.json`）的 `runner_pin.value`。
2. 引用：5 個 repo 檔：`scripts/dispatch-hetero.sh`、`scripts/per-turn-gate-arm.js`、`scripts/gate-verify.js`、`hooks/per-turn-gate.js`、`scripts/lib/seed-claude-config.js`。另外 campaign script 固定用 `REPO_ROOT/scripts/run-approval.js`、`REPO_ROOT/scripts/dispatch-hetero.sh`。
3. 雜湊持有者：`runner_pin.value` 內 `rail sha256:...`；正式 cc 跑時重算，不符就拒跑。
4. 解析基準：寫死的相對 repo 根路徑。
5. 檢查器：`node evals/skill-onoff/run-d0gate-campaign.js --print-runner-pin`（唯讀，輸出明說不改任何檔）。
6. 階段：5 個檔都在 P4 搬（`hooks/per-turn-gate.js` 進 `hooks/opt-in/`，scripts 進 `scripts/<領域>/`）。
7. 建議：**(a)**，檔照搬，並把 d0gate 兩列視為「搬家後只能存檔、不再能正式跑」。
   - 理由：這 5 個檔在 P4 必然改位元組（要改 require 與 `SELF_DIR` 路徑）。留在原處等於凍結整個 dispatch 軌，不可行。
   - campaign script 在凍結清單內，不能改路徑，所以搬家後它就跑不起來。這要 owner 知情（裁決 3）。
8. 驗證：已跑。**基準紅：** 預登錄值是 `rail sha256:57d04ce6...`，現在 repo 算出 `29dfe2ef...`，且 claude 版本從 2.1.312 變 2.1.316。也就是說 d0gate 的 pin 早已不符現況，只是紀錄。d0gate-v2 的 `runner_pin.value` 是空的（草稿）。
   - 順序提醒：計畫要求 P4 前清空 d0gate v2 U2，所以 v2 會在 P4 之前 stamp，之後 pin 立刻失效。

### O10 profiles 雜湊鏈
1. 路徑：`profiles/profile-catalog.json`，連同 `rule-inventory.json`、`rule-source-manifest.json`、`profile-source-map.json`、`hook-classes.json`、`rule-migration.json`、`guided-compatibility.json`、`guided-baseline-dispositions.json`，加 `p0-sources/*.txt`（2 檔）與 codex 鏡像 `platforms/codex/plugin/profiles/`。
2. 引用：catalog 內 7 個 sha256（inventory、source_manifest、source_map、hook_classes、rule_migration、guided_compatibility、guided_dispositions）。inventory 又逐行綁 `skills/ceo-agent/SKILL.md` 與 `skills/dev-flow/SKILL.md` 的行號與內容雜湊。
3. 雜湊持有者：`profile-catalog.json` 的各 `*_sha256`；`rule-migration.json` 的每條 `content_hash`。
4. 解析基準：相對 repo 根。
5. 檢查器：`node scripts/build-profile-payload.js catalog --check --repo .`。
6. 階段：`profiles/` 原位，不搬。但 P4 改寫 skill 內的腳本路徑會動到內容。
7. 建議：**(b)**，`profiles/` 原位，不寫例外。
   - 要點：`hook-classes.json` 是用 `stem` 記，hook 進 `default/`、`opt-in/` 不改 stem，所以 hook 搬家不影響。
   - 真正的成本在 P4：`ceo-agent/SKILL.md` 有 13 行、`dev-flow/SKILL.md` 有 31 行提到 `scripts/`、`hooks/`、`docs/` 路徑。每一行改字都會讓 `content_hash` 變，要照 `profiles-hash-repin` 技能在 `guided-baseline-dispositions.json` 補 `rewritten` 紀錄（現有 447 筆），並重釘 catalog、同步 codex 鏡像。
8. 驗證：已跑，`catalog --check` rc=0，`status: valid`，611 條 canonical rules。`sync-all.sh --check` 也 ok。

### O11 platform-capabilities.json（簽章收據）
1. 路徑，共 4 份：
   - `docs/projects/_archive/2026/08/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json`（執行期讀取）
   - `platforms/codex/plugin/docs/projects/_archive/.../platform-capabilities.json`（鏡像，與上者位元組相同）
   - `docs/plans/evidence/2026-08-14-strict-l5-policy-refresh/platform-capabilities.json`
   - `docs/plans/evidence/2026-10-16-strict-l5-policy-refresh/platform-capabilities.json`
2. 引用：每份內含 claims 與 `consumer_manifest`，不引用其他 repo 檔。
3. 雜湊持有者：檔內 `consumer_manifest_digest`、`receipt_digest`、每條 `claim_id`（對 claim 內容簽）。
4. 解析基準：執行期預設路徑寫死在 `scripts/dispatch-hetero.sh:2125` 與 `scripts/dispatch-review.sh:299`，格式是 `$SELF_DIR/../docs/projects/_archive/...`。P4 腳本多一層目錄，`../` 層數也要改。`scripts/sync-codex-plugin-skills.sh:102` 有鏡像對應。
5. 檢查器：`node scripts/platform-capability-claims.js validate-consumers --receipt <file> --consumer D2 --consumer D3 --consumer D4`（不加 `--reprobe`，唯讀）。
6. 階段：P1（`docs/projects/_archive` 進 `project/projects/_archive`；codex 鏡像跟著重產）；P2（兩份 evidence 進 `evidence/`）。
7. 建議：**(a)**，位元組不變搬家。簽章是對內容，不含路徑，所以安全。
   - 但執行期預設路徑與鏡像對應都是程式碼，必須同步改。
   - SECURITY.md 說這批要等「封存閉包完成後」產生清理過的後繼物件。若選 (a) 位元組不變，個人資料就不會被清掉，兩件事要分開裁決（裁決 4）。
8. 驗證：已跑。
   - 主檔與 codex 鏡像：rc=0。
   - `2026-10-16-strict-l5-policy-refresh`：rc=0。
   - `2026-08-14-strict-l5-policy-refresh`：**rc=1，claim-ID tampering（基準紅）**。這份是舊版證據，只有 `check-blind-evidence.test.sh` 與 `probe-harness-capabilities.sh` 提到它的目錄名，搬家時照原樣帶走即可，不能當綠燈。

### O12 next-touch-validation.js 的釘表（已結案 mission，archive-only）
1. 路徑：`scripts/next-touch-validation.js`（codex 鏡像另有一份），被 `validate-next-touch-reservation.js`、`validate-next-touch-terminal.js` 包裝。
2. 引用：
   - `FROZEN_EVIDENCE_SHA256` 表 7 個檔：`.autopilot/evidence/grok-implementer-ab.json`、`.autopilot/evidence/hook-multiplexer-benchmark.json`、`scripts/validate-hook-multiplexer-benchmark.js`、`scripts/validate-grok-implementer-ab.js`、`hooks/tests/fixtures/hook-multiplexer-benchmark.json`、`evals/grok-implementer-ab/seed.json`、`evals/grok-implementer-ab/tasks.json`。
   - 寫死路徑：`docs/plans/2026-08-03-next-touch-debt-retirement.md` 與 rubric、`docs/mission-next-touch-debt-retirement-sources.json`、`docs/projects/_archive/...`（含舊扁平佈局）。
   - `G8B_INTEGRATION_GATE_BLOBS`：記錄 git blob id，來自歷史 commit，不是現行檔。
3. 雜湊持有者：腳本內常數。
4. 解析基準：相對 repo 根，字面寫死。
5. 檢查器：`validate-next-touch-reservation.js`、`validate-next-touch-terminal.js`。需要終局 bundle 參數，我沒有可用的輸入，**沒有直接跑**；唯一的覆蓋是 `hooks/tests/next-touch-validation.test.sh`（不能跑）。
6. 階段：P1（plan、manifest、archive 路徑）、P3（fixture）、P4（兩支 `validate-*.js` 進 `tools/` 或 `scripts/` 子目錄，位元組會變）。
7. 建議：**(b)**，這 7 個被釘的檔保持原位，直到 owner 決定退役整個 next-touch 驗證器（見裁決 3）。
   - 理由：`validate-*.js` 在 P4 一搬就要改 require 路徑，位元組變，釘表會紅，而這個驗證器已經結案、只剩測試在用。
8. 驗證：我另外把 7 個釘的檔重算雜湊，**7/7 相符**。驗證器本身無法跑。

### O13 mission-terminal-reconcile 與 rollover fixture
1. 路徑：`scripts/mission-terminal-reconcile.js` 的 `LEGACY`（`adoption_key`、`graph_digest d904c9d1...`、2 個 `receipt_digest`、`git_history_anchor b658b69f`）；fixture `hooks/tests/fixtures/mission-terminal-rollover/`（含 graph、sources、`mission/g8b-final/...` 下約 20 份收據）；兩個 `.frozen-evidence` 標記檔。
2. 引用：fixture 內字串含 `docs/projects/...`、`hooks/tests/...`，是歷史文字。
3. 雜湊持有者：腳本常數；fixture 內各收據互相綁摘要。
4. 解析基準：fixture 目錄由 `hooks/tests/mission-terminal-rollover.test.sh` 組路徑。`.frozen-evidence` 內的行相對標記檔所在目錄；`.` 代表整個目錄。
5. 檢查器：沒有獨立指令，只有 `mission-terminal-rollover.test.sh`、`mission-retire-on-integration.test.sh`（不能跑）。`check-plan-graduation.js` 會讀 `.frozen-evidence` 並回報標記遺失（`frozen_marker_deleted`）。
6. 階段：P3，fixture 隨測試進 `tests/fixtures/`；`docs/projects/_archive/2026/07/2026-07-26-mission-convergence-portfolio/.frozen-evidence` 在 P1 隨目錄搬。
7. 建議：**(a)**，整個目錄位元組不變地搬，標記檔跟著走。
   - 理由：標記只用相對路徑，搬整個目錄不失效。`git diff --diff-filter=D` 預設會把純重新命名視為 R 而不是 D，不會誤報，但要在 P1 實測。
8. 驗證：`check-plan-graduation.js --json` 已跑（`frozen_marker_deleted: 0`）。fixture 與 `LEGACY` 常數**無法驗證**（只能靠不能跑的套件）。

### O14 supersession-anchors
1. 路徑：`hooks/fixtures/supersession-anchors.json`。
2. 引用：6 個 anchor 與 2 個 protected region，檔案是 `scripts/dispatch-contract.js`、`scripts/dispatch-hetero.sh` 及其 `platforms/codex/plugin/scripts/` 鏡像。
3. 雜湊持有者：protected region 的 `sha256` 與 `bytes`，對象是兩個標記之間的文字片段。
4. 解析基準：相對 repo 根（`REPO_ROOT = path.resolve(__dirname, '..')`）。
5. 檢查器：`node scripts/check-supersession-anchors.js`。
6. 階段：manifest 在 P4 隨 `hooks/fixtures/` 重整；被指的兩支腳本在 P4 搬。
7. 建議：**(a)**，只改 manifest 的 `file` 欄，區段雜湊不變（前提是區段內不含會被改寫的路徑）。
8. 驗證：已跑，rc=0（6 anchors、2 protected regions）。不要用 `--update-digests` 讓它變綠。

### O15 審查產物（plan artifact、disposition、收據、review manifest）
1. 路徑：
   - `docs/plans/*.g<N>-artifact.json`（約 58 檔）與 `*-disposition.json`（30 檔，另 2 檔在 `docs/plans/evidence/`、4 檔在 `docs/projects/_archive/.../plan-review/`）。
   - `docs/plans/*.plan-review-manifest.json` 約 50 檔（只含席位設定，沒有雜湊、沒有路徑）。
   - `receipt-*.json`、`lifecycle-receipt.json`、`g1-receipt.txt` 在 `docs/plans/evidence/` 與 `docs/projects/_archive/`。
2. 引用：artifact 帶 `plan_sha256`、`rubric_sha256`、`manifest_sha256`。
3. 雜湊持有者：artifact 內三個欄位；收據（Mode A）綁 git commit sha。
4. 解析基準：`check-phase-review-receipt.js` Mode B 先找 artifact 與 disposition 所在目錄，再退到寫死的 `repoRoot/docs/plans`，用 **sha256 比對找 plan**，不看檔名。
5. 檢查器：`node scripts/check-phase-review-receipt.js --plan-artifact <a> --dispositions <d>`（Mode B）；Mode A 需要 `--ledger --phase --branch`。
6. 階段：P1（plan、artifact、disposition 同在 `docs/plans/`）、P2（evidence 內的收據）。
7. 建議：**(a)**，plan、rubric、artifact、disposition 四者同目錄一起搬，位元組不變，Mode B 就找得到。寫死的 `docs/plans` 退路要改讀登錄表。
8. 驗證：只做到抽樣。名稱能配對的只有 2 組（depth0-per-turn-gate g1、g2），兩組都 rc=1（`Plan file sha256 mismatch`）：這份 plan 在審查之後又被改過，屬於進行中的 BL-0306，列為基準紅。其餘 artifact 與 disposition 命名不成對，Mode A 需要的 ledger 與 branch 參數我沒有，**無法驗證**。

### O16 golden fixtures 與凍結的測試資料
1. 路徑（取樣）：
   - `hooks/tests/fixtures/*.golden*`：dispatch-discuss 三份、`post-tool-chain/golden.json`、`probe-unknown-v3.golden`。
   - `hooks/tests/fixtures/review-loop-config.frozen-2026-09-13.md`。
   - `hooks/tests/fixtures/hook-multiplexer-benchmark.json`（被 O12 釘）。
   - `evals/reviewer-bench/prompt-skeleton.golden` 與 `evals/orchestration/tasks/*/repo/data/golden.txt`（在 evals，原位）。
2. 引用：被測試以位元組比對。
3. 雜湊持有者：沒有雜湊，是「測試讀檔比對」。`hook-multiplexer-benchmark.json` 例外，被 O12 雜湊。
4. 解析基準：測試腳本內拼出 `$REPO_ROOT/hooks/tests/fixtures/...`。
5. 檢查器：各自的 `hooks/tests/*.test.sh`，不能跑。
6. 階段：P3，隨測試進 `tests/fixtures/`。
7. 建議：**(a)**，位元組不變。`hook-multiplexer-benchmark.json` 在 O12 退役前視為 (b)。
8. 驗證：**無法驗證**（只有套件測試能驗，套件正在背景跑）。

### O17 check-blueprint-conformance 的 frozen_four_tuple 契約
1. 路徑：`scripts/check-blueprint-conformance.js` 的契約檔（repo 內沒有任何追蹤的實例，只有測試與 2 份歸檔證據提到）。
2. 引用：契約釘死的檔案，含治理腳本本身。
3. 雜湊持有者：契約內的 pin。
4. 解析基準：`--repo`、`--plugin-root` 參數。
5. 檢查器：`check-blueprint-conformance.js preflight --contract --intent --repo`。
6. 階段：P4 搬治理腳本，若有存活契約就會 `pin_drift`。
7. 建議：不適用。倉內沒有實例；真實契約若存在，在 `~/.autopilot`（任務限制不能碰）。P4 前要請 owner 確認沒有存活契約。
8. 驗證：**無法驗證**（沒有輸入，也不能碰 `~/.autopilot`）。

## SECURITY.md 列的 B 類 7 檔與延後項對照

| 檔 | 落在哪個物件 | 目前檢查結果 |
|---|---|---|
| `docs/plans/2026-08-04-platform-capability-trigger-activation.md` | O1（被 sources 釘 plan 位元組） | 雜湊相符 |
| `evals/skill-onoff/prereg/findings-batch.json` | O7 | `--check` 綠 |
| `evals/skill-onoff/prereg/findings-batch-v2.json` | O7 | `--check` 綠 |
| `evals/skill-onoff/prereg/findings-batch-v3.json` | O7 | `--check` 綠 |
| `evals/skill-onoff/prereg/stage-graph-g67.json` | O8 | 基準紅（原本已漂移） |
| `evals/skill-onoff/prereg/stage-graph-g67.md` | O8 | 基準紅 |
| `evals/skill-onoff/prereg/stage-graph-g8.json` | O8 | 該列基準紅，檔本身在凍結清單內 |
| `evals/skill-onoff/packs/manifest.json` | O7、O8 | g8 列把它列為不符（基準紅） |
| `evals/skill-onoff/prereg/FROZEN.json` | O7、O8 | 本身是檢查器的資料，不被雜湊 |
| `platform-capabilities.json` 兩份（含 codex 鏡像） | O11 | rc=0 |

- 這 7 檔中第一筆在 `docs/plans/`，其餘 6 筆在 `evals/skill-onoff/prereg/`（O7、O8 都選 (b)，不搬）。第一筆不在 evals，在 P1 隨 plans 以位元組不變進 `project/`（見計畫 D9 第 4 點）。D9 已裁決不產生後繼物件；若要清理個人資料只能開新列，不改舊檔。

## 總表

| # | 物件 | 階段 | (a)/(b) | 能否驗證 | 檢查器指令 |
|---|---|---|---|---|---|
| O1 | sources manifest 與 100 個被引用 plan／rubric | P1 | (a)，待裁決 1 | 能：110/110 雜湊相符 | `node scripts/mission-execution-graph-check.js --graph G --governance .claude/owner-kernel-governance.json --sources S`；`node scripts/check-plan-graduation.js --json` |
| O2 | execution graph 37 檔 | P1 | (a) | 能：29 綠、8 基準紅 | 同上 |
| O3 | task-authority 23 檔 | P1 | (a) | 部分：10 相符、13 基準不符 | 同上（比對 `mission_graph_digest`） |
| O4 | 現行 mission 路由綁定（6 檔） | P1 | (b) | 能（check-plan-graduation rc=0） | `node scripts/check-plan-graduation.js --json` |
| O5 | eval seal.json 4 檔 | 不搬 | (b) | 能：rc=0 | `node scripts/rubric-freeze.js check <spec> <seal>`；`checkAssetSeals` |
| O6 | engine-qualify 16 個釘 | 不搬（evals） | (b) | 部分：14 能、2 不能 | `engine-qualify.js` 內 `verifyPinned*`；對照雜湊腳本 |
| O7 | skill-onoff 12 個 stamped 列與 packs | 不搬 | (b) | 能：12 列 rc=0；pack 逐檔只能間接 | `node evals/skill-onoff/stamp-prereg.js --row R --check` |
| O8 | skill-onoff 舊式 FROZEN 與修訂 | P3、P4 影響 3 鍵 | (b)（2 個測試檔）+ 裁決 2 | 能，但基準紅 | `stamp-prereg.js --row stage-graph-g8 --check`；`stamp-g67-amendment.js --check`；`frozen-walk.js` |
| O9 | d0gate rail digest（5 個 repo 檔） | P4 | (a)，待裁決 3 | 能，但基準紅 | `node evals/skill-onoff/run-d0gate-campaign.js --print-runner-pin` |
| O10 | profiles 雜湊鏈 | 不搬；P4 重釘 | (b) | 能：rc=0 | `node scripts/build-profile-payload.js catalog --check --repo .` |
| O11 | platform-capabilities.json 4 份 | P1、P2 | (a) | 能：3 綠、1 基準紅 | `node scripts/platform-capability-claims.js validate-consumers --receipt F --consumer D2 --consumer D3 --consumer D4` |
| O12 | next-touch-validation 釘表 | P1、P3、P4 | (b)，待裁決 3 | 釘的檔能（7/7）；驗證器不能 | 重算雜湊腳本；`validate-next-touch-*.js`（缺輸入） |
| O13 | mission-terminal-reconcile 與 rollover fixture、.frozen-evidence | P1、P3 | (a) | 不能（只有套件） | `check-plan-graduation.js --json`（只覆蓋標記） |
| O14 | supersession-anchors | P4 | (a) | 能：rc=0 | `node scripts/check-supersession-anchors.js` |
| O15 | 審查 artifact、disposition、收據 | P1、P2 | (a) | 部分：2 組抽樣皆基準紅 | `node scripts/check-phase-review-receipt.js --plan-artifact A --dispositions D` |
| O16 | golden fixtures | P3 | (a) | 不能（只有套件） | 各 `hooks/tests/*.test.sh`（不能跑） |
| O17 | blueprint 契約 pin | P4 | 不適用 | 不能 | `check-blueprint-conformance.js preflight`（無輸入） |

- 物件共 17 個。
- (a)：O1、O2、O3、O9、O11、O13、O14、O15、O16，共 9 個。
- (b)：O4、O5、O6、O7、O8、O10、O12，共 7 個。
- 不適用：O17，共 1 個。

### 其他唯讀跑過的全域檢查（都在搬家前基準內）
- `node scripts/check-hook-inventory.js --check`：rc=0（40 hooks，26 預設、14 選用）。
- `node scripts/check-claude-md-inventory.js`：rc=0（299 支腳本）。
- `node scripts/check-config-docs.js`：rc=0。
- `node scripts/check-tmp-residue-registry.js`：rc=0。
- `node scripts/layout-lint.js`：rc=0（bootstrap 階段）。
- `node scripts/hook-harness-matrix.js --check`、`check-readme-parity.js`、`check-reference-sizes.js`、`check-stage-vocab.js`、`check-settings-changelog.js`：都是 rc=0。
- `bash scripts/sync-all.sh --check`：ok，無 failures。
- `node scripts/doc-drift-gate.js`：rc=0。

## 無法驗證的項目（依計畫規定，閉包內有一項無法驗證，該批不搬）
1. O6 的 2 個 canonical JSON 摘要（EXPECTED_CORPUS_MANIFEST_HASH、EXPECTED_ARTIFACT_ORACLE_HASH）：只有 `engine-qualify` 套件測試能驗。
2. O7 的 packs/manifest.json 逐檔雜湊：沒有獨立唯讀指令。
3. O12 的 next-touch 終局驗證器：缺 bundle 輸入。
4. O13 的 rollover fixture 與 `LEGACY` 常數、O16 的 golden fixtures：只有套件測試能驗，而套件正在背景執行。
5. O15 的 Mode A 收據與大部分 Mode B artifact：缺 ledger、branch 參數。
6. O17：沒有倉內實例，且不能碰 `~/.autopilot`。
7. 基準紅（不是不能驗，而是本來就紅，不能當「搬家前綠」）：O2 的 8 組 graph、O3 的 13 份 authority、O8 的 g8／g67 列、O9 的 rail digest、O11 的 2026-08-14 證據、O15 的 depth0-per-turn-gate 兩組。

建議把上面第 7 項整理成一份「基準紅清單」，每個階段合併前比對「紅的集合沒有變」。

## 需要 owner 或 depth-0 裁決的點

1. **sources manifest 的路徑基準（影響 O1，最大）。**
   - 問題：計畫的 `project/missions/` 加 `project/plans/` 會讓 `plan_path` 變成 `../plans/...`，檢查器拒絕。
   - 選項 A：manifest 搬到 `project/`（不進 `missions/`），`plan_path` 位元組不變，零程式改動。
   - 選項 B：manifest 進 `project/missions/`，被引用的 100 檔跟著放 `project/missions/plans/`，會與 `project/plans/` 分家。
   - 選項 C：改 `loadSourceCoverageManifest`，讓基準是 repo 根或登錄表。這會動一個防路徑穿越的檢查，要走機制改動流程並補負控制。
   - 我的建議是 A。
2. **O8 的兩個外部鍵。**
   - `../../hooks/tests/skill-onoff-g67.test.sh` 與 `...g8.test.sh` 在 P3 搬走並改路徑後，那兩個鍵就從「相符」變「不存在」。
   - 選項：兩個測試檔留在 `hooks/tests/` 當逐檔例外；或接受 g67、g8 兩列為「歷史、不再可驗證」。這兩列本來就已經有不符的檔，我傾向接受後者，並在 SECURITY.md 或登錄表註明。
3. **evals 對 repo 檔的硬釘：d0gate 的 rail digest（O9）與 next-touch 驗證器（O12）。**
   - 這些釘住的檔在 P4 必然改位元組。要嘛承認「搬完後這幾列只能存檔、不能再正式跑」，要嘛把 5 個 rail 檔與 7 個 next-touch 釘檔留原處。後者等於凍結 `dispatch-hetero.sh`，不可行。
   - 我的建議是接受存檔，並把 `next-touch-validation.js`、`validate-next-touch-*.js` 一併列為死碼退役候選（計畫 §3 的「只剩測試引用的 5 支」可涵蓋）。
   - 順序風險：d0gate v2 U2 若在 P4 前 stamp，pin 會立刻失效。
4. **SECURITY.md 承諾的「清理過的後繼物件」與 (a) 位元組不變搬家是兩件事。**
   - 7 個 B 類檔都在 `evals/` 且被雜湊鏈釘住，不搬就不會被清理；要清理就得開新列（沒有改舊檔的選項）。
   - 需要 owner 決定：個人路徑留在這些已發布紀錄裡，還是為每個列開一個清理版後繼列。
5. **現行 mission（blind-review-2d-snapshot）何時退場（O4）。**
   - 它的 6 個檔在退場前必須留在 `docs/`。若 P1 之前不能退場，登錄表要有這 6 條逐檔例外，layout-lint 才不會誤報。
6. **作業規則補充：重寫工具的跳過清單。**
   - 受保護清單只涵蓋 34 張 graph。另 3 張 graph、全部 23 份 authority、`evals/` 內被常數釘住的檔，都不在 `sealedDocFiles()`。
   - P1 到 P4 的改寫器需要一份獨立、可檢查的「禁止改寫」清單，並附負控制（在其中一個檔植入一個字元，改寫器必須拒絕）。

## 本次產出的輔助腳本（唯讀，放在 scratchpad）
- `/tmp/claude-<uid>/-home-<user>-projects-autopilot/fc08943b-cbf1-4a20-9c65-f3ac33609006/scratchpad/layout/frozen-walk.js`：對 FROZEN.json 內所有路徑對雜湊表逐檔重算。
- `/tmp/claude-<uid>/-home-<user>-projects-autopilot/fc08943b-cbf1-4a20-9c65-f3ac33609006/scratchpad/layout/mg.sh`：37 組 graph 加 sources 跑檢查器。
- `/tmp/claude-<uid>/-home-<user>-projects-autopilot/fc08943b-cbf1-4a20-9c65-f3ac33609006/scratchpad/layout/ta.sh`：23 份 authority 對 graph 摘要。
- `/tmp/claude-<uid>/-home-<user>-projects-autopilot/fc08943b-cbf1-4a20-9c65-f3ac33609006/scratchpad/layout/frozen-refs.js`：列出凍結檔內提到 repo 路徑的字串。

## relay0 前後比對

- 目的：分辨「搬家前就紅」的項目，是 relay0 之前就紅，還是 relay0 造成的。
- 比較的兩點：85b3189df（relay0 之前）與 ca97d97b3（現在）。兩者之間共 14 個 commit。
- 做法：各開一個 detached worktree，兩邊跑完全相同的指令（腳本 `scratchpad/layout/cmp.sh`，輸出 `cmp-a.txt`、`cmp-b.txt`），比完已移除 worktree。
- 結果：**兩邊輸出逐行相同（`diff` 無差異）。**

| 檢查器 | 85b3189df 紅的集合 | ca97d97b3 紅的集合 | 分類 |
|---|---|---|---|
| 37 組 mission graph | 8 組：backlog-actionable-successor、codex-payload-residual-spike、codex-payload-residual-spike-successor、hook-test-harness-determinism、plan-review-codex-trusted-cwd-fix、qualification-verdict-stability、reviewer-output-token-budget-successor、skill-transport-implementer-arm | 同左 8 組 | 兩邊都紅 |
| 23 份 task-authority 對 graph 摘要 | 13 份不符 | 同一批 13 份 | 兩邊都紅 |
| FROZEN stage-graph-g8 | 不符 4 檔：packs/manifest.json、run-skill-onoff-eval.sh、run-skill-onoff-matrix.sh、stamp-prereg.js | 同左 | 兩邊都紅 |
| FROZEN g67 修訂 | 不符 2 檔：run-skill-onoff-eval.sh、README.md | 同左 | 兩邊都紅 |
| 12 個 stamped 列 | 全綠 | 全綠 | 兩邊都綠 |
| d0gate rail digest | `29dfe2ef…`，5 個檔雜湊與現在完全相同；預登錄值是 `57d04ce6…` | 同左 | 兩邊都紅 |
| sealed-docs | 138 檔 | 138 檔，清單完全相同 | 兩邊相同 |
| 2026-08-14 platform-capabilities | claim-ID tampering | 同左 | 兩邊都紅 |
| 2026-10-16 platform-capabilities | 綠 | 綠 | 兩邊都綠 |
| depth0-per-turn-gate 審查 artifact（g1、g2） | plan sha256 不符（現算 `45955cba…`） | 同左 | 兩邊都紅 |

分類結果：
- **兩邊都紅**：上表所有紅項，共 5 類（graph 8 組、authority 13 份、g8、g67、rail digest）加 2026-08-14 證據與 depth0-per-turn-gate artifact。
- **只在 ca97 紅（relay0 或之後造成）**：無。
- **只在 85b3 紅**：無。

逐項 `git log --oneline 85b3189df..ca97d97b3 -- <路徑>` 的結果，全部為空，代表這段期間沒有任何 commit 動過這些檔：
- `docs/mission-*`（graph、sources、authority 全部）。
- sealed-docs 清單內 138 個檔。
- `evals/skill-onoff/prereg`、`packs/manifest.json`、`run-skill-onoff-eval.sh`、`run-skill-onoff-matrix.sh`、`stamp-prereg.js`、`README.md`、`lib/stage-graph-cell.js`。
- rail 的 5 個檔：`dispatch-hetero.sh`、`per-turn-gate-arm.js`、`gate-verify.js`、`hooks/per-turn-gate.js`、`lib/seed-claude-config.js`。
- `docs/plans/evidence/2026-08-14-strict-l5-policy-refresh/`：**這段期間沒有人動過它**，tampering 判定在 relay0 之前就存在。
- depth0-per-turn-gate 的 plan、rubric、g1／g2 artifact。
- 順便抽查 `.claude/mission-routing-config.json`、`profiles/`、`hooks/fixtures/supersession-anchors.json`：也都沒有被動到。

結論：第一節列的所有基準紅，都是 relay0 之前就存在的，relay0 沒有造成新的紅，也沒有修好任何一個。
