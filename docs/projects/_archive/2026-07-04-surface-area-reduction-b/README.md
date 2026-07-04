# Surface-Area Reduction — B Group (thin-shelling)

> Plan: [`docs/plans/2026-07-04-surface-area-reduction.md`](../../plans/2026-07-04-surface-area-reduction.md) (CONVERGED — MiniMax-M3 ×2 + gpt-5.5 ×2 SHIP-AS-IS)
> Branch: `feat/v2.31.16-surface-area-b` · Target: v2.31.16 (PATCH — no new skill/agent)

## Project Goal

> **Final goal**: Reduce prose surface area with ZERO entry-point loss and ZERO feature loss — thin-shell `/l3`–`/l6` + `/think-tank-dialectic`, dedup `model-routing.md` to one canonical, tier-layout `docs/skills.md`, and wire the north-star prose/engine measurement into `preflight-release.sh`.
>
> **Success criteria** (from plan acceptance, all verifiable):
> 1. B1: `hooks/tests/slash-entry-probe.test.sh` exists, covers ALL 5 entries (/l3–/l6 + /think-tank-dialectic), wired into `preflight-release.sh`, and passes (evidence = artifact-level Read of front-door / per-level reference, not self-report). Four lN SKILL.md **bodies** total ≤80 lines (frontmatter excluded). **Frontmatter byte-identical** (git diff on frontmatter = empty).
> 2. B2: think-tank-dialectic body (337 lines) migrated to `skills/think-tank/references/dialectic-mode.md`; shell keeps 3–5-line semantic summary + MUST-READ; both skills' frontmatter diff empty; one live trigger of `/think-tank-dialectic` shows it loads dialectic-mode.md.
> 3. B3: edit canonical → sync script updates 4 copies (byte-equal); hand-edit a copy → pre-commit blocks (byte-parity check in `check-canonical-invariants.sh`); canonical has no relative links (lint).
> 4. B4 step 1: `docs/skills.md` reorganized into core/delegation/pioneer; ZERO frontmatter changes; `check-readme-parity.js` + `validate.sh` green.
> 5. §4: `preflight-release.sh` prints prose/engine line counts + delta vs baseline; baseline captured this release; +5% WARNING threshold armed for FUTURE releases only.
>
> **Scope boundary**:
> - IN: B1, B2, B3, B4-step-1, §4 measurement. Codex-mirror sync (`sync-codex-plugin-skills.sh`) for all moved/changed skill files. CLAUDE.md inventory rows for new scripts. CHANGELOG + version mirrors.
> - OUT (explicit): C group entirely (C1a spike, C1b generated mirror, C2 multiplexer — separate sprint). B4 step 2 (`tier:` frontmatter field — gated on two-platform unknown-field dry-run). think-tank escalation-judgment section (plan: do not touch). Any slash-entry deletion (constitutional constraint). Any quality-gate removal.

## Constitutional constraint (Cookys 2026-07-04)

`/l3`–`/l6` slash entries are human muscle-memory invoke points — **none may be removed**. Refinement targets docs/mirror surface only, never entries or features.

## L-1.5 Scope Completeness Audit (2026-07-04)

| Dimension | Verdict | Coverage |
|-----------|---------|----------|
| Source code + tests | YES | P1–P5 phases; new `slash-entry-probe.test.sh`; existing `validate.sh` + parity gates re-run |
| User-facing docs | YES | `docs/skills.md` (B4); CLAUDE.md scripts-inventory rows for new sync script |
| API / interface reference | N/A | No public interface change; frontmatter (routing surface) locked byte-identical by acceptance |
| Config templates | N/A | No config format change |
| CHANGELOG | YES | v2.31.16 entry (P5 closes; written at finish-flow) |
| Version bump | YES | PATCH v2.31.16 via `sync-version.js` (all four count flags — footgun memory) |
| Version sync grep | YES | finish-flow L-5.5 `preflight-release.sh` |
| Migration guide | N/A | No breaking change; all reference paths preserved or shells point to new homes |
| Dependent repos / consumers | YES | codex mirror `platforms/codex/plugin` — run `sync-codex-plugin-skills.sh` after every skill-file move (pre-commit `--check` enforces) |
| Credit / attribution | N/A | No external OSS absorbed |
| Dogfood target | YES | §4 north-star measurement applies to this very release (baseline seed; big-drop round must NOT trip +5% gate) |

**Audit findings folded into phases**:
- lN bodies currently 22/32/21/45 = 120 lines → main mass is l6 (per-unit pipeline + incident rationale) and l4 (depth-0 loop detail duplicating front-door §219+).
- `skills/think-tank/references/model-routing.md` is a **symlink** → B3 converts it to a real generated file (plan: symlink is out due to rsync `-L`).
- **Name collision**: dialectic's `brief-template.md` + `role-prompts.md` collide with think-tank's own → migrate with `dialectic-` prefix (flat references/ path rule; diff first — if byte-identical, dedup instead).
- Probe test evidence = `--output-format stream-json` Read tool_use artifacts (artifact-not-self-report), read-only allowedTools.

## Phases

| Phase | Content | Status |
|-------|---------|--------|
| P1 | B1 — thin-shell l3–l6 (bodies 79 lines total, frontmatter byte-identical), per-level references, slash-entry-probe release gate | ✅ done |
| P2 | B2 — dialectic body → think-tank/references/dialectic-mode.md (6 refs alongside, 2 `dialectic-`-prefixed) | ✅ done |
| P3 | B3 — model-routing canonical + sync-model-routing.sh + mirror/lint gates (discovery: all 4 "copies" were symlinks → real files) | ✅ done |
| P4 | B4 step 1 — docs/skills.md three-tier layout (zero frontmatter changes) | ✅ done |
| P5 | §4 — north-star measurement in preflight-release + baseline seeded (v2.31.15: prose=10545 engine=3185; re-seed at release) | ✅ done |

## Acceptance evidence (2026-07-04)

- All 5 slash entries live-probed green (`slash-entry-probe.test.sh`, artifact-level Read evidence): l3, l4, l5 (+hetero-impl-loop.md), l6 (+full-dispatch-pipeline.md), dialectic (+dialectic-mode.md).
- Frontmatter byte-checks: all 6 touched skills BYTE-IDENTICAL (l3/l4/l5/l6/think-tank-dialectic/think-tank).
- B3 negatives verified live: hand-edit copy → gate exit 1; symlink copy → exit 1; relative-link in canonical → exit 1; edit-canonical→sync propagates.
- North-star negatives verified: +10% simulated growth without `prose-justification:` → release check fails.
- Full hooks suite: 100/100 test files PASS. `validate.sh` 27/27. `check-readme-parity` green.

## Decision log

- 2026-07-04: L-sized (multi-file, plan-backed) despite BACKLOG "B=S" — plan already exists so L-2 is a no-op; L tracking chosen for finish-flow + INDEX discipline.
- 2026-07-04: Plan's "交 codex 線實作" note superseded by direct dev-flow execution (user `go` on /next recommendation); hetero dispatch optional, not required by plan acceptance.
