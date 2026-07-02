<div align="center">
  <table border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td valign="middle"><img src="docs/assets/icon.svg" alt="Autopilot" height="180"></td>
      <td width="24"></td>
      <td valign="middle"><img src="docs/assets/hero.svg" alt="Autopilot — 可獨立運作的 Claude Code 生命週期編排，與 Superpowers 並存" height="180"></td>
    </tr>
  </table>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-5A67D8?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/version-2.30.0-E8A838?style=flat-square" alt="v2.30.0">
  <img src="https://img.shields.io/badge/skills-27-4A90D9?style=flat-square" alt="27 Skills">
  <img src="https://img.shields.io/badge/agents-3-7C9E8C?style=flat-square" alt="3 Methodology Agents">
  <img src="https://img.shields.io/badge/hooks-22-6B8E6B?style=flat-square" alt="22 Hooks">
  <img src="https://img.shields.io/badge/dependencies-zero-A8B5A0?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D4A5A5?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp; <b>正體中文</b>
</p>

<p align="center">
  <b>你終端機裡的 AI 專案負責人。</b><br>
  Claude Code 負責寫程式，Autopilot 規劃它、委派它、用第二個引擎審查它、並記住學到的東西 —— 讓你不必盯著每一步就能交付。
</p>

<p align="center">
  <sub>提煉自 100+ 個使用 AI 驅動開發完成的專案。</sub>
</p>

```text
# autopilot 的可選 pre-push hook：
❯ git push
[autopilot] completeness scan …  ✗ TODO stub in auth.py:42
[autopilot] tests …              ✗ 1 skipped (payment flow)
[autopilot] review …             ⚠ unhandled error path
push blocked — fix it, or override with a reason
```

---

## What Is Autopilot?

Claude Code 很會寫程式，Autopilot 讓它**把整件事做完** —— 那些你本來得自己動手的規劃、檢查、決策與記憶：

- **給它目標，拿回結果** —— `/l3` `/l4` `/l5` `/l6` 和 `ceo-agent` 能把一個任務從頭跑到尾（判斷大小、規劃、實作、審查、收尾），只在真正該你拍板的決策點才停下來問。
- **第二個引擎來吵你的 code** —— 審查可以跑在**不同的**模型家族（GPT、Gemini）上，所以更多 bug 在使用者看到之前就被抓到，而不是被寫它的同一個模型蓋章放行。
- **抓出那種「假完成」** —— 無 stub/TODO 掃描、你的測試、真正的程式碼審查，在 quality gate 合併前跑（以及上面那個可選的 pre-push hook）。
- **會記住，所以你的 repo 不會爛掉** —— 記下教訓、追蹤專案、告訴你下一步做什麼，並從 `.claude/` 裡一個 markdown 檔適應你的 repo。

它是單一 Claude Code plugin —— **27 個 skill、3 個方法論 agent、22 個 hook、零相依**。可完全獨立運作，若你有 [`superpowers`](docs/coexistence.md) 也能並存。

> 這份 README 是 Claude 寫的，並透過 Autopilot 自己的「第二引擎審查」流程，由 GPT-5.5 與 Gemini 對抗式審查而成。

> 第一次來？這頁是 5 分鐘導覽。更深的內容都在 **[Learn More](#learn-more)**。

## A Day With Autopilot

`dev-flow` 是前門。它判斷任務大小並分流 —— 小事直接過閘門，大事變成被追蹤的專案：

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/flow.zh-TW.light.svg">
    <img alt="Autopilot 的一天：dev-flow 判斷任務大小並分流 —— 小事直接過品質閘門到 commit；大事變成被追蹤的專案，每個 phase 都過品質閘門，最後 finish-flow 乾淨收尾。沒有 Autopilot 時，AI 會立刻 grep 程式碼 —— 沒計畫、沒分 phase、沒品質閘門。" src="docs/assets/flow.zh-TW.svg" width="100%">
  </picture>
</p>

沒有 Autopilot 時，Claude 會立刻開始 grep 程式碼 —— 沒有 plan、沒有 phase、沒有品質閘門。有了它，紀律是自動的。

## Quick Start

```bash
/plugin marketplace add cookys/autopilot
/plugin install autopilot@autopilot
```

就這樣。接著**直接跟 Claude 講** —— Autopilot 的 skill 會依你說的話觸發：

```
你：「我要開始做 WebSocket 壓縮」      → 判斷大小，建立 plan + 分支 + 品質閘門
你：「快速修一下 auth 的 null check」  → 快速路徑，commit 前仍經過閘門
你：「下一步做什麼？」                 → 掃描你的專案並排序
你：「搞定這個重構，你決定」            → 全自動 CEO 模式
```

不用背指令 —— 用你自己的話說出來，對的 skill 就會接手。

## What It Does

27 個 skill，依你想做的事分組。每個都從自然語言觸發 ——「Try saying」列出的就是真正的觸發語。

### ✍️ 寫程式

`dev-flow`（從這開始 —— 判斷大小並分流）· `quality-pipeline`（測試 → 掃描 → 審查）· `finish-flow`（乾淨收尾，一步不漏）。

> **Try saying：** *「我要開始做 X」* · *「快速修一下 Y」* · *「準備好可以 commit 了嗎」*

### 🧭 做決策

`survey`（雙 agent 業界調研）· `think-tank`（6 角色辯論）· `brainstorm`（寫程式前的設計探索）· `think-tank-dialectic`（不可逆、高風險決策）。

> **Try saying：** *「業界怎麼做 X？」* · *「該重寫還是修補？」* · *「要辯論一下」*

### 🤖 全自動

`ceo-agent`（你定目標，它執行）· `/l3` `/l4` `/l5` `/l6`（簡潔前門，預填 CEO 啟動四問，一行就把目標送出去）。各級的差別在**實作在哪裡跑**：

| | 在哪裡跑 | 何時用 |
|---|---|---|
| **`/l3`** | inline，這條 thread 上 | 全自主，但你想盯著它跑 |
| **`/l4`** | 一個背景、worktree 隔離的 **foreman** | 想把長時間自主跑的工作 offload — 你的 context 保持乾淨，權威品質判定握在 depth 0 |
| **`/l5`** | 同 `/l4`，但**實作交給不同引擎**（agy / Gemini） | 成本套利，或讓一個去相關化的第二引擎做機械式實作 |
| **`/l6`** | 同 `/l5`，再把**驗證撰寫**交給不同引擎 | 想把實作與驗證撰寫都外包，但 depth 0 仍保留合併權限 |

```
/l3 fix the flaky reconnect test, you decide     # inline
/l4 ship the WebSocket reconnect system          # offload 給背景 foreman
/l5 migrate the config loader to the new schema  # foreman + 異質實作引擎
/l6 ship the parser rewrite                      # 異質實作 + 異質驗證撰寫
```

> **Try saying：** *「CEO 模式，幫我處理」* · *「全權處理」* · *「/l4 把重連系統做掉」*

**→ 各級行為、預設值、override flags（`--expand` / `-x` / `--solo`）與完整範例：[docs/skills.md](docs/skills.md)。**

### 📈 自我改進

`learn`（記錄教訓）· `retro`（git 歷史回顧）· `next`（接下來做什麼）· `distill`（把你重複的流程變成個人 skill）· 以及 `debug` · `profiling` · `test-strategy` · `audit` · `doc-sync`。

> **Try saying：** *「記下來供下次使用」* · *「回顧這週」* · *「最高優先是什麼？」*

**→ 全部 27 個 skill 的完整目錄、三種認知模式、以及彼此如何組合：[docs/skills.md](docs/skills.md)。**

## Install

**Claude Code**（主要）—— 上面那兩行指令。27 個 skill 立即可用，如 `autopilot:dev-flow`、`autopilot:survey` 等。

### 其他平台

Autopilot 可攜：**OpenCode** 透過 `.agents/skills/` 發現 skill，**Codex** 可使用 `.agents/skills/` 或 `platforms/codex/plugin` 的 local package（manifest 只暴露 skills，但 payload 會包含支援檔），**Antigravity（`agy`）** 則將 repo 作為 Claude Code-source plugin 匯入，另有 Windows 與 pre-commit 閘門設定。完整的各平台說明，以及貢獻者 **dev-mode** 流程，都在 **[docs/installation.md](docs/installation.md)**。

## Learn More

深入的內容，移出本頁讓它保持為 onboarding 導覽：

| 主題 | 文件 |
|------|------|
| **全部 27 個 skill** + 三種模式 + 如何組合 | [docs/skills.md](docs/skills.md) |
| **Superpowers 並存** —— 三種情境、遷移 | [docs/coexistence.md](docs/coexistence.md) |
| **各專案設定** —— `.claude/` 注入模型 | [docs/configuration.md](docs/configuration.md) |
| **安裝與開發** —— 每個平台、dev mode | [docs/installation.md](docs/installation.md) |
| **架構與設計** —— 哲學、方法論 agent、致謝 | [docs/architecture.md](docs/architecture.md) |
| **Hooks** —— 22 個 runtime 強制 hook（分層見該文件） | [hooks/README.md](hooks/README.md) |
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |

## License

MIT —— 詳見 [LICENSE](LICENSE)。
