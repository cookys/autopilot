# Plan — Ecosystem-standalone premise + `autopilot:onboard` skill

> **Status**: Draft (R0) — awaiting Board approval before implementation.
> **Owner**: cookys (Board) · **Branch**: `feat/ecosystem-standalone-onboard` (off `develop`)
> **Frame**: positioning recalibration (B, mostly docs/emphasis) + one net-new skill with 2 scripts (A, FEATURE).
> **Origin**: surfaced while onboarding the `hangar-bridge` repo to autopilot DI (2026-06-26). That repo's
> hand-built `.claude/` is the **golden output** this plan's skill must reproduce.

---

## 0. Context / thesis

Two asks from the Board, one project:

- **(A) `autopilot:onboard`** — there is **no tooling today** to scaffold a *consuming* project's autopilot
  DI (`.claude/*-config.md`). `project-lifecycle` bootstraps *tracking docs from a plan*, not the DI config.
  So every new project is onboarded by hand (just done for hangar-bridge: detect repo reality → write 9
  `*-config.md` → docs skeleton → reconcile CLAUDE.md → seed memory). This is the **net-new value**.
- **(B) Ecosystem-standalone premise** — autopilot's default operating assumption should be **cookys's own
  ecosystem (autopilot + codeforge + mnemos), standalone**, not coexistence with third-party plugins
  (superpowers / voltagent). voltagent is **dropped** (not integrated); superpowers stays **documented but
  explicitly optional**.

**Key scoping discovery (lowers B's cost):** the `dispatch-config.md` template's **defaults are already
autopilot-only** (lines 9–16: absent file ⇒ native / `autopilot:reviewer` / autopilot fallbacks; "create
this file only when you have third-party plugins"). So (B) is **mostly positioning/emphasis**, not broken
defaults: the README leads with "Superpowers Coexistence", and codeforge/mnemos are nowhere named as the
assumed ecosystem. The 296-hit / ~40-file superpowers footprint is dominated by **legitimately-historical**
records (coexistence plan, internalize-trio plan, archive) that should be **kept**, not scrubbed.

**Overlap risk (must coordinate):** `feat/onboarding-readme-revamp` (plan `2026-06-26-onboarding-readme-revamp.md`,
partly merged) is already relocating the README's superpowers-coexistence content into `docs/coexistence.md`.
(B)'s README-facing edits MUST build on that branch's end-state, not collide with it.

## 1. Problem statement

1. No reusable path from "fresh repo" → "autopilot-calibrated repo". The judgment (detect reality, pick the
   config subset, choose ecosystem-only chains, derive doc-drift domains) is redone by hand each time; the
   mechanical half (copy+fill templates, gitignore runtime state) is trivially scriptable but unscripted.
2. autopilot's surface still *reads* as "superpowers-adjacent". A newcomer can't tell that the intended
   default is autopilot+codeforge+mnemos standalone.

## 2. OKR / KRs

- **O**: A new project is autopilot-ready in one command; autopilot's documented default premise is
  ecosystem-standalone.
- **KR1 (A)**: `autopilot:onboard` run against the **hangar-bridge** repo reproduces a `.claude/` set
  equivalent to the hand-built golden output (same config files, same calibrated values — docs/ plural,
  pnpm/vitest commands, real coverage thresholds, autopilot-only chains).
- **KR2 (A)**: `scripts/project-detect.js` and `scripts/scaffold-config.js` are deterministic, fixture-tested
  (≥3 repo shapes: pnpm-workspace+docs/, cargo+doc/, single-package), and wired into the relevant skill's
  "Available Scripts" table + `CLAUDE.md` scripts inventory (per AGENTS.md convention).
- **KR3 (B)**: No `project-config-template/*` and no skill body emits a **superpowers-first** default. The
  ecosystem trio is named as the assumed baseline where a baseline is stated; superpowers/voltagent appear
  only as explicitly-optional or historical.
- **KR4**: All gates green — `scripts/validate.sh`, `node scripts/sync-version.js --check`,
  `node scripts/check-hook-inventory.js --check`, `scripts/preflight-portability.sh`. Version bumped, skill
  count updated, marketplace/README mirrors synced.
- **KR5**: Zero content lost in (B) — every kept superpowers fact stays verbatim; only framing/defaults move.

## 3. Design

### (A) `autopilot:onboard` — skill (judgment) + scripts (mechanical)

Per AGENTS.md "scripts for mechanical work, skill for judgment":

- **`scripts/project-detect.js`** (pure read, emits JSON): package manager, test/build/lint commands
  (+ `lint_is_noop` flag), per-package coverage thresholds (parse vitest/jest/tarpaulin configs), default
  branch, **doc path convention (`doc/` vs `docs/`)**, package/workspace layout, installed plugins.
- **`scripts/scaffold-config.js`** (mechanical write): copy+fill the **high-value subset** of
  `project-config-template/*.md` into `<target>/.claude/`, substituting detected values; ensure
  `.gitignore` excludes `.claude/` runtime state (`tasks/`, `*-state.json`, `knowledge/`, `.qc/`) while
  keeping `*-config.md` tracked. Idempotent (re-run = no spurious diff; never clobber a hand-edited config
  without `--force`).
- **`skills/onboard/SKILL.md`** (judgment): reads detect JSON, picks the config subset, **defaults to
  ecosystem-only chains** (embeds B), derives doc-drift domains from the package↔doc mapping, optionally
  reconciles a stale CLAUDE.md, seeds memory pointers. The skill OWNS the non-mechanical decisions; the
  scripts own everything deterministic.

**Golden output = hangar-bridge `.claude/`** (the 9 `*-config.md`, docs skeleton, reconciled CLAUDE.md,
seeded memory). Fixture the detect-JSON for hangar-bridge and assert scaffold reproduces it.

**Open: scope of the skill's CLAUDE.md reconcile.** Option 1: skill only scaffolds `.claude/` + docs
skeleton, leaves CLAUDE.md/memory to the human (smaller, deterministic). Option 2: skill also does the
prose reconcile + memory seed (full parity with the hand-built run, but judgment-heavy / less testable).
**Recommend Option 1 for v1**, with the reconcile/seed as a documented follow-on step in the skill body.

### (B) Premise flip — surgical, triage-gated

1. **Audit** the ~40-file footprint into a **keep / flip** table (keep = historical/optional record;
   flip = states or implies a superpowers-first default). Most hits are keep.
2. **Flip** the small flip-set: template intros that imply third-party as the baseline; `quality-gate-config`
   /`dispatch-config` wording; `docs/coexistence.md` + `docs/configuration.md` positioning; AGENTS.md +
   CLAUDE.md "what autopilot assumes" surfaces — **name autopilot+codeforge+mnemos as the default ecosystem**.
   Drop voltagent as an assumed peer (keep any factual mention as "not supported / out of scope").
3. **Coordinate README** edits with `feat/onboarding-readme-revamp` (rebase onto its end-state; touch only
   the positioning sentences, not the relocated tables).

## 4. Phasing (each phase = independent commit; TDD where code)

- **P0 — Audit & triage** *(no code)*: produce `docs/plans/.../triage-superpowers-footprint.md` (keep/flip
  table over the 40 files). Gate: Board confirms the flip-set before any edit.
- **P1 — Premise flip** *(docs)*: apply the flip-set from P0. Coordinate with onboarding-readme branch.
  Gate: `check-readme-parity.js`, `preflight-portability.sh` green.
- **P2 — `project-detect.js`** *(TDD)*: RED fixtures (≥3 repo shapes) → GREEN detector → JSON schema.
- **P3 — `scaffold-config.js`** *(TDD)*: RED (idempotency, gitignore, golden-reproduce) → GREEN scaffolder.
- **P4 — `skills/onboard/SKILL.md`** *(judgment)*: skill body, "Available Scripts" table, ecosystem-only
  defaults; `validate.sh` green.
- **P5 — Wire-in + version**: register skill (plugin.json / marketplace.json via `sync-version.js`),
  skills.md, AGENTS.md skill list; `sync-version.js --version X.Y.Z --skill-count N+1 ...`; all gates green.
- **P6 — Dogfood**: run `autopilot:onboard` against a throwaway second repo (and re-run against hangar-bridge)
  to confirm it reproduces the golden output. **NOTE: skill not dispatchable until a Claude Code restart**
  (plugin caches skills at session start — see level-front-door Gotcha).

## 5. Acceptance criteria

- KR1–KR5 all met; ledger of gates attached to the finish-flow report.
- A multi-perspective review (Architect / Ops / Skeptic per AGENTS.md) on P1's flip-set and the skill design.

## 6. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Collision with `feat/onboarding-readme-revamp` | P1 rebases onto its merged end-state; touch only positioning lines. |
| Self-reference (the skill scaffolds from templates being edited in P1) | Sequence P1 before P2–P4; golden fixture pinned after P1. |
| Over-scrubbing superpowers (losing legitimate history) | P0 triage gate — default is KEEP; flip only the explicit-default set. |
| Skill not loadable mid-session | P6 dogfood requires a restart; documented. |
| Wrong execution venue (see §8) | Run from an autopilot-rooted session post-restart. |

## 7. Out of scope

- voltagent integration (it is being dropped, not added).
- `/l5` hetero **parallel** width (BACKLOG).
- Migrating existing consuming repos beyond hangar-bridge (onboard makes it cheap; bulk migration is later).

## 8. Execution-venue precondition (READ BEFORE running /l5)

This plan was authored from a session **rooted in `hangar-bridge` with autopilot 2.25.5 loaded**, while the
work target is the **autopilot repo** (dev clone just fast-forwarded to **2.25.12**). Two consequences:

1. **`/l5`'s native foreman uses `Agent(isolation:"worktree")`, which worktrees the *current* session repo.**
   From a hangar-bridge-rooted session it would isolate the **wrong repo**. Run `/l5` from a Claude Code
   session **rooted in `/home/cookys/projects/autopilot`**.
2. **The loaded plugin (2.25.5) lags the source (2.25.12)** being edited, and the edits are self-referential
   (autopilot editing its own skills/scripts). **Restart Claude Code** in the autopilot repo first so the
   loaded plugin == the working tree (the dev clone, via `scripts/dev-setup.sh` symlink, makes edits live).

⇒ **Recommended impl venue**: restart Claude Code in `~/projects/autopilot`, confirm the plugin is the dev
clone, then `/l5` per-phase from there. The plan + branch are already in place on `feat/ecosystem-standalone-onboard`.

## 9. Open questions (for Board)

1. Skill name: `onboard` vs `project-init` vs `di-init`? (Plan assumes `onboard`.)
2. v1 skill scope: scaffold-only (Option 1) vs scaffold + CLAUDE.md-reconcile + memory-seed (Option 2)?
3. Run impl as `/l5` (hetero Gemini implementer) as requested, or `/l4` (all-Claude) — given the work edits
   autopilot's own dispatch rails, a homogeneous run may be easier to trust for P1/P5. (Hetero still fine for
   the mechanical P2/P3 scripts.)
