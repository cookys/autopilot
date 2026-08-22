## 目標

**北極星**(ADR-0001):強模型治理 = 管 outcome/evidence 不管 process。本 session(2026-08-22)
出貨 **v2.34.34 implementer qualification suite**(live-rail 正式考券,L 全弧:兩代 plan review
+ 兩輪 pre-merge)並完成 Board 指示「先把各模型考一遍」的**全 roster 施測**(11 場,scorecard
events 143-155)。CEO 授權止於本 session,新 session 重新確認。

## 現況

- Branch:`develop`,乾淨,已推 origin(`43652850`)。v2.34.34 merge = `92bc6939`(帶
  QC-Verdict trailer);之後 develop 上直落三個 evidence/telemetry commits(`9ab820aa` 動
  scripts/ 的 telemetry 補強經獨立 micro-review SHIP-AS-IS 後以 trailer 隨 `43652850` 推過
  qc-gate)。無 stash、feature branch 已刪、project 已歸檔。
- Task list:#1-11 全 completed(L 流程 + finish-flow 7 子任務)。
- 全套件:v2.34.34 pre-merge 時 268/269(唯一紅 = engine-onboarding-methodology 斷言追新,已修;
  witness 500ms flake 為既記錄豁免)。preflight 8/8。
- **考級結果(events 143-155,全在真 store,+90d expires 2026-11-19)**:九個合格 implementer
  pairs —— claude-sonnet-5(154,效率冠軍 3.75 題/分/med 16s/最穩)、claude-opus-5(155)、
  GLM-5.3(150)、grok-4.5(143)、MiniMax-M3(151)、gpt-5.3-codex-spark(145)、gpt-5.6-sol
  (146,reviewer+implementer 雙料)、gpt-5.6-luna@medium(153)、Qwen3.8-Max(148)。誠實
  FAIL:agy 三席(144/147/152,envelope transport,tier 排序 pro>flash-high>flash-medium)、
  grok-4.6(149,**canary 陷阱命中**——4.5 抵抗住同一陷阱,版本回歸實證)。grok-composer 汰型
  (uncharged receipt)。

## 已決事項(不重議)

- **考場 = live-rail 真派工**(Board;broker 單發裝不下 worktree 迴圈;VA v3 的安全目標以「候選碼
  在自己 process + host 只讀 artifacts + oracle bwrap 孫進程」滿足)。
- **截斷 administration 永不成 qualified**(R1/R2 review:fold+kernel 雙層拒收;row 分母恆為全
  corpus 24——observed-denominator 竄 T0 的洞已以 exploit 重演證關閉)。
- **agy FAIL 是 pair 屬性照記**(envelope 缺陷;FAIL append-only,修復後屬 fresh evaluation)。
- **grok-4.6 只擋 implementer 路由**,reviewer 席位不受影響(role 分開考,by design)。
- **Stage-0 probe = operator-run(v1)**,程序在 engine-onboarding SKILL.md;機械化在 BACKLOG。
- **Anthropic 席走 cc-shim + api.anthropic.com + 訂閱 OAuth bearer**(Board 授權 quota;
  operator-asserted 識別)。
- rerun-until-green 禁止;到期 advisory;ADR-0001——照舊。

## 下一步

1. **`/next` 重掃**。最熱:「**Official qualification defaults**」BACKLOG row trigger 已 FIRED
   (九引擎 implementer + sol reviewer + GLM-5.3 VA 預設成績單集現成)——Board 已隱含興趣但未
   裁示開案。次熱:explorer suite(roster 最後一 leg)、implementer-suite hardening cut-list
   row(下次動 impl 套件時捎帶)、agy envelope row(等 agy 更新或第三場前)。
2. Board 待決舊件:tree-engine graduation(OVERDUE)、fable-skills triage。

## 驗證方式

```bash
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh   # 8/8 (v2.34.34)
bash hooks/tests/engine-qualify-impl.test.sh                     # 41 assertions(需 bwrap)
python3 -c "import json,os;rows=[json.loads(l) for l in open(os.path.expanduser('~/.autopilot/engine-scorecard/scorecard.jsonl'))];print([ (r['event_id'],r['engine'],r['status']) for r in rows if r.get('role')=='implementer' and r['event_id']>=143])"
bash hooks/tests/run.sh --parallel 8   # witness 500ms flake 偶紅 → 單獨重跑綠即豁免
```

## Read-order

1. `docs/plans/evidence/2026-08-22-implementer-qualification-suite/sweep-2026-08-22.md` —
   全 roster 榜 + 歸因 + 效率 telemetry + harness 修法(本 session 的核心產出)
2. `docs/projects/_archive/2026-08-22-implementer-qualification-suite/README.md` — 套件 L 弧
   成敗準則與決策記錄
3. `docs/plans/2026-08-22-implementer-qualification-suite.md`(Shipped 戳,R2 FROZEN)—
   構念/taxonomy/admission 凍結規則;§10 backlog candidates
4. `docs/BACKLOG.md` — Official-defaults row(trigger FIRED)+ impl hardening cut-list +
   agy envelope row
5. `~/.claude/.../memory/engine-qualify-administration-gotchas.md` — 施測 CLI 陷阱(下場必讀)

## 陷阱

- **engine-qualify 識別欄位是 strict TOKEN**:runner-version 要 tokenize(空格/括號被拒)、
  harness-version 用冒號不能用 `@`;施測配方直接抄最近 bundle README,別重組(memory 有條目)。
- **cc-shim 不是二進位**(rail 模式):其 runner-version 取 `claude --version`;creds 走
  `load-endpoints-env.sh` **source 後要呼叫 `autopilot_load_endpoints_env`**(只 source 載不到)。
- **token/usage 可得性依 rail**:grok log 全量(含 cost)、agy 僅正常 envelope、codex/cc-shim/
  qoder 不回報——harness 自 wave-4 起已存 per-case `wall_secs`+`usage`(rawExchanges),rail 補
  上即自動有。
- **exam 派工 env 是建構的 allowlist**:`AUTOPILOT_*` 全剝除;測試假引擎要走檔案通道拿 seed。
- 判紅只信 Summary 段;`git add -A` 會掃 untracked;突變還原用 scratch cp 不用 git checkout;
  plan-review payload 只認 `{verdict,findings}` 嚴格形——皆前 session 舊律,仍有效。
- sweep 腳本(scratchpad/sweep*.sh)是 session-local 工具,**未入庫**——正式化屬 Official-defaults
  專案範圍,別當它已存在。
