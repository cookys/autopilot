# distill — recurring corrections + rituals → candidate user-level skills

> **Status**: In progress (L-size). P1 value-gate PASSED narrowly 2026-06-03 → scope NARROWED.
> **Branch**: `feat/distill-skill` · **Plan**: [../../plans/2026-06-03-distill-skill.md](../../plans/2026-06-03-distill-skill.md)
> **Owner**: cookys (Board) / CEO-agent (how). **Created**: 2026-06-03.

## OKR (narrowed post-P1)

**Objective**: Surface a user's **recurring corrections** and **genuine multi-step rituals** from local conversation history, and propose them as candidate **user-level skills** that propagate across the fleet via `~/.claude/skills/` (a path CC consumes natively). NOT general command-frequency mining (P1 proved that half is noise).

**Key Results**
- KR1 — `distill scan` (deterministic, no LLM) emits two clean buckets: recurring-correction candidates (friction stream, false-positives filtered) and ritual candidates (de-noised procedural n-grams). ✅ scanner exists, value-gated.
- KR2 — `distill review`: human-gated approve → writes a well-formed `~/.claude/skills/<key>/SKILL.md`.
- KR3 — Consumption is native (`~/.claude/skills/` global, verified §0.1 of plan); sync = Syncthing on that dir.
- KR4 — Privacy: human-approval gate primary; generic abstraction; lint + per-machine deny-list backstop. Raw history never leaves the machine.

## Why narrowed (P1 evidence, 2026-06-03)
Ran `scripts/distill-scan.js` on real history (17 real-project sessions, 24k lines). De-noised + friction-surfaced output showed: **command n-gram mining = mostly obvious git rituals (weak)**; **the real value = the recurring-correction stream** (e.g. "commit the problems to the repo in one pass, don't make me pull each time" ×2) **+ a few genuine rituals** (`ssh ↔ git add` cross-machine command workflow — the user's stated pain). So the skill narrows to correction-surfacing + genuine rituals; the general-mining ambition is cut.

## Architecture principle (locked)
autopilot ships the **distiller (factory)** only; it never contains the **distilled skills (products)** — those are the user's personalized custom skills, routed by scope into user space:
- **Global** → a **skills-directory plugin pack** `~/.claude/skills/autopilot-distill-skills/` (`.claude-plugin/plugin.json` + `skills/<key>/SKILL.md`, loaded in-place as `autopilot-distill-skills@skills-dir`, verified plugins-reference §358-367). The pack folder = a **private git repo = the fleet sync channel**; cloned to every machine; namespaced `autopilot-distill-skills:<key>`, separate from hand-authored personal skills; can also carry personal hooks/agents.
- **Project-specific** → plain `<originating-project>/.claude/skills/<key>/` (walk-up works; rides the project's own git for free).

Routed by the scan's `cwd` attribution. autopilot's repo stays clean. Matches existing autopilot pattern (hooks→`~/.autopilot/`, dispatch→`.claude/*.md`) + CC's `run-skill-generator` / `plugin init` precedent.

## Phases
- **P1** ✅ — `scripts/distill-scan.js` + run-on-real-history value-gate. PASSED narrowly. (provisional script; not yet CLAUDE.md-wired)
- **P2** — Harden scan: filter friction false-positives (`<task-notification>`, skill-injection "Base directory for this skill:", system text); separate the two buckets cleanly; fix cwd attribution; golden determinism test.
- **P3** — `review`: LLM classify/propose (top-K per bucket, generic abstraction, **refuse inherently-specific**), human-approval gate, lint + deny-list, write to `~/.claude/skills/`. Tests: de-id (§6.2 plan), gate invariant, merge-key.
- **P4** — Sync docs (Syncthing on `~/.claude/skills/` + private-git fallback); `references/`; CLAUDE.md inventory + SKILL.md table wiring; INDEX/README/CHANGELOG.
- **Companion (separate Fix)** — release-ritual git hook (record-SHA + `preflight-release.sh` gate). Ships independent of distill.
- **P-final** — `quality-pipeline` → `preflight-portability.sh` → `finish-flow` (merge, minor bump, archive).

## Success criteria
A scan of real history yields ≥1 correction-candidate and ≥1 ritual-candidate that the user approves into `~/.claude/skills/`; the approved skill is discovered by a fresh CC session; de-id + gate tests pass.

## Out of scope
General command-frequency mining (P1-disproven); cross-machine count-merge; hooks generation by distill; memory-dir sync (path-encoding spike first); stranger-publish DLP hardening (publish phase).
