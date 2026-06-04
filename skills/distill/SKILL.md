---
name: distill
description: >
  Distill your recurring procedures and corrections from local conversation history into personal
  custom skills, routed into YOUR own skill dirs — never into autopilot. Use when: "/distill",
  "what do I keep redoing", "turn my repeated workflow into a skill", "提煉我的重複流程",
  "把我反覆做的變成 skill", "我一直在重複做什麼". Not for: writing autopilot's own skills, project
  planning (→ dev-flow), or git-history productivity metrics (→ retro, the commit-history sibling).
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

## Step 3 — Review (human gate — the privacy backbone) — batch multi-select
The gate stays, but the *friction* is collapsed: present the whole candidate list **once** and let the
user pick which to accept in a single `AskUserQuestion` (`multiSelect: true`) instead of one
yes/no per candidate. Approval is still **explicit and per-candidate** — nothing is written that the
user did not tick.

**The lint runs first, per candidate, and gates the batch.** Run the identifier lint + the user's
deny-list (`~/.autopilot/distill/identifiers.deny`, one real hostname/client name per line) on every
draft `SKILL.md`. The lint reliably catches structured tokens (email / IPv4 / `/home/<user>/` / FQDN /
key-shapes); bare hostnames and client names are the **gate's** job.
- **Clean candidates** → offered together in the multi-select. Ticking = approval.
- **Lint-flagged candidates** → do NOT put them in the batch silently. Surface each flagged token to
  the user individually first; only after they clear/parameterize it does that candidate join the
  selectable set. A flagged identifier must never ride into the pack on a batch tick.

This keeps the privacy backbone (no auto-write of anything the lint touched) while giving the
"distill, then accept a batch" UX. For **self-use scope**, the user's own identifiers (their git
email, their host alias) may stay — that exemption is theirs to grant per candidate, not a default.

## Step 4 — Write + **commit-on-approve** (atomic durability)
On approval, write a well-formed `SKILL.md` (`name` + `description` so `scripts/validate.sh` passes;
body = the generic procedure). **Plain slug**, no staging. Parameterize identifiers; keep real values
in `~/.ssh/config` / local config, not in the synced skill body.
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

## Step 5 — Sync (manual git, transport-agnostic) — one push-back prompt
The approved skill is **already committed locally** (Step 4). Sync = propagate that commit. After a
batch of approvals, ask the user **once** (not per skill) "push these N distilled skills back to the
shared private pack?" — a single yes/no. On yes:
```
git -C ~/.claude/skills/autopilot-distill-skills pull --rebase   # absorb other machines first
git -C ~/.claude/skills/autopilot-distill-skills push            # share yours back
```
The **pull-before-push** is mandatory — it folds in other machines' distilled skills before you share
yours. If the pull hits a same-name `SKILL.md` **conflict**, STOP and hand it to the user to resolve
(the deferred multi-machine `consolidate` case — never auto-merge another machine's skill). Other
machines pick yours up on their next `pull`. Project skills ride the project's own git. Syncthing on
the pack folder is the no-git alternative. Guard first-run: set upstream first. Full setup:
[references/sync-setup.md](references/sync-setup.md).

### The full automated loop (what `/distill` does on a routine re-run)
1. `distill-scan.js --real-only --new-only` → only candidates new since the last cursor.
2. Propose (Step 2) → lint each (Step 3) → **one batch multi-select** of the clean ones.
3. Selected → write + `git commit` into the pack (Step 4, commit-on-approve).
4. **One** "push back to the shared pack?" yes/no → `pull --rebase` then `push` (this step).
The cursor advances automatically, so the next `/distill` resumes from new conversations only.

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
> sync-setup.md). Concurrency is loss-safe given commit-on-approve: the worst case is a same-skill
> merge conflict to resolve by hand (the deferred `consolidate` case), never lost data.

## Deferred (do NOT build until it's needed)
Multi-machine **consolidate** (per-host staging + LLM-merge of variants) is deferred until a real
cross-machine conflict actually occurs — the trigger is the first `git pull` conflict on a pack
`SKILL.md`. Until then a single hand-resolved merge is the entire cost. See plan §0.3.1 (DEFERRED).

## Available scripts
| Script | Purpose |
|--------|---------|
| [`scripts/distill-scan.js`](../../scripts/distill-scan.js) | Deterministic history scanner → frequency atoms (two buckets). `--real-only`, `--json`, `--top N`. **Cursor:** `--incremental` reuses cached per-session atoms (only re-reads new/changed jsonl; totals identical to full scan); `--new-only` reports only candidates risen since last run. State in `~/.autopilot/distill/scan-state.json`. No LLM in the count path. |
| [`scripts/distill-sync-setup.sh`](../../scripts/distill-sync-setup.sh) | Onboarding plumbing for pack sync: `status` / `init-remote <url>` / `enroll <url>` / `fix-gitignore [repo]`. Idempotent; emits the **correct** `.claude/*` + `!.claude/skills/` negation (the obvious `.claude/` form is silently broken). Drives Step 5 first-run setup. |
