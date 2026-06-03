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

## Step 4 — Write (routed; loads immediately)
On approval, write a well-formed `SKILL.md` (`name` + `description` so `scripts/validate.sh` passes;
body = the generic procedure) to the routed location. **Plain slug**, no staging. Parameterize
identifiers; keep real values in `~/.ssh/config` / local config, not in the synced skill body.
- First-ever pack creation: scaffold `~/.claude/skills/autopilot-distill-skills/` with
  `.claude-plugin/plugin.json` + `git init`. Creating `~/.claude/skills/` for the first time needs one
  CC restart to be watched; adding a skill to an already-loaded pack may need `/reload-plugins`.
- **Project writes are left UNSTAGED** with an explicit "I wrote X — review and commit" note; never
  auto-commit into the user's project. Refuse on same-name collision.

## Step 5 — Sync (manual git, transport-agnostic)
The pack is a private git repo: `git -C ~/.claude/skills/autopilot-distill-skills pull --rebase`
(guard first-run: set upstream before first pull) → review → `commit` → `push`. Other machines `pull`.
Project skills ride the project's own git. Syncthing on the pack folder is the no-git alternative.
Full setup (fleet enrollment, auth, Syncthing): [references/sync-setup.md](references/sync-setup.md).

## Deferred (do NOT build until it's needed)
Multi-machine **consolidate** (per-host staging + LLM-merge of variants) is deferred until a real
cross-machine conflict actually occurs — the trigger is the first `git pull` conflict on a pack
`SKILL.md`. Until then a single hand-resolved merge is the entire cost. See plan §0.3.1 (DEFERRED).

## Available scripts
| Script | Purpose |
|--------|---------|
| [`scripts/distill-scan.js`](../../scripts/distill-scan.js) | Deterministic full-history scanner → frequency atoms (two buckets). `--real-only`, `--json`, `--top N`. No LLM in the count path. |
