# distill — fleet sync setup (the pack as a private repo)

Distilled **global** skills live in the pack `~/.claude/skills/autopilot-distill-skills/`. To sync them
across your machines, make that folder a private git repo (or a Syncthing share). The pack is also a
`@skills-dir` plugin, so every machine that has the folder loads the skills natively — no install.

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

## Project-scoped skills need no setup
Skills routed to `<project>/.claude/skills/` ride that project's own git — any machine that pulls the
project gets them for free.
