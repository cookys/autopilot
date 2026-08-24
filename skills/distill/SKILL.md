---
name: distill
description: >
  Distill your recurring procedures and corrections from local conversation history into personal
  custom skills, routed into YOUR own skill dirs — never into autopilot. Boundary: learn records
  facts/gotchas; distill produces reusable procedures. Use when: "/distill",
  "what do I keep redoing", "turn my repeated workflow into a skill", "提煉我的重複流程",
  "把我反覆做的變成 skill", "我一直在重複做什麼", "把剛做完的專案蒸餾成 skill", "趁熱把這套流程收下來", "這個專案的方法論值得留", "distill this project/session". Not for: writing autopilot's own skills, project
  planning (→ dev-flow), saving a one-off fact/gotcha (→ learn), or git-history productivity metrics
  (→ retro, the commit-history sibling; "session analysis" there means commit windows, not distill's
  conversation-session corpus).
---

# distill — your recurring procedures → your personal skills

autopilot ships this **distiller** (the factory). The skills it produces are **yours** (the products)
and land in **your** skill dirs, never in autopilot's repo. Mirrors how CC's `run-skill-generator`
writes a per-project skill; autopilot only ships the generator.

## Where products go — scope-aware routing
- **Global** → `~/.claude/skills/autopilot-distill-skills/skills/<slug>/SKILL.md` — a **skills-directory
  plugin pack** (`autopilot-distill-skills@skills-dir`) that is also a **private git repo = your fleet
  sync unit**, namespaced + separate from your hand-authored personal skills.
- **Project-specific** → `<project>/.claude/skills/<slug>/SKILL.md` — rides that project's own git.

Routing is decided by the originating project (`cwd`) of each signal.

## Step 1 — Scan (deterministic, no LLM) — incremental by default
```
# routine run: only sessions new/changed since last distill (remembers a per-session cursor)
node ${CLAUDE_PLUGIN_ROOT}/scripts/distill-scan.js --real-only --new-only
# first ever run, or "show me everything again": drop --new-only for the full cumulative report
node ${CLAUDE_PLUGIN_ROOT}/scripts/distill-scan.js --real-only
```
Emits frequency **atoms** in two buckets: **ritual candidates** (de-noised procedural command
n-grams) and **correction candidates** (recurring user-friction contexts). Evidence (counts, source
project) is deterministic — never invented. `--json` for machine output; `--top N` to widen.

**Cursor (`--new-only` / `--incremental`).** Each session jsonl is scanned **whole exactly once**;
its per-session atom contribution is cached in `~/.autopilot/distill/scan-state.json` keyed by
`{size, mtime}`. Unchanged (completed) sessions are reused — only new/grown ones are re-read.
**Cumulative totals stay identical to a full scan** (the ≥N× value gate is unaffected); the cursor
only changes *which* sessions are re-read and, with `--new-only`, filters the report to candidates
whose cumulative count **rose this run** — i.e. "what's newly worth distilling since last time". This
is what makes `/distill` cheap to re-run: it picks up where it left off instead of re-proposing what
you already triaged. (Deliberately NOT a raw byte-offset — that would split a session's command
sequence across runs and risk a half-written trailing line. See the script header.)

## Step 2 — Propose (≤7 per bucket, from atoms only)
Name each genuinely recurring procedure; **abstract to generic steps**. **Refuse to propose a procedure
that cannot be expressed without a specific literal** (inherently-specific) — unless self-use scope,
where the user's own identifiers (their git email, their host alias) may stay. Classify each candidate's
scope (global vs which project) from its `cwd`.

## Episodic mode（情節模式）— the second signal source

Frequency mode scans history for what you KEEP redoing; episodic mode distills what you
JUST finished while the memory is hot. Complementary by design — 頻率管跨週遺忘的長尾,
情節管熱記憶的深流程. Both structural blind spots of the ≥3× frequency threshold are
episodic territory (2026-07-04 first full scan, empirical): a once-only project-scale
methodology never crosses the frequency bar, and compound-command rituals are invisible
to the tokenizer (scanner recall fixes are a separate BACKLOG item — not this mode's job).

Triggers: 「把剛做完的專案蒸餾成 skill」「趁熱把這套流程收下來」「這個專案的方法論值得留」,
"distill this project/session" — or arriving from finish-flow L-5.6's evaluation question.

Steps 1E–2E replace Steps 1–2 ONLY. Everything from Step 3 on (identifier lint, human
gate, normalize-slug, write + commit-on-approve, pack sync / consolidate) is the SAME
pipeline — episodic products get zero special handling downstream.

### Step 1E — Episodic retrospection (LLM judgment, not a scan)

Answer four questions about the just-finished project / long session:

1. Is there ONE **transferable** end-to-end procedure here (still valid on a different topic)?
2. Which steps got **reworked**? (every rework = one rule with a body behind it)
3. Which parts are already scripted/templated? (the load-bearing split of a skill
   triple: **prose carries judgment, files carry templates/scripts, pointers carry
   artifacts** — RED-tested: templates stay immune where prose gets shot)
4. **Who** executes this in the future (yourself / a weaker model / another harness)?
   → sets checklist granularity: for weak models, enumerate down to mechanically
   self-checkable items (RED's fourth law: self-assessment distortion is a function of
   checklist granularity).

### Step 2E — Propose (≤3, scarcity over volume)

Each candidate MUST cite its **source event** (which rework / which decision) — not a
frequency count. A candidate that cannot name a concrete source event is not proposed.
Routing follows the existing rules (global → pack; project-specific → that project's
`.claude/skills`).

### Step 2E-quality (optional, recommended) — RED acceptance

For products meant to be shared or executed by weaker models, run one RED round
(headless weak model on a real task → autopsy the artifacts only → enumerated patch).
Methodology reference (external — lives in YOUR pack, never in autopilot): skill-red-testing.

## Demotion drafting (quality-floor P4)

Demotion drafting (quality-floor P4): from retro's escalation aggregate (or a direct `tree.js escalations` sweep), for each recurring escalation draft a CANDIDATE stub — a `references/probe-playbook.md` entry (4 mandatory fields per its schema) if the escalation was resolved by a novel probe, or a `references/acceptance-patterns.md` addition if it was an acceptance gap. Candidates are DRAFTS: they go through this skill's existing human-gated review before merging; never auto-append to the catalogs.

## Step 3 — Review (human gate — the privacy backbone) — batch multi-select
The gate stays, but the *friction* is collapsed: present the whole candidate list **once** and let the
user pick which to accept in a single `AskUserQuestion` (`multiSelect: true`) instead of one
yes/no per candidate. Approval is still **explicit and per-candidate** — nothing is written that the
user did not tick.

**Step 3 的機械前置**:對每份 draft `SKILL.md` 跑
[`scripts/identifier-scan.js`](../../scripts/identifier-scan.js)(僅偵測結構化 token:email / IPv4 /
`/home/<user>/` / FQDN / key 形狀 —— 覆蓋範圍以該腳本的 test fixtures
`hooks/tests/fixtures/identifier-scan/` 為準,不以本段文字為準)。

**exit 1 的意思是「這些請分類」,不是「這個 candidate 不合格」。** 命中的 token 逐一攤給使用者看,
由使用者判定或參數化;清掉之後該 candidate 照常進入可選集。**不要**因為 exit 1 就靜默把 candidate
踢出批次 —— 這支 scanner 偵測的是**形狀**,而好幾種形狀本來就可以公開:廠商域名(`z.ai`、
`example.com`)會命中 `fqdn`,合成 fixture 身分(`bot@test.local`)會命中 `email`。實測本 repo 已公開的
四份 knowledge 檔:5 個命中,**5 個都是該公開的**。把這類命中當成不合格,只會訓練出「看到紅燈就跳過」
的習慣,而那個習慣正是真 token 溜過去的路徑。

**非結構化識別字(bare hostname、client 名、pane 位址、endpoint alias)沒有任何機械偵測 —— 唯一防線
是本步的人審**。人審時必須假設 scanner 對這類東西什麼都沒看到:clean exit 的意思是「沒有結構化 token
命中」,永遠不是「可以公開」。逐 draft 對照
[`references/knowledge-routing.md`](../../references/knowledge-routing.md) §2 的類別 checklist。

(不設 deny-list:一份已知主機名清單會靜默放行它沒被告知過的每個名字,然後掛上 "lint-clean" 標籤 ——
那個標籤證明的是「查過一份清單」,不是「這段文字乾淨」。ADR-0001 判此為 attestation,且比沒有 lint 更
毒,因為它製造出結束人審的信心。理由記在 knowledge-routing.md §5。)
- **Clean candidates** → offered together in the multi-select. Ticking = approval.
- **Lint-flagged candidates** → do NOT put them in the batch silently. Surface each flagged token to
  the user individually first; only after they clear/parameterize it does that candidate join the
  selectable set. A flagged identifier must never ride into the pack on a batch tick.

This keeps the privacy backbone (no auto-write of anything the lint touched) while giving the
"distill, then accept a batch" UX. For **self-use scope**, the user's own identifiers (their git
email, their host alias) may stay — that exemption is theirs to grant per candidate, not a default.

## Step 4 — Write + **commit-on-approve** (atomic durability)
On approval, write a well-formed `SKILL.md` (`name` + `description` so `scripts/validate.sh` passes;
body = the generic procedure). Parameterize identifiers; keep real values in `~/.ssh/config` / local
config, not in the synced skill body.

**Normalize the slug (pack scope) — the cross-machine convergence key.** Before writing, run the slug
through the deterministic normalizer so two machines that name the *same* procedure land on the *same*
path (the precondition for `consolidate` in Step 5 to ever fire):
```
slug=$(${CLAUDE_PLUGIN_ROOT}/scripts/distill-consolidate.sh normalize-slug "<llm-chosen-slug>")
```
It lowercases, drops a tiny stopword set (`fix`/`ensure`/`setup`/…), and **preserves token order** (no
sort — readability kept), so `fix-git-identity`, `git-identity-fix`, `ensure-git-identity` all converge
to `git-identity`, while antonym pairs (`add-user` vs `remove-user`) stay distinct. Use the normalized
`slug` for the pack write path; set the frontmatter `name:` to match. (Project-scoped skills keep the
LLM's literal slug — a project has one repo, no fleet of writers to converge.)
- **Global (pack) → write AND commit in the same step** (do NOT leave an approved skill as a loose
  uncommitted file — a concurrent session's destructive git op or a crash would lose it):
  ```
  cd ~/.claude/skills/autopilot-distill-skills
  # write skills/<slug>/SKILL.md, then immediately:
  git add skills/<slug>/ && git commit -m "distill: <slug>"
  ```
  Now the approved skill is in git history → recoverable even under concurrency / machine loss.
  First-ever pack: scaffold `.claude-plugin/plugin.json` + `git init` first. (Creating `~/.claude/skills/`
  the first time needs one CC restart; adding a skill to an already-loaded pack may need `/reload-plugins`.)
- **Project → write UNSTAGED** with an explicit "I wrote X — review and commit" note; never auto-commit
  into the user's project repo. Durability there is the user's via their project git. Refuse on
  same-name collision.

## Step 5 — Sync + **proactive consolidate** (one push-back prompt)
The approved skill is **already committed locally** (Step 4). Sync = propagate that commit. After a
batch of approvals, ask the user **once** (not per skill) "push these N distilled skills back to the
shared private pack?" — a single yes/no.

**Before pushing, check each pushed slug for cross-machine divergence — proactively, NOT by triggering a
merge conflict.** For every `<slug>` in the batch:
```
${CLAUDE_PLUGIN_ROOT}/scripts/distill-consolidate.sh compare <slug>   # JSON: identical|divergent|absent-theirs|absent-mine
```
- **`identical` / `absent-theirs`** (no upstream divergence) → nothing to do; this slug just pushes.
- **`divergent`** (another machine already pushed a different `SKILL.md` for the same normalized slug) →
  **consolidate it now, in the clean working tree** (no rebase/merge state is ever entered — this is the
  whole point of comparing *before* committing the push):
  1. Read both variants: `mine` = the working-tree `skills/<slug>/SKILL.md`; `theirs` =
     `git -C <pack> show @{u}:skills/<slug>/SKILL.md`.
  2. **LLM-merge** them into one canonical: union of distinct procedural steps, dedup phrasings, keep the
     clearer wording, preserve `name:`/`description:`. **If the two variants are not recognizably the
     same procedure, STOP** and hand to the user — do not merge unrelated content (the normalizer can,
     rarely, over-collapse two distinct procedures; this is the backstop).
  3. **Lint the merged draft** (`scripts/identifier-scan.js` + the human category check, Step 3) — a merge can surface an identifier
     neither half flagged alone. Then **human-gate** it (`AskUserQuestion`: approve / edit / reject).
  4. On approve → overwrite the working-tree `skills/<slug>/SKILL.md` with the canonical, `git add`,
     `git commit -m "consolidate: <slug>"`. On reject → leave yours; STOP/handoff that slug.

Then push (normal, no merge commit — the canonical already contains theirs, so the rebase applies clean):
```
git -C ~/.claude/skills/autopilot-distill-skills pull --rebase   # absorb other machines
git -C ~/.claude/skills/autopilot-distill-skills push            # share the consolidated canonical
```
Other machines pick the canonical up on their next sync (both variants are now ancestors → no
re-conflict). Convergence is **DAG-level**; if a 3rd machine later adds yet another variant, the
canonical is re-merged then (content converges as variants stop arriving, not via a fixpoint guarantee).
Concurrent same-slug consolidate self-heals via git's push-reject (second push rejected → pull → re-merge).
**Rollback** (a bad canonical that already pushed): `git -C <pack> revert <sha> && git push`; other
machines absorb the revert next sync — but if a peer already re-consolidated on top, the revert is itself
a same-slug conflict → manual STOP. See [references/sync-setup.md](references/sync-setup.md). Project
skills ride the project's own git; guard first-run by setting upstream first.

### The full automated loop (what `/distill` does on a routine re-run)
1. `distill-scan.js --real-only --new-only` → only candidates new since the last cursor.
2. Propose (Step 2) → lint each (Step 3) → **one batch multi-select** of the clean ones.
3. Selected → normalize slug + write + `git commit` into the pack (Step 4, commit-on-approve).
4. **One** "push back to the shared pack?" yes/no → `compare` each slug → consolidate any `divergent` one
   (human-gated) → `pull --rebase` then `push` (this step).
The cursor advances automatically, so the next `/distill` resumes from new conversations only.

> **Correctness note**: the deterministic scripts (`normalize-slug` / `migrate` / `compare`) are tested
> for git-plumbing correctness; the **LLM merge quality is human-gated, not test-gated** — the human gate
> (step 3 above) is the real backstop for whether a consolidation is correct.

### One-time migration (existing packs)
A pack created before slug-normalization may hold non-normalized dirs (`fix-git-identity` etc.). Run once
per pack to rename them (dir **and** frontmatter `name:`) to their canonical slug so future cross-machine
compares line up:
```
${CLAUDE_PLUGIN_ROOT}/scripts/distill-consolidate.sh migrate    # git mv staged — review + commit
```
If two existing dirs normalize to the *same* slug it STOPs (a real consolidation case — resolve by hand,
don't let `migrate` merge them). Tell the user to commit the rename + push so the fleet converges.

### First-run setup — guided (run BEFORE relying on distilled skills)
Don't make the user hand-copy git plumbing (the `.gitignore` negation is easy to get wrong — the
obvious `.claude/` + `!.claude/skills/` is silently broken). Drive it with the script:

1. **Detect state**: `scripts/distill-sync-setup.sh status` (JSON: pack exists? has remote? + a
   next-step hint on stderr).
2. **If the pack has no remote** (durability risk — a single on-disk copy), ask the user with
   `AskUserQuestion` *before* proceeding:
   - **Q "This machine's role?"** → *Set up the pack's backup remote here* (machine #1) /
     *Enrol this machine from an existing remote* (already have a pack elsewhere) / *Skip — local only*.
   - If they pick a remote path, ask for the git URL, then run `distill-sync-setup.sh init-remote <url>`
     (machine #1) or `enroll <url>` (new machine). Both are idempotent.
3. **For a PROJECT-scoped skill** you just wrote, if `git -C <repo> check-ignore .claude/skills/<name>/SKILL.md`
   prints anything, the repo ignores it and it will never propagate. Run
   `scripts/distill-sync-setup.sh fix-gitignore <repo>` (idempotent; emits the correct `.claude/*`
   + `!.claude/skills/` form and verifies), then tell the user to commit the `.gitignore` change.

Only ask when a decision is genuinely needed — if `status` shows a remote already configured, skip
the questions and just sync.

> **Durability — the pack MUST have a remote.** A single on-disk copy is one `rm -rf` from total loss.
> The remote is **backup, not just sync** — set it up before relying on distilled skills (see
> sync-setup.md). Concurrency is loss-safe given commit-on-approve.

## Multi-machine consolidate (shipped — Step 5 `compare`)
Two machines distilling the same procedure now converge automatically: the slug normalizer (Step 4)
makes them collide on one path, and Step 5's **proactive `compare`** detects a `divergent` upstream
variant *before* committing the push, so the human-gated LLM merge runs in the clean working tree —
**never inside a held rebase/merge transaction**. The earlier per-host-staging design was rejected (it
regressed Claude Code skill loading and used a self-defeating content-hash key); see
[plan 2026-06-04-distill-consolidate](../../docs/plans/2026-06-04-distill-consolidate.md) §v3 for the
design and the two dialectic rounds behind it.

## Available scripts
| Script | Purpose |
|--------|---------|
| [`scripts/distill-scan.js`](../../scripts/distill-scan.js) | Deterministic history scanner → frequency atoms (two buckets). `--real-only`, `--json`, `--top N`. **Cursor:** `--incremental` reuses cached per-session atoms (only re-reads new/changed jsonl; totals identical to full scan); `--new-only` reports only candidates risen since last run. State in `~/.autopilot/distill/scan-state.json`. No LLM in the count path. |
| [`scripts/identifier-scan.js`](../../scripts/identifier-scan.js) | Structured-identifier scanner for the Step 3 gate (file / dir / stdin; `--json`; exit 1 ⇒ findings, 2 ⇒ usage). Covers email / IPv4 / `/home/<user>/` / FQDN / key shapes — covered set pinned by `hooks/tests/fixtures/identifier-scan/`. **Zero coverage of bare hostnames, client names, pane addresses, endpoint aliases** — that class is the human gate's job (`references/knowledge-routing.md` §5). |
| [`scripts/distill-sync-setup.sh`](../../scripts/distill-sync-setup.sh) | Onboarding plumbing for pack sync: `status` / `init-remote <url>` / `enroll <url>` / `fix-gitignore [repo]`. Idempotent; emits the **correct** `.claude/*` + `!.claude/skills/` negation (the obvious `.claude/` form is silently broken). Drives Step 5 first-run setup. |
| [`scripts/distill-consolidate.sh`](../../scripts/distill-consolidate.sh) | Cross-machine consolidation plumbing (deterministic, no LLM): `normalize-slug <raw>` (machine-stable slug — lowercase + drop tiny stopword set + preserve order), `migrate [pack]` (one-time: rename existing dirs to normalized slugs **and rewrite each frontmatter `name:`** — a skill's identity is its `name:`, so both must converge; STOPs on collision), `compare <slug> [pack]` (**proactive** divergence check against `@{u}` → JSON `identical`/`divergent`/`absent-theirs`/`absent-mine`; no merge-conflict state). The human-gated LLM merge lives in Step 5, not the script. |
