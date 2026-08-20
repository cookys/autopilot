## 目標
dispatch 可觀測性／review-loop roster 演進線的接續：v2.32.22–v2.32.30 九版已全數出貨推送，剩餘工作是「時間觸發的重驗」與 BACKLOG 上的設計殘項（S3 調度 policy、lease/steer、capability-store endpoint 維度）。

## 現況
- Branch: `develop`，clean，與 origin 同步（HEAD `dfac7fe` docs(index): v2.32.30 row）。無 stash、無 in-flight code。
- 本輪已出貨（全部已 push）：
  - v2.32.22 /tmp 殘骸保留期限三件套（usrquota 事故）
  - v2.32.23-24 risk-tiered low-risk reviewer（sol@high 校準 12/12；e2e 抓到預解析路徑死路並修復）
  - v2.32.25 family-conflict fallback（in-loop review 復活；8 輪 gpt-5.5 review）
  - v2.32.26 fallback 偏好序（高風險→claude-opus、低風險→claude-haiku；opus 校準 12/12＋clean 10/11）
  - v2.32.28 foreman live sensing（watch-foreman.js＋front-door § Live sensing 儀式；與並行 depth-0-economics 撞號後重編）
  - v2.32.29 `autopilot status` CLI（quota/runs/roster）
  - v2.32.30 quota 來源類別分組（subscription/metered-endpoint/provider-config/local）
- 另一台機器（twgs-dev 線）並行出貨了 opencode-v2 與 depth-0-economics（v2.32.27）；合流調和已完成。

## 已決事項(不重議)
- codex 額度**分池**：{gpt-5.5, gpt-5.6-sol} 共池（exhausted，reset ~2026-07-20 03:07 台北）；{gpt-5.3-codex-spark} 獨立且可用 — 判定一律逐模型極小探針，絕不跨模型外推。
- reviewer 座位表（dogfood config）：高風險=gpt-5.5@xhigh（池死時 fallback→claude-opus）、低風險=gpt-5.6-sol@high（池死時→claude-haiku）；qc_panel 不受 tier/fallback 影響。
- sol 只坐低風險位：METR 誠實性疑慮未被 known-bad 校準覆蓋（測抓漏不測壓力下誠實）——升格需 live 低風險輪紀錄，非 benchmark。
- fallback 每道 guard fail-closed 回舊 hard block；tuple 身分（engine+runner+effort+model）；scorecard 身分鍵只加不減（R7）。
- 感知≠調度：watch-foreman/QUIET/STALL 全 report-only；靜默先查回合間工作、絕不搶 leased stage（R6 two-cooks）。
- store TTL 過期觀測=ABSENT=unknown，不當活真相；metered endpoint 錢包身分=named endpoint（store 未記，輸出明標歧義）。
- codex spawn_agent：伺服器端鎖 schema；解法=兩行 config（hide_spawn_agent_metadata=false + tool_namespace="agents"，缺一不可），已進 cookys 的 ~/.codex/config.toml；官方 TOML model 欄在 0.144.x 壞的。
- grok 上游改名：grok-build → grok-4.5。

## 下一步
1. **2026-07-20 之後**：重探 codex 池（`codex exec --skip-git-repo-check -m gpt-5.5 "Reply with exactly OK" < /dev/null`，sol 同法）→ 結果記進 capability-state（enum: available|exhausted）→ `autopilot status quota` 確認。池回來後 roster 自動回原座位，零 config 改動。
2. BACKLOG 挑選（依觸發）：S3 調度 policy（地基全齊：S1 成本遙測＋S2 duplex＋S3-lite 感知）；R6 殘餘（lease/steer）；capability-store endpoint 欄（等第一個 metered producer）；usrquota 殘項 (d)（calibration scratch 改非配額路徑）。
3. dispatch-detach kill-survival flaky（PRE_EXISTING，時好時壞）：若要修，方向是 timing 去敏感化，非行為改動。

## 驗證方式
- `node bin/autopilot.js status` → 三段總覽（quota 分類分組、0 live runs、roster 座位含 ladder haiku>opus）。
- `bash hooks/tests/run.sh` → 131 檔全綠（dispatch-detach 偶發 flaky 可單獨重跑判定）。
- `git log --oneline -9` → 對得上上面九版；`git status` clean。

## Read-order
1. /home/cookys/projects/autopilot/CLAUDE.md — scripts inventory 已含本輪全部新面（watch-foreman、status CLI、reap、prune、tier/fallback 契約欄位）
2. /home/cookys/projects/autopilot/docs/projects/INDEX.md — 本輪每版一列含完整脈絡與 merge SHA
3. /home/cookys/projects/autopilot/docs/BACKLOG.md — 開放項（S3/R6/endpoint 維度/usrquota-d）與觸發條件
4. /home/cookys/projects/autopilot/skills/ceo-agent/references/level-front-door.md — § Live sensing 儀式＋roster 選位規則（tier/fallback/偏好序）
5. ~/.claude/projects/-home-cookys-projects-autopilot/memory/MEMORY.md — 本輪新增五條（usrquota、codex 分池、systemic-fix、observability 更新、tmp 教訓）

## 陷阱
- **前景 Bash 全 exit 1 零輸出**＝/tmp per-user quota 爆（df 全域量誤導）；probe＝直接寫檔看 EDQUOT；繞過＝background+redirect $HOME；清完免重啟。
- 長命令會被 harness 自動丟背景且 ~2min 斬殺——全套測試必須前景跑（timeout 600000）；被背景化就 TaskStop 再前景重跑。
- **mint 版本號前先 `git fetch`**：兩台機器同日撞 v2.32.27 一次；撞號=先推先贏、後推重編（opt-in gate 會要求當前版條目提名 stems）。
- develop 直 commit 觸 protected paths 需 QC-Verdict trailer（與 Co-Authored-By 同段落），否則 pre-push 擋。
- engine-scorecard `--emit-row` 只印不寫 store；persist 要另跑 `record --file`。
- scorecard row 的 engine id ≠ dispatch 字串時要帶 `model` 欄（claude-haiku 不可派，claude-native 要 `--model haiku`）。
- agy 模型名要全稱 `"Gemini 3.1 Pro (High)"`；grok 用 `grok-4.5`。
- codex/grok 額度耗盡期間的去相關 review：用 agy Gemini（對 anthropic 作者跨家族）。
