## 目標

實作已核准的「資格判定穩定性重設計」(雙層門檻 + 匯總多次施測),把 consult/discuss 資格從「單次滿分才過」改成「可重現的能力估計」,再收尾整個 consult/discuss qualification campaign。

## 現況

- Branch `develop` @ `38471c2f`,**乾淨**,**與 origin/develop 同步**,無殘留 worktree、無 stash。版本 **v2.35.2**。session marker 已清。
- **verdict-stability plan 已 APPROVED 並合併**:`docs/plans/2026-08-29-qualification-verdict-stability.md`(2 代跨家族 plan review、6+7=13 條發現全摺入)。**尚未開始實作**。
- **consult/discuss qualification 專案本體已出貨**(wave 1 v2.34.46、wave 2 v2.35.1、儀器五輪修復 + 三 QRP adapter + 誠實考生驗證器,全在 develop)。
- **施測已跑完 9 席,結果已進 canonical scorecard**(events 157-165),但**都是單次施測、100% 線**,已知對隨機噪音敏感(見「已決事項」)。cursor 無法圍堵、未參加(19 份探針證據 `docs/plans/evidence/2026-08-29-cursor-containment-probe/`)。
- 無 in-flight 背景工作;所有 worker 已收。

### canonical scorecard 現有 consult/discuss 列(單次,待 D1 降 provisional)
```
157 kimi-code/k3    kimi         consult qualified 20/20
158 gpt-5.6-sol     codex        consult qualified 20/20
159 claude-fable-5  claude-native consult qualified 20/20
160 grok-4.6        grok         consult qualified 20/20
161 Qwen3.8-Max     qoderclicn   consult failed    19/20  (1× protocol_violation=aside濫用)
162 GLM-5.3         cc-shim      consult failed    18/20
163 gpt-5.6-sol     codex        discuss failed    9/16   (真失能,zero_information)
164 gemini-3.7-flash agy         discuss FAILED    15/16  ← 翻盤冤案:另兩次都 16/16
165 MiniMax-M3      cc-shim      consult QUALIFIED 20/20  ← 翻盤:第一次 19/20
```

## 已決事項(不重議)

- **判定重設計的設計已定並經 review 核准**:雙層(信任違規零容忍一票否決 / 能力失手匯總統計);匯總 3 跑(consult 60 / discuss 48);Wilson 下界 z=1.645、τ=0.85;判定邊界誠實標為真值 **≈0.923**(不是 0.90——我原本的 0.90/z=1.96 自相矛盾,被 review 抓出,已改);**早停只淘汰、合格永不靠單一/部分樣本**(根除翻盤噪音);**不動 sealed grader**(hash 逐位元組不變);信任掃描看 pre-parse stdout(防 verdict 藏尾巴);真 supersession 契約(reader 認得、壓過舊 qualified 列)。細節在 plan D0–D8。
- **現有 9 席是單次判定,是雜訊不是定論** — Gemini discuss 兩次 16/16、一次 15/16 卻被記 FAILED;MiniMax 19→20 翻成 QUALIFIED。故 D1 必須先把 events 157-165 降 provisional。
- **cursor 考不了、留 roster 外** — cursor-agent 無可信圍堵:列舉 deny 是 allow-by-omission(TodoWrite/WebSearch 在完整 deny+--force 下照跑)、無 wildcard(`["*"]` 靜默失效)、--sandbox AppArmor 不可攜、--mode ask 被 --force 壓過。19 份實測證據。
- **儀器已端到端驗過** — 誠實考生 solver(`hooks/tests/lib/honest-consult-discuss-solver.js`)只看 envelope 拿 20/20 consult + 16/16 discuss;五輪修復(envelope 揭露、agy 圍堵、C4/C5 relax、round_id、aside-channel coherent)封住整個資訊缺口類別。
- **失敗列也是紀錄** — 照使用者「照實記」裁示:qualified + failed 都記,沒參加的(cursor、未施測角色×引擎組合)不寫成績列,只在 ledger 誠實標「沒考」。
- **semver = PATCH**(改既有 script 行為,非新 skill/agent)。

## 下一步

1. `git pull --ff-only`(確認仍與 origin 同步;本 session 有並行 session,推前必查 `git show origin/develop:.claude-plugin/plugin.json`)。
2. 讀 `docs/plans/2026-08-29-qualification-verdict-stability.md` 全文(APPROVED 版,D0–D8)。
3. **派 /l4 foreman 實作 plan**,DAG 序:D0(凍 review base)→ **D1 先降 provisional**(備份兩個 store→append `record_kind:supersession` marker→ledger banner)→ D2 `wilsonLower` helper → D3 error-class→tier 窮舉表(兩張,對照真實 grader 輸出)+ protocol_subtype 在 verdict 引擎外算 → D4 verdict 引擎(fail-only sequential)→ D5 supersession 契約(reader 認得,D7 前必落)→ D6 精確二項 OC 當 normative oracle + 隨機引擎模擬證明可重現 → D7 重跑協定(**付費,約 3×,是 Board/使用者單獨授權關,plan 不授權**)→ D8 mirror+release。
4. 每個 deliverable 走 code review 對 plan 的 13 條要求把關(尤其 [0] IID 論證、[4] pre-parse 信任輸入、[5] supersession reader 契約)。
5. D7 真金重跑前**停下問使用者授權**。

## 驗證方式

```bash
git status --short                                              # 乾淨
grep '"version"' .claude-plugin/plugin.json                     # 2.35.2(D8 才 bump 2.35.3)
bash hooks/tests/honest-consult-discuss-solver.test.sh          # 16 assertions PASS(儀器不可回歸)
bash hooks/tests/engine-qualify-consult.test.sh                 # PASS
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh  # 8/8
python3 -c "import json;[print(r['event_id'],r['engine'],r['role'],r['status']) for r in map(json.loads,open('$HOME/.autopilot/engine-scorecard/scorecard.jsonl')) if r.get('role') in ('consult','discuss')]"
# D1 後上面應多出 supersession marker 列,且 seat-status 對 164/165 顯示 provisional/downgraded
```

## Read-order

1. `docs/plans/2026-08-29-qualification-verdict-stability.md` — APPROVED plan,實作的 binding spec;Review log 記了 13 條裁決與兩個攻擊面(supersession 契約、OC-preservation invariant)。
2. `docs/plans/evidence/2026-08-28-consult-discuss-qualify/ADMINISTRATION-LEDGER.md` — 施測總帳:怎麼考的、誰過誰敗、誰沒參加;含 effort-enum bug 與翻盤的誠實紀錄。
3. `docs/plans/2026-08-28-consult-discuss-qualification.md` — 原 consult/discuss 專案(已 SHIPPED);§8 裁決仍拘束(advisory 到期、requalify_required token、shadow 不武裝、CAPABILITY_ROLE_IDS 分軌)。
4. `scripts/qualification-review-provider.js` — 7 種 QRP adapter(codex/claude/agy/kimi/grok/qoderclicn 可用、cursor 拒絕),verdict 引擎改動的落點附近。

## 陷阱

**已路由出本檔(見下)。此處只留指標:**
- **base-drift + 共用 checkout**:worktree agent 從 origin 切、非本地 HEAD——派依賴前序 commit 的 worker 前先 push;另有並行 session 直接在主 checkout 切分支的劫持風險,每次 merge/commit 前 `git branch --show-current` 重驗。(已在 memory `concurrent-session-version-yield.md`。)
- **capability/containment docs 會騙人**:grok `--tools ""` 看似擋工具其實照跑、cursor deny 是假鎖——任何「這個 CLI 能圍堵/有某能力」的宣稱,一律用**新工具名活體探針**驗,不信 docs、不信舊 adapter。(本 session 新教訓,已 route 到 learn。)
- **離線重判舊回應會低估重跑**:用修正後 grader 重判**舊 prompt 下的回應**,不等於用**修正 prompt 重跑**——MiniMax/GLM 離線預覽說仍敗,實跑卻 18-19/20。修了 prompt 就要重跑,別靠離線判。(已 route 到 learn。)
- **run.sh effort 是 receipt-only 但要合法 enum**:agy/cc-shim 席曾塞 `baked-in-model-name`/`default`,record 的 enum 拒收。已修+進 BACKLOG。
- **`--emit-row --store <scorecard路徑>`** 會讓 evidence 落到 scorecard 的 dirname 而非 canonical `~/.autopilot/engine-capability/`——記帳要走 production record + 重錨。
- **cc-shim endpoint 三步驟**(bash 非 zsh、source 後要呼叫 `autopilot_load_endpoints_env`、`--endpoint minimax` 不手動 export)。(已在 memory `dispatch-review-runner-setup.md`。)
