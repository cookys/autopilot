## 目標

實作 `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md`（四代 hetero review 後凍結）的
P0 起全部階段。**P0/P1/P2 已出貨並推上 `origin/develop`**（`e2495ae4`，v2.36.25）。

**D3 已完成但未出貨**：實作 + panel + 修補都做完，commit 在 `fix/d3-contract-admission-repair`
（`654f741d`），**尚未 merge develop、尚未版號、尚未 CHANGELOG/INDEX、尚未跑全套**。
接手第一件事就是把 D3 收尾（見下方「D3 收尾清單」）。

停在這裡是因為 context 到 T2（751k/1000k）。

## 已出貨

| 版本 | 交付項 | 內容 |
|---|---|---|
| v2.36.23 | P0 | supersession anchor manifest + `check-supersession-anchors.js`；被取代的 Board 裁決必須帶 dated 指標，plan 宣告不碰的區段用 sha256 釘住 |
| v2.36.24 | P1 | operator pin store：`jsonl-store.writeSnapshot` + `pin-seat`/`unpin-seat`/`pins`，八欄位列、`expires` 必為 null、`--operator` 必填、每 role 至多一列無墓碑 |
| v2.36.25 | P2 | `--resolve-live`：無寫入解析模式，回傳 preferred/effective tuple + `substitution_reason` + `pending_revocation` |

全套 334 支綠（綁分支的 worktree；detached worktree 會讓 `next-touch-validation` 假紅）。

## D3 收尾清單（接手第一件事）

分支 `fix/d3-contract-admission-repair`，HEAD `654f741d`，工作樹乾淨。已完成：

- grok-4.5 實作（`mission/bc88318c9bcc/d3-contract-admission-a1`）已 merge 進 feature 分支
- 三家族 panel 跑完並裁決（見下）
- 修補由 Claude sonnet 完成並驗過：71 assertions、紅證 depth-0 重推、canonical invariants 綠

**還沒做**：全套測試、版號（下一個是 **v2.36.26**）、CHANGELOG、INDEX 列、merge develop、push、reap。
版號前先 `git show origin/develop:.claude-plugin/plugin.json` 對號。

### D3 的 panel 是這輪最值得讀的一段

三席分歧：sol 與 GLM 都 FIX-THEN-SHIP 指向同一個洞，**MiniMax SHIP-AS-IS 並明確反駁**。
depth-0 判 sol/GLM 對，**依據不是票數是呼叫點枚舉**：`resolvedLiveHasSubstitution` 只有兩個
call site，都在 `!matched` 分支內 ⇒ preferred 席位有合格 row 時，替代永遠不被考慮。
MiniMax 的推理假設 `isAdmissibleScorecardRow` 檢查替代席的 row，但它比對的是契約**解析**的
引擎，也就是 preferred 席位。

**這是本輪唯一一次 panel 找到的是程式的洞而非測試瑕疵**（D1/D2 找到的都是空洞斷言）。

另外：**GLM 那席回 `no_verdict`**（framing 被 chrome 破壞，v2.34.7 家族），判決本體完好，
從 `raw_log` 撈回來才拿到那條 MUST-FIX。**丟掉 no_verdict 的席位就是丟掉一條發現。**

## 下一步：D4 起

plan 的 §4 剩下：strike fold + pending_revocation（KR3/KR4/KR7）→ 替代路徑（KR5/KR8/KR9/KR12）
→ negation + guidance + release（P7/P8/P9）。

**一個 mission 一個 deliverable**：governance `max_graph_depth: 2`、aggregate `max_gate_attempts: 12`、
且**一個 plan id 只能對應一個 graph node**。plan 的九個階段是 provenance，不是 DAG——不要試圖一次塞進去。

## 這輪最重要的發現

**三家族 panel 的第三席，兩次都一個人翻盤。** D1 和 D2 各是：MiniMax SHIP-AS-IS、GLM SHIP-AS-IS、
`gpt-5.6-sol` FIX-THEN-SHIP ×3。而且兩次都抓到**一條不可能失敗的測試**：

- D1 test 8：`grep withWriteLock` 匹配到的是區段自己的**註解**，拿掉鎖照樣綠
- D2 case 7：`if ...; then ok; else ok; fi`，兩個分支都通過

**三個交付項、三個不同引擎、三條不可能失敗的斷言**（D3 那條是
`assert_not_contains ... '"assurance":"operator-pin"'`——NO-GO payload 本來就不帶 `assurance`）。
這是規律不是巧合:**寫測試就會產出這種東西**。所以 `min_panel_size: 3` 與紅證都不可省。
修法的演進：D1 是把 grep 換成行為斷言（逐條修）；D2 是**遞迴檔案系統快照**（掃整棵樹，任何變動具名失敗）
——列舉只能找到你想得到要列的東西。

## 陷阱（rail）

- **managed rail 跑得動實作，跑不動修補。** 兩條獨立 lineage 確認為確定性：第二次（修補）必定在
  `prepare_implementation` 以 `MUTATION_FAILURE_EVIDENCE_REQUIRED` 卡死，claim 兩條路都撤不掉
  （`withdraw --never-started` 因已啟動被拒；`mission control --abort` 要 CLI 給不了的認證轉接器）。
  **實務後果：只要 review 判出要修，該輪就不可能是純 L5。** 修補改派 Claude hands。
- **修補的 grant 必須在實作 merge 之後拿**——契約在 grant 當下釘死 `base_sha`。D1/D2 各撞一次。
- `--mission-prepared <receipt>` 是原子 state store 的開關；缺了就 `mission_state_store_required`。
- `--campaign-ledger` 必須是 canonical 的 `.git/autopilot/implementation-campaign.jsonl`。
- **blocked intake 有時釋放 claim 有時不釋放**（`mission_grant_ref_mismatch` 不釋放），錯誤訊息講的是
  「base 過期」不是「上次拒絕沒收尾」。
- 未追蹤檔也算 dirty，spend 前就擋。
- 圖一改 digest 就變 → legacy disposition 要重綁 → marker 要重設，三件連動。
- authority envelope 只收 `authority_status: "shadow"`；mission 綁定欄位是**推導**的，不得由呼叫端給。
- `l5` marker 清不掉（rail 從未寫出 task-status 需要的 input bundle）。**不要手寫那個檔案去滿足閘門**
  ——那是製造閘門要檢查的證據。marker 24 小時後自然過期。

## 已驗證但未動工的外部情報

`docs/BACKLOG.md` 有兩列關於 agy payload 上限（2026-09-11）。摘要：peer 報 stream-json 繞開
argv 上限、建議拿掉天花板;**本機複驗結果相反**——175K 過、200K 靜默截斷且 status 仍 SUCCESS。
後續交換資料後又發現:(a) `agy --version` 讀的是**快取字串不是 binary 身分**（同一個 sha256
的 binary 在 update 前後報不同版本）——這直接影響 capability store 用 `runner_version` 當重考
觸發器的正確性;(b) 同版同 model 下兩台主機行為仍不同,所以牆可能是**部署屬性**（帳號/區域）。
結論:閾值不能是常數、也不能只是 per-seat（scorecard 跨機共用），可能得 rail 自己做尾端 nonce
自檢。**rail 一行未動**，這是 peer input 不是授權。

## 陷阱（自己）

- **變異測試要挑對變異點。** 本輪三次挑錯：拿掉 `renameSync`（等於永不寫入，剛好滿足斷言）、
  把 `withWriteLock(opts,fn)` 的頭換掉尾巴沒換（程式壞掉、無關斷言紅）、字面 anchor 被新註解打斷。
  已寫成 `references/evidence-discipline.md` §32：**看哪一條斷言動了，不是套件動了沒**。
- `pkill -f` 在 Bash 工具裡會比對到自己的指令列，把自己殺掉（exit 144）。用 PID。
- detached worktree 會讓 `next-touch-validation` 假紅（`git symbolic-ref --short HEAD` 無頭必失敗）。
  驗證用 worktree 一律 `-b <branch>`。
- 管線會吞退出碼：`node ... | head` 回報的是 `head` 的狀態。判成敗要分開捕獲。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain                                        # 空
node -p "require('./.claude-plugin/plugin.json').version"      # 2.36.25
bash hooks/tests/engine-capability-pin.test.sh | tail -1       # 9 passed, 0 failed
bash hooks/tests/resolve-live-tuple.test.sh | tail -1          # 15 passed, 0 failed（約 90s）
node scripts/check-supersession-anchors.js; echo $?            # 0
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh | tail -1   # 8/8
```

## Read-order

1. `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md` §4（階段）與 §8（已裁示）。
2. `references/evidence-discipline.md` §32。
3. `docs/BACKLOG.md` 的兩條 2026-09-11 列（pin store 硬化、campaign intake 缺陷）。
4. `docs/plans/evidence/2026-09-11-operator-pin-supersedes-qualification/`（四代 review 的裁決明細）。
