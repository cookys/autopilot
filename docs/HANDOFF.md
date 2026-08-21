## 目標

**北極星**(ADR-0001):強模型治理 = 管 outcome/evidence 不管 process。本 session(2026-08-21,
接續 aimax395 handoff)完成 **v2.34.33 verdict-bytes-preservation** 全弧並出貨:reviewer
transport 毀掉 content-verified verdict 的三個毀損點(shell 位置/exit、envelope 分類、
aggregation 層)第一次留下機器痕跡。CEO 模式授權止於本 session,新 session 重新確認。

## 現況

- Branch:`develop`,乾淨,已推 origin(`790dc21e`,**v2.34.33**)。無 active project、無
  stash、無殘留 feature branch(`feat/v2.34.33-verdict-bytes-preservation` 已刪,從未推遠端)。
- 全套件綠:267 檔(branch + reviewer 修正後的 develop 基線雙側 ALL TESTS PASSED)。
  preflight 8/8(v2.34.33)。doc-drift gate 綠。
- Task list:#1-11 全 completed(L 流程完整 forcing-function 樹,含 finish-flow 7 子任務)。
- `/tmp/.../737e71e0-.../scratchpad/dev-tree` worktree 屬**另一個 session**(detached
  87d66866)——不是本 session 的殘留,別清。

### 本 session 出貨(v2.34.33,merge `f98c7ea0`)

三毀損點:①shell 位置/exit 類(8/8 chrome 形);②envelope 分類類(non-success 不 parse);
③**aggregation 層**(G1 review 實證:`required_seat_transport_exhausted` 連 reviewer_verdicts
都不帶,成功席的 STOP 死於別席 exhaustion = 真實 8/20 毀損點)。出貨形:搶救 battery = 權威
battery **抽取**(僅放寬 start-anchor→唯一 BEGIN+第一 END、exit-0);八軌 no_verdict 收斂
`emit_no_verdict` funnel(runner 專屬 SALVAGE_CAPTURE);envelope 軌凍結 admission matrix
(interrupted/unavailable 僅 strict、timeout/exit_failure/quota 收 clean-scan-tail 唯一
extract、digest 綁定、fresh-exclusive capture、carry 規則 0/1/≥2);非權威欄
`unratified_verdict`/`unratified_observations`;reader 集合由 `check-canonical-invariants.sh`
新 reader-allowlist 模式機械封閉(synthetic consumer 紅證常駐)。

## 已決事項(不重議)

- **Parser 永不為權威放鬆**(重開 prompt-echo 洞);unratified 升權威 = 獨立 policy review。
- **raw_binding_mismatch / identity_mismatch 永不搶救**(自相矛盾證據);空 capture 永不。
- **G2 terminal 裁決全 accept**(兩代上限,`g2-adjudication.md` 為終局);G1 兩項拒絕維持:
  in-band attempt binding(模型服從性新失效模式)、standing acceptance-search(over-machinery)。
- **真實 8/20 事故是 0-byte-no-reference**(plan-review-transport-fixes.test.sh 凍結)——
  「timeout 帶完整 payload」是 CONSTRUCTED 形,別再當事故重演敘述。production timeout 可搶救類
  = author-survives/runner-killed,分類為 **exit_failure** 非 timeout(evidence fixtures/)。
- **CHANGELOG v2.34.31 conflict markers 是並行 session 之債,不碰**(preflight 8/8 帶著過)。
- 到期提醒不阻擋、驗證優於 attestation(ADR-0001)——照舊。

## 下一步

1. **`/next` 重掃**。已知佇列(2026-08-21 17:33 B 掃 + 本 ship 後):met-trigger 開著的只剩
   **roster implementer/explorer legs(L)**;未 fire:不信任投票(M,sol 成績單 9/16 到期但
   expiry 已 advisory)、claim_id 解耦(M)、考券官方預設(L)、Durable repair-lock(L,六前置)、
   contract-first class (a)(M,需有效述詞)。新增:witness 500ms flake(Fix,紅了就修)。
2. 殘項全在 `docs/projects/_archive/2026-08-21-verdict-bytes-preservation/README.md` 處置附記
   (五項顯示層 CUT + kimi 兩塊塌縮 = 既有行為同位)——事故化才提升。

## 驗證方式

```bash
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh   # 8/8 (v2.34.33)
bash hooks/tests/run.sh --parallel 8    # ALL TESTS PASSED (267);witness 500ms flake 偶紅
                                        # → 單獨重跑該檔綠即為既記錄 flake(BACKLOG 有條目)
bash hooks/tests/dispatch-review.test.sh          # 319(含 9 kimi 案例)
bash hooks/tests/dispatch-plan-review.test.sh     # 266(含真 author 路徑 prod fixture)
bash scripts/check-canonical-invariants.sh        # 含 reader-allowlist[unratified-columns] ✓
```

## Read-order

1. `docs/projects/_archive/2026-08-21-verdict-bytes-preservation/README.md` — 成敗準則證據 + 處置附記
2. `docs/plans/2026-08-21-verdict-bytes-preservation.md`(Shipped 戳,R3 FROZEN)— 凍結規則:
   battery 抽取原則、admission matrix、carry rule、rail inventory(§6 為 out-of-scope 界)
3. `docs/plans/evidence/2026-08-21-verdict-bytes-preservation/g2-adjudication.md` — 終局裁決 9 條
4. `docs/plans/evidence/2026-08-21-verdict-bytes-preservation/dead-gate-mutations.md` — 兩軌紅證
5. `docs/BACKLOG.md` — 收束 row 的新 residual trigger(新 verdict transport = engine-onboarding 決策)

## 陷阱

- **判紅只信 Summary 段**(本 session 兩次:slash-entry-probe 的 FAIL 行是套件內嵌 fixture 輸出;
  reviewer 自己的 develop 基線被自建 detached-HEAD worktree 污染過一次——worktree 要 branch-backed)。
- **`git add -A` 會掃進 untracked 殘留**(本 session HANDOFF.md 被掃進 commit 一次,amend 救回;
  後來 archive commit 又入庫——已成既定,新 handoff 直接同路徑取代)。
- **anti-balloon gate**:plan 修訂超 1.5× 會 STOP(本 session 1.598→壓縮至 1.495 過,warning 誠實帶)。
- **plan-review payload 只認 `{verdict, findings}` 嚴格形**;seat 級測試用
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE seam(descriptor 可帶 classification)。
- 突變還原**用 scratch cp 備份,絕不 `git checkout <file>`**(未 commit 正版會被洗掉)。
- dispatch-review 的 review JSON 是 **strict 契約**(schema additionalProperties:false +
  `REVIEW_RESULT_FIELDS` allowlist)——加欄位要 schema+validator+codex 鏡像+測試原子更新。
- kimi 軌任何 capture 消費者要吃**正規化後**的 bytes(bullet 前綴);正規化段現在 rc 檢查之前,
  別搬回去。
- reviewer agent(aa6bfb1419c9fc172,兩輪 context)可 SendMessage 續;新 session 後失效需重派。
