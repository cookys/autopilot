# Product website — same-repo `website/` (VitePress)

Status: **LIVE narrative site** + **growth panel synthesized** (Vue full-bleed; landing rewrite; IA blueprint in GROWTH-PANEL)
Owner: depth-0
Decision: **A — monorepo `website/`**, not a separate repo
**Canon:** [`website/NARRATIVE.md`](../../website/NARRATIVE.md) · [`website/TA.md`](../../website/TA.md) · [`website/WEEKLY.md`](../../website/WEEKLY.md)
**Growth / next IA:** [`website/GROWTH-PANEL.md`](../../website/GROWTH-PANEL.md) (codex gpt-5.6-sol · agy · MiniMax · glm)
**Core:** remove human from loop · diverge for CEO-agent decisions · converge when runs drift · meteor = goals/red lines
Target: public GitHub Pages; does **not** block v2.32.36 unit-contract work

## Problem

Autopilot's public face is a GitHub README + scattered `docs/*.md`. That is enough for
contributors who already clone the repo, but:

1. First-time visitors never see the product story (levels, trust model, proof culture).
2. 36k+ lines of internal md (BACKLOG, plans, project archive) would poison a naive "full docs dump".
3. Brand assets (`docs/assets/*`) and dual-language README already exist but are not a site.

## Decision

Ship a **static product site** under **`website/`** in this repository:

| Rule | Detail |
|------|--------|
| Placement | Same monorepo; path `website/` |
| Plugin payload | **Excluded** — not in `.claude-plugin`, not in `scripts/sync-codex-plugin-skills.sh` DIRS (already true: only skills/bin/src/schemas/hooks/_shared/references/scripts/project-config-template + selected docs) |
| Content SSOT | Engineering truth stays in root `docs/`, `README*`, `hooks/README.md`, `references/`. Site **curates** and may rewrite tone; must not invent behavioral claims that contradict SSOT |
| Not on site | Full BACKLOG, plans, `_archive` project logs, eval raw outputs, secrets |
| Stack | **VitePress** (MD-native, i18n, GitHub Pages-friendly, small surface) |
| i18n | EN default + zh-TW for marketing/product pages |
| Deploy | GitHub Pages via Actions (`website/**` path filter) |
| Version | Build injects version from `.claude-plugin/plugin.json` (no second version source) |

## Information architecture (three tiers)

### Tier 1 — Marketing / story

| Route | Purpose |
|-------|---------|
| `/` | Landing: sol H1, run-first CTAs, flow, roles |
| `/demo` | Teaching run replay (decide / fail / pull back) |
| `/recipes` | Three first-meteor job recipes |
| `/philosophy` | Three Red Lines, artifact-not-self-report, why a plugin |
| `/levels` | `/l3`–`/l6` delegation ladder + org diagram |
| `/proof` | Selected measurement honesty (H2 refuted, known-bad floor, fail-closed) |
| `/roadmap` | **Hand-curated** 5 public items only — not live BACKLOG dump |

### Tier 2 — Product docs (users who install)

| Route | Source of truth (curate from) |
|-------|-------------------------------|
| `/install` | `docs/installation.md` + README install |
| `/skills` | `docs/skills.md` |
| `/architecture` | `docs/architecture.md` |
| `/multi-harness` | installation + multi-agent-portability summary |
| `/configuration` | `docs/configuration.md` (phase 2 if MVP slim) |
| `/hooks` | `hooks/README.md` (phase 2) |
| `/releases` | CHANGELOG milestones (link + highlights) |

### Tier 3 — Engineer deep

Prefer **deep-link to GitHub** for `references/*`, scripts inventory, schemas. Optional later page: scripts map diagram (from project inventory).

## Homepage mock acceptance

- Distinctive terminal / project-lead aesthetic (reuse `icon.svg` + `hero.svg` + flow SVGs)
- Visible: tagline, install CTA, levels teaser, trust bullets, dual-language switch
- No claim of hook parity on non-Claude harnesses
- No live status dashboard (local CLI only)

## Scaffold deliverables (this plan's first ship)

1. `docs/plans/2026-07-16-product-website.md` (this file)
2. `website/` VitePress project with EN + zh-TW
3. Pages: home, philosophy, levels, skills, install, architecture, multi-harness, proof, roadmap
4. Assets under `website/public/assets/` (copied from `docs/assets/`; brand SSOT remains `docs/assets/`)
5. `.github/workflows/website.yml` for Pages
6. Root note in `website/README.md` + optional README "Website" link (no version bump required for scaffold)

## Out of scope (v1)

- Auto-ingest BACKLOG / INDEX / plans
- Runtime dispatch dashboard
- Blog CMS
- Independent `autopilot-site` repo
- Training course material (lives in private `ai-coding-course`)

## Risks

| Risk | Mitigation |
|------|------------|
| Second prose SSOT | Plan + website README: curate only; behavior claims must match root docs |
| Payload bloat | Never add `website/` to codex DIRS or plugin manifest |
| Drift of copied assets | Document copy step; optional later `scripts/sync-website-assets.sh` |
| Over-claim multi-harness | Honest limits table from README |

## Open follow-ups

- Wire README badge → live Pages URL after first deploy
- Phase 2: configuration + hooks pages
- Optional: `scripts/sync-website-assets.sh` + CI check
- Changelog page generator (parse `## v` headings only)

## Approval

Board decision **A** (2026-07-16): same-repo `website/`.
