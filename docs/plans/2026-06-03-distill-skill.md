# Plan v3 — `distill` skill (recurring procedures → user-level skills, fleet-synced via a path CC already reads)

> **SUPERSEDED IN PART — 2026-08-24 (v2.34.39).** This plan's identifier-lint design is historical.
> The deny-list (`~/.autopilot/distill/identifiers.deny`) was **rejected and removed** under
> [ADR-0001](../adr/0001-verification-over-attestation.md): a deny-list silently passes every name it
> was never told and then emits a "lint-clean" label, which attests that a list was consulted rather
> than that the text is clean. The lint now lives in `scripts/identifier-scan.js` (the `--lint` flag
> named below never shipped; `distill-scan.js` exposes `--path`). Current contract:
> [`references/knowledge-routing.md`](../../references/knowledge-routing.md) §5.

> **Status**: ✅ Shipped in v2.9.0 — merged as `ef1f542` (2026-06-03). Flat MVP built (scan + review→pack/project write); consumption verified end-to-end on a fresh session; multi-machine consolidate deferred (§0.3.1). All Board decisions resolved (§11); spiked & verified (§0.1).
> **Owner**: cookys (participatory). **Branch**: `feat/distill-skill` (not cut). **Created**: 2026-06-03 · **Revised**: 2026-06-03 (post R1, R2).
> **Frame**: [[project-methodology-sync-frame]]; self-use-first ([[feedback-solve-real-problem-not-artifact]]). Name `distill` working (§11-A).

## 0. What R2 found, and how v3 answers it

R2 (Architect/Ops/Skeptic, verified firsthand) confirmed v2 fixed scrub-theater + false-reuse honestly, but landed **3 new criticals**. v3 answers each by *removing apparatus*, not adding it.

| R2 critical/important (verified) | v3 answer |
|---|---|
| 🔴 **No consumption path** — v2 synced SOPs to `~/.autopilot/distill/methodology/`, a dir nothing reads | **The layer IS `~/.claude/skills/`** — CC discovers user-level skills on every session, every project (`multi-agent-portability.md:15`). Approved artifacts land there; machine B's CC reads them with **zero manual step**. |
| 🔴 **Doesn't reduce toil** — v2 = scan→approve→install→sync-setup loop | Loop collapses: `scan`→`review`(approve) **writes the skill into `~/.claude/skills/`**; that dir is the sync sink; machine B auto-discovers. The only irreducible manual step is the one-time privacy approval; sync setup is one-time per machine. |
| 🔴 **Complexity grew; P-dogfood proved the opposite** (release ritual already codified in `finish-flow` + `preflight-release.sh`) | Verbs cut 4→3; `install`-renderer **removed** (writing the skill file *is* install, since the dir is consumed); `kind: sop/checklist` **removed** (the consumable unit is a *skill*); hooks **out of scope** (so the release ritual is a *separate hand-written hook*, not a distill "discovery"). |
| 🔴/🟠 **Hook-install clobbers `core.hooksPath`** (live: already `=.githooks`) | Distill no longer emits hooks. The release-ritual hook is a separate deliverable (§8 companion), hand-written, wired per `install-hooks.sh` convention. Clobber risk gone from distill. |
| 🟠 **Lint theater for bare hostnames / client names** | §5: lint claims **honestly split** into "reliably catches" (ipv4/email/`/home/<user>/`/FQDN/key-shapes) vs "cannot — gate's job". Add a **per-machine deny-list** (`~/.autopilot/distill/identifiers.deny`) → exact-match the hostnames/clients regex can't infer. |
| 🟠 **Gate UX unbounded → rubber-stamp** | `scan` emits **top-K (≤7) by frequency** per run; review must be exhaustible in one sitting. Friction escalates when sink is shared (proper-noun tokens visually segregated). |
| 🟠 **Slug merge wrong-split + new clobber** | Merge key = **content-derived** (`<slug>-<shorthash(sorted atoms)>`): same procedure→same key (no split), different→different (no clobber). Human slug is display-only. |
| 🟠 **Privacy test non-deterministic** (LLM in assert path) | §6 splits: **deterministic CI gate** = lint flags seeded literals; **non-gating eval** = abstraction stripping-rate as a quality metric, never red/green. |
| 🟠 **iterateRecords() endangers hook lib** | **Dropped.** `distill-scan.js` duplicates ~30 lines of parse convention (line-cap/`\r\n`/try-catch); the fail-open hook lib is untouched ([[project-hook-transcript-pivot]]). |
| 🟠 **install bar near-empty (validate.sh structural only)** + CLAUDE.md 3-place wiring | KR claims downgraded to "well-formed skill the user completes"; §8 deliverable checklist names the CLAUDE.md inventory + SKILL.md table rows. |
| **Self-use vs publish tension** | v1 = **self-use** (sync between cookys's own machines; lighter de-id, deny-list suffices). Stranger-publish de-id rigor + portability hardening → **deferred** to a publish phase (§8), off the v1 critical path. |

**Net: v3 is smaller than v1.** 3 verbs, 1 new script, no lib change, no install renderer, no separate methodology store, no hook generation.

## 0.1 Consumption-path spike (VERIFIED, official docs — the one load-bearing claim)
Per [[feedback-spike-before-assert]], the bet "write to `~/.claude/skills/` → globally consumed → syncs cleanly" was verified against `https://code.claude.com/docs/en/skills` before building, not asserted:
- ✅ **Personal skills are global**: docs "Where skills live" table — `~/.claude/skills/<name>/SKILL.md` **Applies to: All your projects**. "Personal skills are available across all your projects."
- ✅ **Live pickup, no restart** for add/edit/remove under `~/.claude/skills/` *within* a session — EXCEPT the **first-ever creation** of the `~/.claude/skills/` dir (didn't exist at session start) needs one restart to start being watched. (This machine: `~/.claude/skills/` does NOT yet exist → first sync to a fresh machine requires one CC restart; subsequent skills are live.) Documented caveat, not a blocker.
- ✅ **Command name = directory name**; only `description` needed for CC discovery (autopilot's `validate.sh` additionally wants `name` — generated skills include both).
- ✅ **Premise endorsed by CC itself**: docs — "Create a skill when you keep pasting the same instructions, checklist, or multi-step procedure into chat." That is distill's exact premise.
Conclusion: R2's fatal "no consumption path" is genuinely resolved. §11-B (verify-first) is **satisfied**. The remaining open question is value (does `scan` produce useful skills?) → P1 value-gate, empirical.

## 0.2 Architecture principle — factory vs products (locked 2026-06-03)
**autopilot ships the distiller (the factory); it never contains the distilled skills (the products).** The products are the user's personalized/custom skills and live in *user space*, never in autopilot's public repo. This matches how autopilot already works (hooks write `~/.autopilot/`, dispatch reads `.claude/*.md` — machinery in-repo, artifacts in user space) and CC's own `run-skill-generator` precedent (a shipped skill that writes a per-project `.claude/skills/run-<name>/`).

**Scope-aware routing**: the scan already attributes each signal to its originating project via the in-line `cwd`. So `distill review` routes each approved skill by scope:
- **Global/personal** (e.g. fix-git-identity, remote-dev-handoff) → `~/.claude/skills/<key>/`
- **Project-specific** (e.g. an llm-playground eval rule, a hangar file-guard) → `<that-project>/.claude/skills/<key>/`
CC's personal-vs-project-vs-plugin scoping (verified §0.1) backs this. autopilot's repo stays clean; the user's two skill tiers receive the products.

## 0.3 Fleet model — sync is a first-class concern, not P4 docs (the case is MANY machines)
Writing a product to one machine's skill dir is useless for a fleet. Sync splits cleanly by the same scope axis, and most of it is already solved:
- **Project-scoped products ride the project's own git — zero new infra.** A skill committed to `<project>/.claude/skills/` propagates whenever any fleet machine pulls that project. No distill-specific sync at all.
- **Global personal products need exactly ONE dedicated fleet channel.** Model: a **skills-directory plugin pack** (verified against plugins-reference §358-367) — `~/.claude/skills/autopilot-distill-skills/` containing `.claude-plugin/plugin.json` + `skills/<key>/SKILL.md`. The whole pack folder **is** a private git repo (source of truth); CC loads it **in place** as `autopilot-distill-skills@skills-dir` (no install, no marketplace). distill writes a new skill into `…/skills/<key>/` (post-approval) → commit/push; other machines pull → CC loads the whole pack. Per-skill subdirectory ⇒ union merge, conflict-free. Distilled skills are namespaced `autopilot-distill-skills:<key>`, cleanly separated from the user's hand-authored personal skills; the pack can also carry the user's personal hooks/agents ("…and more"). Syncthing-on-the-pack-folder is the no-git alternative.
  - **Project-scoped products use plain skills** in `<project>/.claude/skills/<key>/` (NOT a pack): plain project skills walk up to the repo root, whereas a project-scope `@skills-dir` pack does not (plugins-reference §386) — and they ride the project's own git for free.

**Fleet brain**: the private personal-skills repo is the source of truth; each machine's distiller contributes (gated) and each machine's CC consumes. Any machine produces → whole fleet consumes after pull. Fleet enrollment = one-time clone of that repo to `~/.claude/skills/` per machine. This elevates §4.4 sync from a docs afterthought to the architecture's spine.

### 0.3.1 ⛔ DEFERRED post-R3 (premature over-build) — see §0.3.2
R3 (Architect/Ops/Skeptic, convergent + verified) cut this whole layer: (1) it **regresses consumption** — `_candidates/` sits outside `skills/` so CC never loads it until a manual `consolidate` runs (the R2-killed "dead artifact until manual step", resurrected); (2) the "`_candidates/` not loaded" claim was **unverified** (cited doc didn't support it — spike-before-assert violation); (3) the content-hash key is **self-defeating** — per-machine frequency atoms differ across machines → different keys → consolidate's ≥2-variant branch ~never fires → wrong-split; (4) **preconditions don't exist** — `~/.claude/skills/` isn't even created on machine 1, no 2nd machine, no same-procedure-on-two-machines case. Apparatus:yield ≈ 10:1 for ~3 proven skills. **Deferred until a real cross-machine conflict actually occurs** (trigger: first real `git pull` conflict on a pack `SKILL.md`); cost of deferral = one hand-resolved merge conflict, possibly never paid. The original text is retained below for the future-revisit, struck.

### 0.3.2 R3 MVP (flat pack, direct write) — THIS is the build
- distill `review` writes the approved skill **directly** to the loaded location (no staging, loads immediately):
  - global → `~/.claude/skills/autopilot-distill-skills/skills/<slug>/SKILL.md` (the pack = a private git repo = the sync unit + namespace separation from hand-authored skills — keeps the user's "整包" benefit, drops the merge engine)
  - project → `<project>/.claude/skills/<slug>/SKILL.md` (rides project git)
- **plain slug**, no content-hash key. Keep the privacy backbone (human gate + lint + deny-list) — that's NOT fleet apparatus.
- sync = manual `git push`/`pull --rebase` on the pack repo (first-run-no-upstream guard documented). No consolidate, no `_candidates`, no `status` host-counts.
- **Spike before P2** (R3 unverified points): build a pack (`.claude-plugin/plugin.json` + `skills/x/SKILL.md` + `.git/`) → start CC → confirm (a) the pack loads + `x` is discoverable, (b) `.git/` doesn't break discovery, (c) whether a newly-added skill subdir in the *loaded pack* picks up live or needs `/reload-plugins`. Don't assert live-pickup for the pack case (doc only confirms it for plain skills).
- Verbs reduce to **2** (`scan`, `review`); CLAUDE.md-wire `distill-scan.js` (currently dead-code per repo rule).

<details><summary>0.3.1 original (DEFERRED — retained for future revisit)</summary>

### Multi-machine conflict model — stage-then-consolidate (NOT naive per-file union)
"Per-skill subdir ⇒ conflict-free" is only true when each skill is owned by ONE machine. The valuable case is the opposite: the same recurring procedure distilled on MANY machines → all target the same `skills/<key>/SKILL.md` → genuine git content-conflict / overwrite. Resolution (the user's "let it conflict, then refine-merge" instinct, made concrete) = two layers inside the pack:
- **`_candidates/<host>/<key>/SKILL.md`** — each machine writes ONLY under its own host subdir → structurally impossible to git-conflict (per-host paths, the verified conflict-free pattern). Lives OUTSIDE `skills/`, so CC's plugin loader (reads `skills/` only, plugins-reference §787) never loads staging as a skill. Tracked+synced so any machine can see all hosts' variants.
- **`distill consolidate`** (occasional, single-machine maintenance verb) — for each `<key>`: 1 host variant → promote to `skills/<key>/`; ≥2 host variants → **LLM-merge/refine the variants into the best canonical, human-gated**, write `skills/<key>/` (single-writer ⇒ no concurrent-edit conflict on canonical). CC loads only `skills/`.
- **Conflict → quality**: N machine-variants of one procedure are high signal + complementary phrasings → the consolidated canonical is better than any single-machine version. Concurrent consolidate is rare and self-heals (second push rejected → pull → re-consolidate → converge).

</details>

## 1. Problem
A multi-machine user re-runs the same procedures by hand and re-teaches preferences per machine; refined practice on machine A never reaches B. The reusable unit that CC *already consumes* is a **skill** (`~/.claude/skills/`). So: capture recurring procedures as user-level skills, let them sync to the fleet through the dir CC already reads. Disciplined users author skills by hand; most never do — `distill scan` is the on-ramp that proposes them from local history, human-gated.

## 2. OKR
**Objective**: Turn a user's recurring hand-run procedures into approved user-level skills that propagate across their fleet via a path CC natively consumes — no dead dirs, no per-machine manual install.

- KR1 — `distill scan` reads local `~/.claude/projects/*` → a **new** `scripts/distill-scan.js` emits deterministic frequency atoms → LLM proposes **top-K (≤7)** generic candidate skills.
- KR2 — `distill review`: human approves/edits/rejects; **approved → `~/.claude/skills/<key>/SKILL.md`** (a `validate.sh`-passing, well-formed skill the user can refine). Merge key = `<slug>-<shorthash(sorted atoms)>`.
- KR3 — **Consumption is native**: once written to `~/.claude/skills/`, CC discovers it on machine A immediately and on machine B after sync — no install verb, no consumer to build.
- KR4 — **Fleet sync = Syncthing on `~/.claude/skills/`** (home-relative, per-skill-subdir conflict-free); private-git documented fallback. Zero skill code (R7).
- KR5 — **Privacy (self-use scope)**: human-approval gate is primary; LLM abstraction reduces surface; lint + per-machine deny-list backstop structured + named identifiers. Raw history never leaves the machine.
- KR6 — Deterministic atoms, LLM patterns (no invented counts). CC-only, degrade clean, cache-safe.

## 3. Hard rules
- **R1 — The unit is a user-level skill in `~/.claude/skills/`.** No separate methodology store; no `install` renderer; the consumable artifact and the synced artifact are the same file.
- **R2 — Human-approval gate is the privacy backbone** (not abstraction, not lint). Nothing reaches `~/.claude/skills/` (hence sync) without per-candidate approval.
- **R3 — Distill no hooks, no auto git-config mutation.** Hook automation (release ritual) is a separate hand-written companion deliverable.
- **R4 — Deterministic atoms, LLM naming.** Counts from `distill-scan.js`; abstraction/naming from the LLM; no fabricated evidence.
- **R5 — Top-K bounded review.** `scan` surfaces ≤7 candidates/run; review is exhaustible. Local raw read, never transmitted.
- **R6 — Don't touch the hook transcript lib.** Duplicate parse conventions in `distill-scan.js`.
- **R7 — Sync is transport docs, not skill code.** Syncthing primary / private-git fallback, on `~/.claude/skills/`.
- **R8 — CC-only, degrade clean, cache-safe.** First step checks `~/.claude/projects/`; write target is the user's `~/.claude/skills/`, never the read-only plugin cache.

## 4. Architecture
### 4.1 Verbs (4) — see §0.2 routing + §0.3.1 conflict model
```
distill scan        local history → atoms → propose ≤7 generic candidate skills (local stage ~/.autopilot/distill/candidates/)
distill review      approve/edit/reject (lint/deny-list flags shown); on approval, route + WRITE STAGED:
                      global  → pack  _candidates/<host>/<key>/SKILL.md      (per-host, conflict-free)
                      project → plain <project>/.claude/skills/<key>/SKILL.md (rides project git; no staging — single repo)
distill consolidate (maintenance) per <key> across hosts: 1 variant → promote; ≥2 → LLM-merge + human-gate → pack skills/<key>/
distill status      list canonical skills + per-key host-variant counts (consolidation candidates)
```
No `install` (writing the SKILL.md is install). No `sync` verb (R7: git on the pack repo / Syncthing). Project-scoped skills skip staging+consolidate (a project has one repo, not a fleet of writers).

### 4.2 scan pipeline
1. **Scan (deterministic)** — `scripts/distill-scan.js` iterates all `~/.claude/projects/*/*.jsonl`; per-line robust parse (own copy of line-cap/`\r\n`/try-catch). Tallies normalized-command n-grams, slash/skill frequency, adjacent-event n-grams, a fixed documented bilingual friction-phrase hit list (lexical proxy, per R1-A3). Project attribution from the in-line `cwd` field (never dir-name encoding — [[project-hook-transcript-pivot]]). Emits a frequency-atom JSON.
2. **Propose (LLM, from atoms only)** — top-K≤7 recurring procedures, **abstracted to generic steps**. If a procedure can't be generic without losing its value (inherently-specific class — a deploy keyed to one host), **refuse to emit it** and flag "manual-author only" (Architect R2-B1). Output = candidate SKILL.md drafts, `status: candidate`, staged locally.
3. **Lint + deny-list (deterministic)** — `scripts/distill-scan.js --lint` flags structured identifiers (ipv4/email/`/home/<user>/`/dotted-FQDN/key-shapes) **and** exact matches from `~/.autopilot/distill/identifiers.deny` (user's real hostnames/client names). Flags shown at review.

### 4.3 review → write (staged) → consolidate
Human approves/edits each candidate. Key = `<slug>-<shorthash(sorted atoms)>` (same procedure → same key across machines; distinct → distinct). On approval, write a well-formed SKILL.md (`name`+`description` so `validate.sh` passes; body = generic procedure) to the **staged, per-host** location:
- global → `<pack>/_candidates/<host>/<key>/SKILL.md` (per-host path ⇒ no git conflict; not under `skills/` ⇒ CC doesn't load staging)
- project → `<project>/.claude/skills/<key>/SKILL.md` directly (single-repo, no fleet of writers)

`distill consolidate` later turns staged per-host variants into the canonical `<pack>/skills/<key>/SKILL.md` (§0.3.1): single variant → promote; multiple → LLM-merge + human-gate. CC loads `skills/` only.

### 4.4 Sync (R7 — docs, not code)
- **Primary**: Syncthing share on `~/.claude/skills/` (home-relative; per-skill subdir → union, no conflict; CC reads it on every machine). Caveat: both ends online to converge.
- **Fallback**: a private git clone *of* `~/.claude/skills/` (or a subtree); documented `pull --rebase`/commit/push recipe with the first-run-no-upstream guard spelled out. No `gh`.
- Memory dir (`~/.claude/projects/<encoded>/memory/`) is **not** synced in v1 — its path encodes the cwd and differs per machine (spike before any attempt). Skills only.

### 4.5 Config `~/.autopilot/distill/config`
```
TOPK=7
DENYLIST=~/.autopilot/distill/identifiers.deny   # user's real hostnames/client names, one per line
```

## 5. Privacy model (re-ranked per R2-B1)
Layers, strongest first:
1. **Human-approval gate (R2)** — load-bearing. Every candidate is reviewed (bounded to ≤7) before it can reach `~/.claude/skills/` and sync.
2. **Generative abstraction** — surface reducer: candidates are generic by construction; the inherently-specific class is *refused*, not faked-generic.
3. **Lint + deny-list** — backstop. Catches structured identifiers by signature and named ones (hostnames/clients) by the user's deny-list membership check. Honest scope: bare proper nouns not on the deny-list are the gate's responsibility, not the lint's.
Self-use scope: cookys syncs to his own fleet; the threat model is "don't leak my data off my machines", satisfied by gate+deny-list. Stranger-publish hardening (richer DLP, mandatory pre-publish human diff) is a later phase, not v1.

## 6. Verification
1. **scan determinism** — fixture history → identical atom JSON (golden; no LLM in counts).
2. **lint (deterministic, CI gate)** — seed `jane@x.com`, `/home/bob/clientA/`, `10.4.2.17`, `postgres://…`, **and** a deny-listed `prod-db`/`acme-corp`; assert all flagged. (This is the real safety net — the test secret-patterns.js failed.)
3. **abstraction (eval, non-gating)** — run real proposal over N seeds, report stripping-rate as a metric, never red/green.
4. **gate invariant** — assert no SKILL.md reaches `~/.claude/skills/` without a `candidate→approved` transition.
5. **merge key** — same atoms on two hosts → same `<key>` dir (no split); different atoms → different dirs (no clobber).
6. **consumption** — write an approved skill to `~/.claude/skills/`, start a fresh CC session, assert it's discoverable (the KR3 claim — must be demonstrated, not assumed; R3 below if it fails).
7. **no-history no-op** + `validate.sh` on generated skills + distill's own degrade fixture (preflight-portability doesn't cover it).

## 7. Risk
| Risk | Mitigation |
|---|---|
| Synced skill not actually consumed by machine B | §6.6 consumption test is the named exit gate; if `~/.claude/skills/` discovery doesn't work cross-machine, the whole skill is moot → **verify in R3/P1 before building** |
| Generic-mush candidates | top-K + human reject; refuse inherently-specific; value-check on real history at P1 *before* P2 |
| Named identifier (hostname/client) leaks | gate (primary) + deny-list; honest lint scope; self-use threat model |
| Slug split/clobber | content-hash merge key (§4.3) |
| LLM-invented evidence | R4 atoms-only |
| Hook clobber | distill emits no hooks (R3) |
| Maintenance surface | one script; CLAUDE.md 3-place wiring in §8 checklist; no hook-lib change |

## 8. Phases
- **P0**: this plan + **R3 focused review** (consumption-path claim + the new merge-key/deny-list controls) → converge.
- **P1 (value gate)**: `scripts/distill-scan.js` + golden determinism test **+ run it on cookys's REAL history and manually inspect**: do top-K candidates look like useful skills, or mush? **If mush → stop here**, the premise fails. (Retires R1/R2's "value unproven" before investing further.)
- **P2**: `review` flow → write to `~/.claude/skills/`; lint+deny-list; gate invariant + §6.2/§6.4/§6.5 tests; **§6.6 consumption test**.
- **P3**: Syncthing/git sync **docs** on `~/.claude/skills/`; `status`; references (scan-spec, sync-setup, privacy-model); CLAUDE.md inventory row + SKILL.md table row; INDEX/README/CHANGELOG.
- **Companion (parallel, independent)**: the release-ritual **git hook** (record-SHA + `preflight-release.sh` gate) — hand-written, the user's proven toil-win, ships regardless of distill.
- **Publish phase (deferred)**: stranger-grade de-id, portability hardening, `multi-agent-portability.md` — only if/when publishing.
- **P-final**: `quality-pipeline` → `preflight-portability.sh` → `finish-flow` (merge, minor bump, archive, `preflight-release.sh`).

## 9. Out of scope (v1)
Hooks/git-config mutation by distill; memory-dir sync (path-encoding spike first); `sop/checklist` kinds (the unit is a skill); count-merge; scheduled scan; non-CC history; stranger-publish de-id hardening; a sync engine.

## 10. Versioning
New user-facing skill → minor bump; P-final runs `preflight-release.sh` ([[feedback-release-hygiene]]).

## 11. Board decisions — RESOLVED (CEO, 2026-06-03)
CEO owns "how"; these are two-way doors → decided now, not deferred (speed calibration). Board may override any.
- **11-A Name** — **DECIDED: keep `distill`.** `codify` fits the methodology frame marginally better, but the name is our established vocabulary across plan + memory + thread; renaming is a trivial future two-way door not worth the churn now. Revisit at build time if it grates.
- **11-B Consumption verification first** — ✅ RESOLVED. Spiked & verified against official docs (§0.1).
- **11-C Companion release-ritual hook** — **DECIDED: separate/parallel deliverable, ships first.** It's the user's proven toil-win and must not wait on distill's unproven value. Out of *this* plan's scope (focus as subtraction); tracked as its own small Fix-size task.
- **11-D Self-use v1 vs publish-ready** — **DECIDED: self-use first.** v1 threat model = "don't leak my data off my own machines" (gate + deny-list suffice). Stranger-publish DLP + portability hardening deferred to a publish phase (§8). Honors [[feedback-solve-real-problem-not-artifact]].

## 12. CEO execution stance (proxy skepticism governs)
The plan is complete; the *premise* is not yet proven. Therefore execution is **gated, not linear**: **P1 (value-gate) is a one-way checkpoint** — build only `scripts/distill-scan.js`, run it on real history, inspect top-K. If the candidates are useful → proceed to the full L-size project (project dir + README + INDEX + phase tasks + finish-flow per ceo-agent L-1). If mush → stop, archive this plan as "premise disproven", ship only the companion hook (11-C). This spends ~1 script of effort to de-risk the whole skill, rather than building the L-size apparatus on an unproven premise (Boil the Lake applies to *each thing we commit to* — but focus-as-subtraction decides *whether* to commit). No L-size project dir is created until P1 passes — deliberate, not an oversight.
