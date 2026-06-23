# Handoff — collect the `/l4 /l5` task-width metric across a real fleet

**Why**: autopilot's own S0.a measured ~9-13% wide (below the 15-20% gate), but
autopilot is a plugin/docs repo — a biased sample. The honest test is whether
*real* repos with genuine feature-branch dev supply enough ≥4-wide tasks. First
local cross-repo run already challenged the descope: of the **measurable**
repos (real feature-merge history) most cleared the gate at depth-2. But n was
tiny (2-3). This handoff collects more measurable repos from the rest of the
fleet (other machines / accounts that this session can't see).

**Instruments** (all in `scripts/`, deterministic, no LLM in the count path):
- `measure-task-width.sh` — per-repo probe. Samples feature merges, filters
  pull-sync merges, emits a `confidence` flag, prints a depth × churn matrix.
- `task-width-fleet.sh` — `scan` (find+probe all repos under roots, optionally
  `--submit` to an endpoint) and `aggregate` (dedup by remote, gate over
  `confidence==ok` repos only).
- `task-width-ingest.py` — tiny stdlib inbox server so machines POST instead of
  pasting.

## ► Paste this to a remote agent (copy verbatim, fill the 3 placeholders)

> 你是一台真實開發機器上的 coding agent。任務:量測這台機器上所有 git repo 的
> 「任務寬度」指標,並透過 API 回傳。只負責採集,不要詮釋或建議。
> 需要 `bash` + `git` + `curl`(不需要 python3)。
>
> 1. 更新工具(autopilot 多半已 dev-mode 安裝在 `~/projects/autopilot`,追 develop):
>    ```
>    cd ~/projects/autopilot && git pull --ff-only origin develop
>    # 若這台沒有 autopilot dev clone,改淺 clone:
>    # git clone --depth 1 https://github.com/cookys/autopilot ~/.cache/autopilot-tool
>    ```
>    後面假設工具在 `~/projects/autopilot`;若你用了 fallback clone,把路徑換成
>    `~/.cache/autopilot-tool`。
> 2. 找出這台機器上「放開發專案」的根目錄(常見:`~/projects ~/code ~/work
>    ~/src ~/dev`;挑實際存在、底下有 git repo 的,可多個)。
> 3. 量測 + 回傳(跑完自動 POST,不留檔、不用貼):
>    ```
>    TASK_WIDTH_TOKEN=<SECRET> bash ~/projects/autopilot/scripts/task-width-fleet.sh scan \
>      --root <你的repo根目錄> [--root <第二個> ...] \
>      --submit http://<BOX>:8787
>    ```
> 4. 把 stderr 最後幾行回報我:`probed/skipped/found` 計數 + `ingest reply`。
>    若 `ingest reply` 不是 `{"ok": true, ...}` 或 curl 失敗,改把
>    `~/.autopilot/task-width/<hostname>.jsonl` 整個內容貼回來(fallback)。

把 `<BOX>` 換成 ingest 機器的位址、`<SECRET>` 換成 `TASK_WIDTH_TOKEN`(下節)。
token 用環境變數傳(別放命令列,會進 `ps`/shell history)。一台機器跑一次;
若有多個 git 身分(帳號),每個身分各跑一次。

## Collection — endpoint flow (preferred, no paste)

1. **On the always-on box** (where the maintainer runs Claude), start the inbox:
   ```
   TASK_WIDTH_TOKEN=<shared-secret> \
     python3 scripts/task-width-ingest.py --bind 0.0.0.0 --port 8787
   ```
   (Bind to a fleet-private interface / tailscale IP; the token gates POSTs.)
2. **On every other machine / account**, one command — probes all repos and
   POSTs results, leaves nothing to copy:
   ```
   bash scripts/task-width-fleet.sh scan --root ~/projects \
        --submit http://<box>:8787 --token <shared-secret>
   ```
   Run once per machine; run again per account if git identities differ.
3. **Back on the box**: `curl http://localhost:8787/report` (or read
   `~/.autopilot/task-width/inbox.jsonl` directly / hand it to Claude).

## Collection — fallback (no network between machines)

Run `bash scripts/task-width-fleet.sh scan --root ~/projects` on each machine,
collect the per-host `~/.autopilot/task-width/*.jsonl` into one dir, then
`bash scripts/task-width-fleet.sh aggregate ./collected/*.jsonl`. Pasting the
JSONL into a Claude session also works — it's one self-describing object per line.

## Reading the result (for the maintainer)

- **Only `confidence==ok` repos count toward the gate.** Low-conf rows
  (commit-mode, <20 feature merges, shallow clones) are listed but excluded —
  their ~0% is a sampling artifact, not narrowness. Most of a typical fleet will
  be low-conf (solo direct-to-main, vendored clones, non-software repos); that
  is itself a finding (the population where width fan-out applies is thin).
- Use the depth row matching each repo's layout (flat→d1, `src/<module>`→d2,
  deep→d3) at churn≥25..50. The matrix is an **upper bound** (file-disjoint ≠
  semantically independent).
- Before flipping the descope: run `measure-task-width.sh --show-wide` on each
  over-gate repo and confirm the wide tasks are genuinely INDEPENDENT features,
  not one theme spread across dirs (the `ceo-fleet-autonomy` l3/l4/l5 pattern).

## Decision rule

Across the **measurable** repos: a *consistent* wide regime (most over the gate,
semantically verified) reopens Tier-2 / Phase L. A handful of borderline or a
single outlier does not — ship the S1 scope-hygiene guard and stop.
