# distill — fleet sync setup (the pack as a private repo)

Distilled **global** skills live in the pack `~/.claude/skills/autopilot-distill-skills/`. The pack is
also a `@skills-dir` plugin, so every machine that has the folder loads the skills natively — no install.

> **⚠️ Durability first, sync second.** A remote is **required for durability**, not a sync nicety: until
> the pack has a remote, the distilled skills are a **single on-disk copy** — one `rm -rf ~/.claude/skills`
> or disk failure from total loss. Set up the remote **before** you rely on distilled skills. (Skills are
> committed at approval time — `commit-on-approve` — so they survive concurrency/crashes locally; the
> remote is what survives losing the whole machine.)

> **Fastest path — use the script.** `scripts/distill-sync-setup.sh` does every git step below
> deterministically and idempotently: `status` (what's set up?), `init-remote <url>` (machine #1
> backup), `enroll <url>` (new machine), `fix-gitignore [repo]` (track project-scoped skills with
> the *correct* negation). The manual commands below are the same steps, for reference / no-script
> environments. `/autopilot:distill` invokes the script automatically on first run (Step 5).

## Running distill on another machine (contribute, not just consume)
Cloning the pack only lets a machine **consume** the existing skills. To also **distill on it** — mine
*that machine's own* conversation history into new skills — do the full onboarding once:

1. **Install autopilot** on that machine — the `distill` skill (the factory) ships with it.
2. **Clone the pack** to `~/.claude/skills/autopilot-distill-skills/` (see Option A below) — distill
   writes approved global skills there. (First-ever `~/.claude/skills/` creation → one CC restart.)
3. *(optional)* Create `~/.autopilot/distill/identifiers.deny` with that machine's real hostnames /
   client names (one per line) so the lint can catch the identifiers a regex can't infer.
4. Run **`/autopilot:distill`** — it scans *this* machine's `~/.claude/projects/`, proposes candidates
   from its own history, you approve, and it writes them into the cloned pack (global) or the relevant
   project's `.claude/skills/`.
5. `git push` the pack → other machines `git pull` and gain the new skills.

Each machine distills its **own** history; the pack accumulates every machine's approved skills (union
by skill directory). If two machines ever distil the *same* procedure, that one file conflicts on
`git pull` — resolve it by hand once (the automatic `consolidate` merge is deferred, plan §0.3.1).

## Option A — private git repo (recommended for an async fleet)
A remote is always-on store-and-forward, so machines that are on at different times still converge.

**One-time, machine 1 (where the pack already exists):**
```bash
cd ~/.claude/skills/autopilot-distill-skills
# create a PRIVATE repo on your host (no gh? create it in the web UI, then:)
git remote add origin git@github.com:<you>/autopilot-distill-skills.git
git push -u origin main        # sets upstream; first-run guard for later pulls
```

**One-time, every other machine (fleet enrollment):**
```bash
git clone git@github.com:<you>/autopilot-distill-skills.git \
  ~/.claude/skills/autopilot-distill-skills
```
Creating `~/.claude/skills/` for the first time needs one Claude Code restart to be watched.

**Routine (any machine):**
```bash
cd ~/.claude/skills/autopilot-distill-skills
git pull --rebase      # has-upstream guaranteed by the -u push above
# (distill writes/commits a new skill here) → git push
```
Auth: use an SSH deploy key or a PAT in your credential store per host (no `gh` required). Per-skill
subdirectories mean a new skill from machine A and one from machine B never touch the same file — a
plain pull/push merges cleanly. (A genuine conflict only arises if two machines edit the *same* skill;
resolve that one merge by hand — see plan §0.3.1 DEFERRED for the eventual consolidate mechanism.)

## Option B — Syncthing (no git, P2P, no cloud)
Share the `~/.claude/skills/autopilot-distill-skills/` folder between machines. Caveat: both ends must
be online simultaneously to converge (no store-and-forward) — worse for an async/time-zone-split fleet.

## Project-scoped skills need no setup — UNLESS the project gitignores `.claude/`
Skills routed to `<project>/.claude/skills/` ride that project's own git — any machine that pulls the
project gets them for free.

**Known limitation**: many repos `.gitignore` the whole `.claude/` dir, in which case a project-scoped
distilled skill is **local-only and never propagates**. Check with `git check-ignore .claude/skills/`.
Two fixes: (a) add a negation to that repo's `.gitignore` so the skills are tracked. **Git cannot
re-include a path whose parent directory is fully excluded** — so `.claude/` + `!.claude/skills/`
does *not* work (the skill stays ignored). Exclude the *contents* with `.claude/*`, then negate:
```gitignore
.claude/*
!.claude/skills/
```
This keeps `.claude/settings.json` etc. ignored while tracking `.claude/skills/`. (Verify:
`git check-ignore .claude/skills/<name>/SKILL.md` should print nothing.)
Or (b) route the skill to the **global pack** instead (it always syncs), accepting it loads in every
project rather than just this one.
