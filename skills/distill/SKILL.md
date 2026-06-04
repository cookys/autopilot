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

## Step 1 — Scan (deterministic, no LLM)
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/distill-scan.js --real-only
```
Emits frequency **atoms** in two buckets: **ritual candidates** (de-noised procedural command
n-grams) and **correction candidates** (recurring user-friction contexts). Evidence (counts, source
project) is deterministic — never invented. `--json` for machine output; `--top N` to widen.

## Step 2 — Propose (≤7 per bucket, from atoms only)
Name each genuinely recurring procedure; **abstract to generic steps**. **Refuse to propose a procedure
that cannot be expressed without a specific literal** (inherently-specific) — unless self-use scope,
where the user's own identifiers (their git email, their host alias) may stay. Classify each candidate's
scope (global vs which project) from its `cwd`.

## Step 3 — Review (human gate — the privacy backbone)
Present each candidate as a draft `SKILL.md`. Run the identifier lint + the user's deny-list
(`~/.autopilot/distill/identifiers.deny`, one real hostname/client name per line). The lint reliably
catches structured tokens (email / IPv4 / `/home/<user>/` / FQDN / key-shapes); bare hostnames and
client names are the **gate's** job — surface proper-noun-shaped tokens for the user. Nothing is
written without per-candidate approval.

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

## Step 5 — Sync (manual git, transport-agnostic)
The approved skill is **already committed** (Step 4). Sync = propagate that commit:
`git -C ~/.claude/skills/autopilot-distill-skills pull --rebase` (guard first-run: set upstream first)
→ `push`. Other machines `pull`. Project skills ride the project's own git. Syncthing on the pack
folder is the no-git alternative. Full setup: [references/sync-setup.md](references/sync-setup.md).

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
| [`scripts/distill-scan.js`](../../scripts/distill-scan.js) | Deterministic full-history scanner → frequency atoms (two buckets). `--real-only`, `--json`, `--top N`. No LLM in the count path. |
| [`scripts/distill-sync-setup.sh`](../../scripts/distill-sync-setup.sh) | Onboarding plumbing for pack sync: `status` / `init-remote <url>` / `enroll <url>` / `fix-gitignore [repo]`. Idempotent; emits the **correct** `.claude/*` + `!.claude/skills/` negation (the obvious `.claude/` form is silently broken). Drives Step 5 first-run setup. |
