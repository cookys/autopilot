# Plan — Beginner-friendly onboarding README (move detail into docs/)

> **Status**: Draft (R0) — ready for `/l5 gpt-5.5 xhigh`
> **Owner**: cookys (Board) · **Branch**: `feat/onboarding-readme-revamp` (off `develop`)
> **Frame**: docs-restructure + one gating-script rewire (PATCH). Not a marketing rewrite — a *relocation* of existing, accurate content into a layered doc set, leaving a slim onboarding surface.

---

## 0. Context / thesis

`README.md` is **651 lines** and doubles as the project's design-spec dump: Superpowers coexistence (3 scenarios + migration), the injection mechanism diagram, full 20-hook Tier A/B tables, design philosophy, methodology-agent contract, and a 6-source "Inspired By" credits block. A newcomer who only wants *"what is this / how do I start"* has to scroll past ~600 lines of internals.

The detail is **correct and worth keeping** — it just shouldn't be the front door. This plan splits the README into a slim onboarding page + a set of English detail docs under `docs/`, and rewires the one CI gate (`check-hook-inventory.js`) that currently pins hook-table content to `README.md`.

**Decided (Board, 2026-06-26):** detail docs are **English-only**; **both** READMEs (EN + zh-TW) get the slim treatment and link to the same English detail docs. (`CLAUDE.md` convention: docs are English unless user-facing localization; the README pair is the localized surface.)

**Key discovery:** `hooks/README.md` (218 lines) is *already* the canonical full-hooks doc — `check-hook-inventory.js` already asserts it (lines 186/190/191/194). So the README hooks tables are **redundant**; we relocate by *deleting from README* + *linking to the existing `hooks/README.md`*, not by authoring a new file.

---

## 1. Problem

The actual user goal: a first-time reader should, in **under one screen**, understand (a) what Autopilot does for them, (b) how to install it, (c) how to start using it — and be able to *find* the deep material without it being shoved in their face. Today the README forces every reader through implementer-grade internals.

---

## 2. OKR / KRs

- **O**: README reads as onboarding, not a spec dump.
- **KR1**: `README.md` ≤ **~180 lines** (from 651); `README.zh-TW.md` proportionally similar.
- **KR2**: Zero content *lost* — every fact removed from README exists verbatim (or near-verbatim) in a linked detail doc. (Completeness, not summary.)
- **KR3**: All existing gates stay green: `check-readme-parity.js`, `check-hook-inventory.js --check`, `sync-version.js --check`, `preflight-portability.sh` (esp. #11, #15).
- **KR4**: No dangling internal links anywhere in the repo (every `README.md#anchor` and relative `.md` link resolves).

---

## 2.5 Global Constraints (copied verbatim into every dispatch)

- **Badges are frozen.** Both README heroes keep the exact existing shields.io badges — `version-2.25.x`, `skills-23`, `agents-3`, `hooks-20`, `dependencies-zero`, `license-MIT`. Do not change badge *values* (only the version may move if Phase 4 bumps it, and then in BOTH files identically). `check-readme-parity.js` asserts EN==zh badge values.
- **EN/zh structural parity is non-negotiable.** `README.md` and `README.zh-TW.md` MUST end with the **identical count** of `##` + `###` headings (the check counts headers, not prose). Build the zh-TW structure as a 1:1 mirror of the EN structure — same sections, same order, same heading levels.
- **Relocation = verbatim move, not paraphrase.** Content cut from README into a detail doc is moved *as-is* (tables, diagrams, prose). Do not "improve" or summarize while moving — that risks silently dropping a fact (KR2). Rewriting is allowed ONLY in the new slim onboarding sections.
- **Detail docs are English-only.** Both READMEs link to the same `docs/*.md`.
- **The hook tally has a single source of truth.** Hook counts/membership live in `hooks/README.md` (+ derived by `check-hook-inventory.js`). After relocation, README carries only the **badge** number, never a tier table.

---

## 3. File-structure map

### New files (English-only detail docs)

| File | Receives (moved from README.md §) | Responsibility |
|------|-----------------------------------|----------------|
| `docs/skills.md` | "The Solution" 23-skill table · "Skill Boundaries" · "How They Work Together" diagram · "Three Modes of Operation" | The full skill catalog + how skills compose. |
| `docs/coexistence.md` | "Coexistence Model" · "Superpowers Coexistence" (A/B/C + migration note) · "How does it work with Superpowers" (3-layer) · "Why do descriptions use quoted trigger phrases" | Everything about the Superpowers relationship. |
| `docs/configuration.md` | "Cross-Repository Configuration (Injection)" + diagram · "Available Config Files" table · C++/skill-routing examples · "Team Setup" | Per-project `.claude/` injection model. |
| `docs/installation.md` | OpenCode · Codex · Antigravity · Windows · pre-commit gate · "Known Limitation" · "Update" · "Development" (dev mode / cache layout / branch workflow) | Every install path beyond the 2-command CC default + contributor setup. |
| `docs/architecture.md` | "The Problem" / "The Solution" (long form) · "Design Philosophy" · "Methodology Agents" · "Recommended Companions" (voltagent) · "Inspired By" credits | Why it's built this way + attribution. |

> **Not created:** `docs/hooks.md`. The full hooks tables already live in `hooks/README.md` (canonical). README's Learn-More table links there. *(F3: hooks/README.md is lightly extended with the relocated Override + Secret-Detection notes — still no new file.)*

### Rewritten files

| File | Change |
|------|--------|
| `README.md` | Slimmed to onboarding structure (see §4 Phase 1). |
| `README.zh-TW.md` | Slimmed to mirror EN structure 1:1 (Phase 2). |

### Touched (rewire + link fixups)

| File | Change |
|------|--------|
| `scripts/check-hook-inventory.js` | Drop the README.md/zh-TW **body** assertions; keep the badge assertion. (See §4 Phase 3.) |
| `hooks/README.md` | **(spec-review F3)** Gains `## Override` + `## Secret Detection` relocated from README:565–573 (`autopilot.<hookName>=false`, `AUTOPILOT_PROTECTED_BRANCHES`, `autopilot.costTracker=false`, secret-pattern coverage note). Canonical hooks doc = correct home. Supersedes the earlier "untouched" constraint. Note: each added `##`/`###` here is fine — `check-hook-inventory.js` already pins this file's tier headers; adding non-tier H2s doesn't affect its header-count asserts. |
| `scripts/__tests__` or `hooks/tests/*` for hook-inventory (if any) | Update expectations to match the rewired script. (Verify existence first; `grep -rl check-hook-inventory hooks/tests scripts`.) |
| `CLAUDE.md` | Line ~98: `README.md#superpowers-coexistence` → `docs/coexistence.md`. |
| `README.md` internal links | The two `#superpowers-coexistence` self-links → point at `docs/coexistence.md` (or drop, since that content left the file). |

---

## 4. Phases

### Phase 0 — Branch + scaffolding (Fix)

1. `git checkout develop && git pull && git checkout -b feat/onboarding-readme-revamp`.
2. `git mv` is not applicable (content is a subset of a file). Create empty `docs/skills.md`, `docs/coexistence.md`, `docs/configuration.md`, `docs/installation.md`, `docs/architecture.md` with a single H1 each (e.g. `# Autopilot — Skills Catalog`).
- **Done when**: branch exists; 5 stub docs present.

### Phase 1 — Populate detail docs by relocating README content (Fix → mechanical, verbatim)

For each detail doc in the §3 map, **cut** the named sections out of the *current* `README.md` and **paste** them into the target doc under sensible H2s, preserving every table/diagram/prose block byte-for-byte (Global Constraint: verbatim move). Add a one-line back-link at the top of each detail doc pointing to the root README — a `> Part of Autopilot …` blockquote linking to `../README.md` (correct from `docs/*.md`, one level deep) plus sibling-doc links.
- Fix internal anchors that now point within the moved doc (e.g. if `docs/coexistence.md` references its own sections).
- **Done when**: all 5 docs contain their mapped content; a `diff` of (old README sections) vs (new doc bodies) shows no dropped lines except heading-level adjustments. **Acceptance check**: `grep` for 3 spot-canaries that must survive the move — `Boil the Lake`, `Dissent Quota`, `!\`command\`` injection note — each now resolves in a `docs/*.md`, not README.

### Phase 2 — Rewrite slim `README.md` (L)

Replace the body (keep hero block: title, tagline, badges, lang-switch — UNCHANGED) with this structure. **Lock this heading list** — Phase 3 (zh-TW) mirrors it exactly:

```
(hero — title + 1-line tagline + badge row + EN | 正體中文)
## What Is Autopilot?         ← 1 short para + 3–4 "you get" bullets; 1 line "standalone, coexists with Superpowers → docs/coexistence.md"
## Quick Start                ← CC install (2 cmds) + "then just talk to Claude" + 2–3 try-saying examples
## What It Does               ← 1 intro line, then 4 buckets:
### ✍️  Build code            ← dev-flow · quality-pipeline · finish-flow + one "Try: …" line
### 🧭  Make decisions        ← survey · think-tank · brainstorm + "Try: …"
### 🤖  Full autopilot        ← ceo-agent · /l3 /l4 /l5 + "Try: …"
### 📈  Improve over time     ← learn · retro · next · distill + "Try: …"
## A Day With Autopilot       ← the ONE good visual: the dev-flow S/L size-routing ASCII (condensed from current lines 159–171)
## Install                    ← CC (2 cmds, primary) inline
### Other platforms           ← 1 line + → docs/installation.md (OpenCode / Codex / Antigravity / Windows)
## Learn More                 ← table of links to the 5 detail docs + hooks/README.md + CHANGELOG
## License                    ← MIT + inline links to CHANGELOG / Origin one-liner
```

Heading tally (LOCK): **6× `##`** + **5× `###`** = 11 headings. (Phase 3 must match.)

Writing rules: plain language, no jargon in the bucket descriptions, each bucket has exactly one `Try saying:` example in the user's voice. The "Learn More" table is the *only* place internals are referenced from README.
- **Done when**: `README.md` ≤ ~180 lines; renders cleanly; hero badges untouched; every Learn-More link resolves.

### Phase 3 — Rewrite slim `README.zh-TW.md` (L)

Mirror Phase 2's structure **heading-for-heading** (6× `##`, 5× `###`, same order), translated to 正體中文. Hero badges identical to EN (parity). Links point at the **same English** `docs/*.md`. Try-saying examples in 正體中文 (use the Chinese trigger phrases already in skill descriptions, e.g.「我要開始做 X」「搞定」「下一步做什麼」).
- **Done when**: `node scripts/check-readme-parity.js` passes (badges + section count equal).

### Phase 4 — Rewire the hook-inventory gate + fix links + release hygiene (Fix)

1. **`scripts/check-hook-inventory.js`**: the README body is no longer the hooks home. Edit the assertion block (currently ~lines 178–194):
   - **Keep** line 179 (`README.md` `hooks-\d+-` badge total) and 187 (`README.zh-TW.md` badge total) — the badge stays in the hero.
   - **Remove** lines 180, 181 (README.md `Default-On (N hooks)` / `Opt-In (N hooks)` header-count asserts), 185 (README.md `opt-in** (zero disabled` tally), 188, 189 (zh-TW `預設啟用(N` / `可選啟用(N` tally), and the 193 `checkTierAMembership(errors, 'README.md', inv)` call.
   - **Keep** all `hooks/README.md` asserts (186, 190, 191, 194) — that file is now the sole enforced hooks doc.
   - Update the header comment block (the "2026-06-22 class" note ~line 17) to say README carries only the badge; tier tables + membership are asserted on `hooks/README.md`.
2. **Tests**: `grep -rl check-hook-inventory hooks/tests scripts/__tests__ 2>/dev/null`; if a test pins the README assertions, update its expected error set. If none, note "no test rewire needed."
3. **Link fixups**:
   - `CLAUDE.md` ~line 98: `README.md#superpowers-coexistence` → `docs/coexistence.md`.
   - Any remaining repo-wide `README.md#<anchor>` to a now-moved section: `grep -rn 'README.md#' --include='*.md'` and repoint to the detail doc. (The two CHANGELOG/plan links to `docs/projects/.../README.md#review-background` are a DIFFERENT file — leave them.)
4. **Release hygiene (PATCH)**: this rewires shipped gating code → PATCH bump.
   - **(F1)** `node scripts/sync-version.js --version 2.25.12 --hook-count 20 --skill-count 23 --opt-in-count 12 --disabled-count 0` — `--skill-count` is REQUIRED (`sync-version.js:157-164`); pass all count flags (`--disabled-count` footgun).
   - **(F2)** `sync-version.js` edits ONLY `README.md`'s version badge (`:236-239`), NOT `README.zh-TW.md`. Manually bump the zh-TW version badge to `2.25.12` (badge URL + `alt="v2.25.12"`) or `check-readme-parity.js` will fail on the EN/zh badge mismatch.
   - Add CHANGELOG entry + INDEX row. Run `scripts/preflight-release.sh`.
- **Done when**: §5 gates all green.

---

## 5. Test / validation (run all; fix until green)

| Gate | Command | Asserts |
|------|---------|---------|
| README parity | `node scripts/check-readme-parity.js` | EN↔zh badges + `##`/`###` count equal |
| Hook inventory | `node scripts/check-hook-inventory.js --check` | rewired asserts pass; hooks/README.md still pinned |
| Version mirror | `node scripts/sync-version.js --check` | badges + description fragment consistent |
| Portability gate | `bash scripts/preflight-portability.sh` | esp. #11 (hook inventory) + #15 (README parity) green |
| Release gate | `bash scripts/preflight-release.sh` | CHANGELOG + INDEX + mirror parity for 2.25.12 |
| Dead links | `grep -rn '](\.\./\|](docs/\|](README' README.md README.zh-TW.md docs/*.md \| <verify each resolves>` | no dangling relative link |
| Content preservation (KR2) | spot-canary `grep` per Phase 1 acceptance | moved facts survive in `docs/*.md` |

Human-gated: a read-through of the slim `README.md` for newcomer tone (Board approval at finish-flow).

---

## 6. Risks + inversion

**What would guarantee this fails?**

- **R1 — Parity drift.** EN and zh-TW headings diverge → `check-readme-parity.js` red, preflight #15 red. *Mitigation:* Phase 3 mirrors the LOCKED 11-heading list; run the check before commit.
- **R2 — Silent content loss.** "Slimming" quietly drops a fact instead of relocating it. *Mitigation:* Global Constraint "verbatim move"; Phase 1 canary greps; KR2.
- **R3 — Hook gate breakage.** Removing README hook tables without rewiring `check-hook-inventory.js` → preflight #11 red; OR over-removing the `hooks/README.md` asserts → silent inventory drift. *Mitigation:* Phase 4 step 1 is surgical (keep badge + all hooks/README asserts; drop only README body asserts). Re-run `--check`.
- **R4 — Dangling anchors.** Moving `#superpowers-coexistence` breaks `CLAUDE.md` + README self-links. *Mitigation:* Phase 4 step 3 repoint + repo-wide grep.
- **R5 — Reviewer over-reach.** `/l5` reviewer flags the *relocation diff* as "huge deletion from README." *Mitigation:* commit message + PR body state this is a move; pair each README deletion with the doc it landed in.
- **Inversion check:** if after the change a newcomer still can't answer "what is this / how to start" from screen one, OR any gate is red, the plan failed.

---

## 7. Out of scope (focus as subtraction)

- **No zh-TW detail docs** — explicitly deferred (Board decision). Both READMEs link to English detail docs.
- **No rewriting of the detail content** — pure relocation; improving the prose of coexistence/injection/credits is a separate task.
- **No new diagrams/images** — reuse the existing ASCII art; "圖文並茂" is satisfied by ASCII + emoji-bucketed structure, no external image hosting.
- **No skill/hook/agent behavior changes** — this is docs + one assertion-target rewire only.
- **No `hooks/README.md` *rewrite*** — it stays the canonical hooks doc; the only change is APPENDING the relocated Override + Secret-Detection notes (F3). Its existing tier tables are untouched.

---

## 8. Open questions (Board only)

1. README target length — ~180 lines acceptable, or push harder toward ~120 (which would mean even the "What It Does" buckets shrink to one line each)? *Default if unanswered: ~180.*
2. Keep the "Inspired By" credits discoverable from README's Learn-More table (attribution courtesy for adapted gstack/superpowers/Council/etc. content), or fully tuck into `docs/architecture.md`? *Default: link it from Learn-More.*

---

## Review log

- **R1 (gpt-5.5 xhigh spec review, 2026-06-26)** — `codex exec -m gpt-5.5 model_reasoning_effort=xhigh`, read-only audit of plan-vs-repo. Verdict **FIX-THEN-SHIP** with 3 findings, all verified TRUE by depth-0 against the real files, all folded in above: **F1** version cmd missing `--skill-count 23` (`sync-version.js:157-164`); **F2** `sync-version.js` bumps only README.md badge not zh-TW → manual zh badge bump needed for parity; **F3** README:565–573 Override + Secret-Detection content had no home (hooks/README.md lacked it) → relocate into hooks/README.md. Reviewer **Verified-Clean** the load-bearing parts: `check-hook-inventory.js` line numbers (179/187 keep, 180/181/185/188/189/193 remove, 186/190/191/194 keep) accurate; no other gate pins README hook body; parity check = badges + raw `##`/`###` count only; `CLAUDE.md:98` the sole external anchor link; PATCH bump justified. *(Tooling note: codex's bundled bubblewrap fails `RTM_NEWADDR` loopback in this env — must run `--sandbox danger-full-access`; trusted content only.)*
- **R0 (author, 2026-06-26)** — Plan authored against the live 651-line `README.md`. Hard constraints verified empirically before drafting: `check-readme-parity.js` counts badges + `##`/`###` (preflight #15); `check-hook-inventory.js` pins README.md body asserts at lines 179–194 AND already pins `hooks/README.md` (so relocation needs a script rewire, not a new doc); `hooks/README.md` already exists (218 lines, canonical); `CLAUDE.md:98` is the only external `README.md#anchor` link to a section being moved. Awaiting `/l5 gpt-5.5 xhigh` design-review + execution.
