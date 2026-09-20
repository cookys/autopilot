# Plan — distill multi-machine `consolidate` (deferred feature revisit)

> **Status**: PROPOSED. Revisits §0.3.1 (DEFERRED post-R3) of `docs/plans/2026-06-03-distill-skill.md`.
> **Owner**: cookys (participatory). **Branch**: cut `feat/distill-consolidate` off `develop` when P0 passes.
> **Created**: 2026-06-04. **Frame**: focus-as-subtraction; spike-before-assert; solve-real-problem-not-artifact.
> **Headline recommendation**: **BUILD-DORMANT (thin)** — ship a dormant collision detector + a manual
> `consolidate` verb that only does work when a real same-slug pack conflict exists; do NOT pre-build
> staging or an always-on merge engine. See §2.

## 0. What R3 killed, and how this plan answers each point (the gate)
R3 cut the original §0.3.1 for four reasons. This plan must clear all four or be cut again.

| # | R3 kill reason | This plan's answer | §ref |
|---|---|---|---|
| 1 | **Consumption regression** — `_candidates/` lives outside `skills/`, so CC never loads it; a dead artifact until a manual `consolidate`. | **No persistent staging dir.** Variants are never written to a parallel un-loaded tree. The canonical `skills/<slug>/SKILL.md` is *always* the loaded artifact and is never absent. Conflicting variants live transiently as **git objects** (the other machine's commit / the stash), surfaced on demand at conflict time — not as on-disk un-loaded skills. | §5 |
| 2 | **Unverified loader claim** — "`_candidates/` not loaded by CC" was spike-before-assert violation. | State VERIFIED-vs-ASSUMED explicitly (§5.1). The doc-level claim (CC discovers only `<plugin>/skills/` + `.claude/skills/`) IS cited (`references/multi-agent-portability.md:15`) but is **not firsthand-spiked**. The design is made **robust to either answer** by not relying on a staging dir at all. A confirmatory spike is P0-gated. | §5.1 |
| 3 | **Content-hash key self-defeating** — per-machine atoms differ → different `<slug>-<shorthash>` keys → the ≥2-variant branch ~never fires. | **Merge key = the skill SLUG / frontmatter `name:`**, which is machine-stable by construction (the LLM names the *procedure*, not the atoms). Collision is detected by **git path identity** (`skills/<slug>/SKILL.md`), the same key git already conflicts on. No content hash anywhere. | §4 |
| 4 | **Preconditions don't exist; apparatus:yield ≈ 10:1** — trigger (first real pack `SKILL.md` pull conflict) has not fired. | **Dormant-until-trigger** (§2): build only the thin mechanism that costs ~nothing while idle and activates exactly when the trigger fires. Defended against the eager alternative. The deferral's standing cost (one hand-merge) is explicitly the fallback if even this is too much. | §2 |

## 1. Problem (the user's actual goal)
A fleet of machines each run `/distill` and push to the shared private pack
`~/.claude/skills/autopilot-distill-skills/`. When the **same recurring procedure** is distilled on
two machines, both write `skills/<slug>/SKILL.md` → `git pull --rebase` (Step 5) hits a content
conflict → today the skill **STOPS and hands the user a raw git conflict**. The user wants that one
remaining manual step replaced by an **automatic LLM merge of the N variants into the best canonical
skill, human-gated**, that then converges the fleet.

Today's behavior (shipped, SKILL.md Step 5): "If the pull hits a same-name `SKILL.md` conflict, STOP
and hand it to the user." This plan turns STOP into **detect → merge → gate → converge**.

## 2. Activation decision — BUILD-DORMANT (thin), not eager, not stay-deferred
**Decision: build a thin mechanism now that stays dormant until the trigger fires.**

Three options were weighed:
- **(a) Stay-deferred** (status quo). Cost when it fires: a raw `git merge` conflict on a YAML-frontmatter
  markdown file, hand-resolved once. Honest assessment: this is *cheap* (one file, the user wrote both
  halves) but it lands at the worst time — mid-`/distill`, mid-rebase, with the user holding a half-pushed
  batch. The friction is the **interruption + git-surgery context-switch**, not the merge thinking.
- **(b) Eager full build** (the original §0.3.1: per-host staging tree + always-on merge engine + status
  host-counts). Rejected — this is exactly the 10:1 apparatus R3 cut, and it reintroduces the consumption
  regression (R3 #1).
- **(c) Dormant-thin** (RECOMMENDED). Build (i) a **collision *detector*** wired into the existing Step 5
  `pull --rebase` path that recognizes the specific "same-slug pack `SKILL.md` conflict" signature, and
  (ii) a **manual `consolidate` flow** the detector hands off to. While no collision exists, the detector
  is one extra `git` exit-code check that is **never true** → zero behavior change, zero new on-disk
  artifacts, no consumption regression. The merge machinery is **the LLM at conflict time**, not standing code.

**Defense of (c) over (a)**: the marginal cost of (c) above (a) is small and *front-loadable now* (a
detector + a documented flow + tests), whereas (a)'s cost is *paid by future-me at the worst moment*.
(c) also has near-zero idle cost — unlike the eager build, it adds no loaded/un-loaded artifact and no
parallel tree to keep coherent. **Defense of (c) over (b)**: (b)'s staging tree is the thing R3 proved
self-defeating; (c) deletes it.

**Honest activation condition**: even (c) should be built **only once the user confirms a 2nd machine is
enrolled and pushing** (precondition #4). If at P0 the fleet is still a single machine with no remote
pushes, the recommendation degrades to **stay-deferred** — there is no collision to merge, and a detector
for an impossible event is theater. P0 (§8) gates on this.

## 3. OKR / KRs
**Objective**: Replace the one remaining manual step in fleet `/distill` — hand-resolving a same-procedure
pack conflict — with an automatic, human-gated LLM merge that converges the fleet, **without** regressing
native CC consumption or building standing apparatus.

- **KR1 — Detection**: a same-slug pack `SKILL.md` conflict on `git pull --rebase` (Step 5) is detected
  deterministically (git exit code + conflicted-path parse), distinguished from any other conflict, with
  **0 false positives** on the existing union-merge case (different slugs → no conflict → detector silent).
- **KR2 — Merge**: on detection, the N variants (ours + theirs, extracted from git, not from a staging dir)
  are LLM-merged into ONE canonical `SKILL.md` that (a) passes `scripts/validate.sh`, (b) preserves the
  union of distinct procedural steps, (c) drops duplicate phrasings.
- **KR3 — Human gate**: the merged canonical is shown to the user for approve/edit/reject **before** it is
  written or committed. No auto-write of a merge the user didn't see (privacy + correctness backbone, per
  the shipped Step 3 gate convention).
- **KR4 — Convergence**: on approval, the canonical is committed once (single-writer on `skills/<slug>/`)
  and pushed; other machines pick it up on their next `pull --rebase` with **no further conflict** (their
  variant is an ancestor of the canonical).
- **KR5 — Zero idle cost / no consumption regression**: with no collision present, behavior, on-disk
  artifacts, and CC skill discovery are byte-identical to v2.10.2. No `_candidates/`, no un-loaded tree.
- **KR6 — Deterministic tests**: the detector + extraction + gate-invariant are covered by
  `hooks/tests/*.test.sh` deterministic tests (the LLM merge step itself is non-gating eval, never red/green).

## 4. Merge-key design (solves R3 #3)
**The key is the skill SLUG (== frontmatter `name:` == directory name), which is machine-stable.**

- A distilled skill's slug is the LLM's *name for the procedure* (Step 2: "Name each genuinely recurring
  procedure"), e.g. `fix-git-identity`, `remote-dev-handoff`. The slug is derived from the **semantics**
  of the procedure, not from per-machine frequency atoms. Two machines that distil "the same procedure"
  converge on the same slug because they're naming the same thing — that is the whole premise of the
  feature. (Risk: they pick *different* slugs for the same procedure → §7; handled, not assumed away.)
- **Collision detection key = git path identity** `skills/<slug>/SKILL.md`. This is *exactly* the key git
  itself conflicts on — we do not invent a second key that could disagree with git. When machine B's
  commit and machine A's commit both touch `skills/<slug>/SKILL.md` with divergent content, `git pull
  --rebase` produces a conflict on that path. The detector reads `git diff --name-only --diff-filter=U`
  (or `git -C "$PACK" status --porcelain` for `UU` entries) → any conflicted path matching
  `skills/*/SKILL.md` is a consolidation candidate.
- **No content hash, anywhere.** R3 #3 is dissolved: there is no `<slug>-<shorthash(atoms)>` key to split.
  The shipped v2.10.2 already writes **plain slug** (`skills/<slug>/SKILL.md`, SKILL.md Step 4 "Plain slug,
  no staging") — this plan does not change the write key, it only adds behavior on the conflict that the
  plain-slug key produces.

## 5. Staging-vs-consumption design (solves R3 #1 + #2)
**There is no staging directory.** This is the core design move that dissolves R3 #1+#2.

- The **only** loaded artifact remains `skills/<slug>/SKILL.md`. It is never absent and never shadowed by
  an un-loaded parallel copy. CC consumption is unchanged from v2.10.2.
- The "N variants" are not on-disk un-loaded files; they are **git objects**, materialized transiently at
  conflict time:
  - **ours** = the working-tree / `HEAD` version of `skills/<slug>/SKILL.md` (already loaded, already CC-visible).
  - **theirs** = the incoming commit's version, read via `git show <REBASE_HEAD|MERGE_HEAD>:skills/<slug>/SKILL.md`
    (a blob read — never written to a loaded path).
  - (≥3 machines is just N applications of the same two-way step as commits stack; see §6.)
- The merged canonical is computed in memory by the LLM, shown to the user, and on approval written
  **directly to the loaded `skills/<slug>/SKILL.md`** (overwriting the conflict markers), then committed —
  the rebase continues (`git rebase --continue`). At no point does an approved-or-pending skill sit in a
  dir CC doesn't read. **R3 #1 (dead artifact until manual step) cannot occur** because there is no parallel
  artifact to go stale.

### 5.1 Loader claim — VERIFIED vs ASSUMED (answers R3 #2 honestly)
- **VERIFIED (cited)**: CC skill discovery paths are `<plugin>/skills/` and `.claude/skills/`
  (`references/multi-agent-portability.md:15`, sourced to plugins-reference docs). A sibling dir under the
  pack (e.g. a hypothetical `_candidates/`) is therefore **not** a discovery path *per the doc*.
- **ASSUMED / NOT firsthand-spiked**: that CC's live in-session loader *ignores* a non-`skills/` sibling
  dir in a loaded `@skills-dir` pack, and that a `.git/` dir in the pack doesn't perturb discovery. The
  original §0.3.1 asserted the staging-dir-not-loaded claim from a doc that R3 found didn't support it —
  that exact mistake.
- **How this plan is robust to the answer**: by removing the staging dir entirely (§5), the plan **does
  not depend** on "the staging dir isn't loaded." The only loaded path is the canonical, which is loaded
  by design. The one residual loader question — *does `.git/` inside the pack break discovery?* — is
  already on the shipped path (the pack is a git repo today, v2.9.0+) and is **P0-spiked** (§8), not assumed.

## 6. The consolidate flow (ties into Step 5)
Wired into the existing SKILL.md Step 5 `pull --rebase` → `push`. Today Step 5 says: same-name conflict →
STOP, hand to user. This replaces STOP with the flow below; everything else in Step 5 is unchanged.

1. **Pull** (unchanged): `git -C "$PACK" pull --rebase`.
2. **Detect** (new, deterministic): if the rebase stops with conflicts, run a detector
   (`scripts/distill-consolidate.sh detect`, JSON) that lists conflicted paths matching `skills/*/SKILL.md`.
   - **No such conflict** (different slugs, or a non-skill file like `plugin.json`) → fall back to today's
     behavior: STOP and hand the raw conflict to the user. The auto-merge is scoped **only** to same-slug
     `SKILL.md` conflicts — the case the user described. (Focus-as-subtraction: we don't try to auto-merge
     `plugin.json` or arbitrary files.)
   - **One or more same-slug `SKILL.md` conflicts** → continue.
3. **Gather N variants** (new): for each conflicted `<slug>`, extract **ours** (`:2:` / working tree) and
   **theirs** (`:3:` / `git show REBASE_HEAD:…`) blobs. ≥3 machines: the rebase replays commits one at a
   time, so each is a two-way (ours-so-far vs next-incoming) merge; the canonical accumulates. The script
   only *extracts and presents*; it does **not** merge (no LLM in a deterministic script — mirrors
   distill-scan.js's "no LLM in the count path").
4. **LLM-merge** (new, the skill body drives this): the `/distill` skill instructs Claude to merge the
   variants into the best canonical — union of distinct steps, dedup phrasings, keep the clearer wording,
   preserve frontmatter `name:`/`description:`. This is the skill's prose, not a script.
5. **Human gate** (new, reuses the Step 3 convention): present the merged canonical (a diff vs both
   variants is ideal) via `AskUserQuestion` — approve / edit / reject. **Run the identifier lint +
   deny-list on the merged draft first** (a merge could surface an identifier neither half flagged alone),
   exactly as Step 3 gates writes today. Nothing is written that the user didn't approve.
6. **Write canonical + continue rebase** (new): on approval, write the approved text to
   `skills/<slug>/SKILL.md` (the loaded path), `git add` it, `git rebase --continue`. On reject → `git
   rebase --abort` and fall back to today's hand-off (the user keeps the standing option to resolve manually).
7. **Push / converge** (unchanged Step 5 tail): `git -C "$PACK" push`. Single-writer on `skills/<slug>/`
   per resolution ⇒ no concurrent-edit conflict on the canonical. Other machines `pull --rebase` and
   fast-forward (their variant is now an ancestor) — **no second conflict**, fleet converges. Concurrent
   consolidate on two machines self-heals: the second push is rejected → pull → the second machine sees its
   variant already subsumed (clean) or a fresh two-way merge → re-gate → converge.

## 7. Risks + inversion
**Inversion — what would guarantee this fails?**
1. **Slug divergence** — two machines name the same procedure differently (`fix-git-identity` vs
   `git-identity-fix`) → **no path collision → detector never fires → the feature silently does nothing**
   for the exact case it exists for. This is the sharpest failure and the residue of R3 #3 that the
   slug-key does NOT fully solve (it solves "same name → same key"; it can't force two LLMs to choose the
   same name). *Mitigation*: (a) accept it as out of scope for v1 (the merge handles *path collisions*,
   which is what the user described — "collide on the same `skills/<slug>/SKILL.md`"); (b) a later
   enhancement could add a slug-alias/near-duplicate detector at `consolidate` time, explicitly deferred.
   *This is an Open Question for the Board (§10).*
2. **Auto-merging the wrong thing** — detector misfires on a non-same-procedure same-slug collision (two
   genuinely different procedures that happened to get the same slug) → LLM merges unrelated content into
   mush. *Mitigation*: the human gate (KR3) is the backstop; the LLM is instructed to **refuse and escalate
   to manual** if the two variants are not recognizably the same procedure.
3. **Rebase-state surgery bugs** — `git rebase --continue/--abort` left in a bad state on
   reject/edit/crash. *Mitigation*: deterministic tests on a fixture pack (§8); on any script failure, fall
   back to STOP + hand-off (never leave a half-rebase silently).
4. **Loader perturbation by `.git/`** — already on the shipped path, but P0-spiked (§5.1).
5. **The trigger never fires** — single-machine fleet → all of this is dead code. *Mitigation*: the §2
   activation gate (build only after a 2nd pushing machine exists; else stay-deferred).

| Risk | Mitigation | KR |
|---|---|---|
| Slug divergence → detector silent | scope to path-collisions; defer alias-matching; Board Q | §10 |
| Wrong-merge into mush | human gate + LLM "refuse if not same procedure" | KR3 |
| Rebase state corruption | fixture tests + fall-back-to-STOP on any failure | KR6 |
| `.git/` breaks discovery | P0 spike (already shipped path) | §8 |
| Dead code (no 2nd machine) | §2 activation gate; degrade to stay-deferred | §2 |

## 8. Phases (P0/P1/P2) with dev-flow sizes
- **P0 — gate + spike (size: S)**: (i) **Confirm the precondition** — is there a 2nd machine enrolled and
  pushing to the pack? If NO → STOP, recommendation reverts to stay-deferred, archive this plan. (ii)
  **Spike** the one residual loader question: a pack with `.claude-plugin/plugin.json` + `skills/x/SKILL.md`
  + `.git/` → start CC → confirm `x` discoverable and `.git/` doesn't break discovery (this also de-risks
  v2.9.0's existing claim). Record VERIFIED. No code yet.
- **P1 — detector + extraction + tests (size: L)**: `scripts/distill-consolidate.sh` with `detect` (JSON:
  conflicted same-slug `SKILL.md` paths) and `variants <slug>` (extract ours/theirs blobs). Deterministic,
  no LLM. Wire detection into SKILL.md Step 5 prose (replace STOP with detect→handoff). Tests per §9.
- **P2 — merge flow + human gate + convergence (size: L)**: SKILL.md prose for the LLM merge + the
  `AskUserQuestion` gate + lint-on-merged-draft + `rebase --continue/--abort` handling + push/converge.
  Update `references/sync-setup.md` (the "resolve by hand once" passages now describe the auto path).
  Gate-invariant test (§9). Un-defer §0.3.1 in the 2026-06-03 plan; CHANGELOG/INDEX/SKILL.md "Deferred"
  section update.
- **P-final — release (size: Fix)**: `quality-pipeline` → `preflight-portability.sh` → `finish-flow`
  (merge, minor bump — new user-facing capability — `preflight-release.sh`).

## 9. Test plan (mirrors `hooks/tests/*.test.sh`)
New `hooks/tests/distill-consolidate.test.sh` (sourcing `lib.sh`, using a `$TEST_TMP` fixture **bare+clone
pack** to simulate two machines), asserting deterministically:
1. **Detect — true positive**: two clones both commit a divergent `skills/foo/SKILL.md`; `pull --rebase`
   on one → `detect` JSON lists `skills/foo/SKILL.md` as a same-slug conflict.
2. **Detect — true negative (no false positive on union merge)**: machine A adds `skills/foo/`, machine B
   adds `skills/bar/` → clean union merge, **no conflict**, `detect` returns empty. (Proves KR1's 0-FP on
   the shipped conflict-free case.)
3. **Detect — scope**: a conflict on `plugin.json` (not a skill) → `detect` does NOT claim it; flow falls
   back to STOP. (Proves the auto-merge is scoped to `skills/*/SKILL.md`.)
4. **Variants extraction**: `variants foo` emits both ours and theirs blobs verbatim (byte-exact), and
   `validate.sh`-shaped frontmatter survives extraction.
5. **Gate invariant** (mirrors §6.4 of the 2026-06-03 plan): assert no canonical is written/committed
   without an explicit approval transition — a reject path → `rebase --abort` → working tree restored,
   `skills/foo/SKILL.md` byte-identical to pre-pull (no silent write).
6. **Convergence**: after machine A resolves+pushes, machine B `pull --rebase` fast-forwards with **no
   conflict** (assert `detect` empty on B post-pull).
7. **Idempotency/degrade**: `detect` on a clean (non-rebasing) pack → empty, exit 0; on a non-git dir →
   exit 0 empty (degrade clean, like distill-sync-setup `status`).

The LLM merge quality itself is a **non-gating eval** (stripping/union quality on N seeds), never red/green
— mirroring the shipped split (deterministic lint = CI gate; abstraction quality = non-gating eval), and
the parity-test convention that `distill-scan.js` got this ship.

## 10. Open questions — Board only
1. **Slug divergence (§7 #1)**: accept "merge only fires on exact-path collision" for v1 (cheap, matches
   the user's literal "collide on the same `skills/<slug>/SKILL.md`"), or invest in near-duplicate slug
   matching now (larger, fuzzier, more wrong-merge risk)? **Recommendation: accept v1 scope; defer aliasing.**
2. **Activation (§2)**: is there genuinely a 2nd machine enrolled and pushing to the pack today? If not,
   confirm we stay-deferred rather than build dead code.
3. **Reject fallback**: on user-reject of a merge, is `git rebase --abort` + hand-off the desired behavior,
   or should we offer "keep mine, drop theirs" / "keep theirs" quick options? (Affects P2 UX surface.)
4. **Concurrency appetite**: is the rare concurrent-consolidate self-heal (second push rejected → re-merge)
   acceptable, or does the Board want an explicit pack lock? **Recommendation: rely on git's push-reject
   self-heal; no lock (simpler, matches commit-on-approve durability model).**

## 11. Out of scope (focus-as-subtraction — what we deliberately do NOT build)
- **No per-host staging tree / `_candidates/`** — the thing R3 killed; §5 dissolves the need.
- **No always-on merge engine / `status` host-variant counts** — merge is the LLM at conflict time only.
- **No content-hash key** — slug/path identity only (§4).
- **No auto-merge of non-`SKILL.md` conflicts** (`plugin.json`, settings) — those still STOP for the user.
- **No project-scoped consolidate** — a project has one repo, not a fleet of writers; rides project git.
- **No slug-alias / near-duplicate matching in v1** (deferred, §10 #1).
- **No pack lock / distributed coordination** — git push-reject self-heal suffices.
- **No publish-grade de-id** — self-use threat model unchanged.

---

## v2 — Board-approved CORRECTED design (build target; supersedes §2/§5/§6 above)
**Board decision 2026-06-04**: build the full consolidate engine, corrected per R1. The held-rebase design
in §5/§6 is REPLACED by the abort-first merge design below. (Fleet evidence the same day: commit
`ec7eeec` authored by `cookys+twgs-dev@gmail.com` proves a 2nd machine `twgs-dev` exists and pushes —
the "no 2nd machine" deferral premise is materially weaker, though that push was to the autopilot repo,
not yet the pack.)

### v2.1 — the one move that fixes both R1 🔴s: fetch+merge, abort-first
R1 found two criticals: (A) Architect — in `pull --rebase`, `:2:`/`:3:` and `REBASE_HEAD` are inverted
(the loaded side is upstream, not yours); (B) Ops — holding a rebase open across the LLM merge + human
gate can wedge the pack. **Both dissolve by switching the consolidate path from `pull --rebase` to
`fetch` + `merge`, and aborting before the slow steps:**
- **Merge `:2:`/`:3:` are the intuitive sides** — `:2:` = ours = **this machine** (HEAD), `:3:` = theirs
  = **incoming** (`MERGE_HEAD`). No inversion. (Detect/extract still read **index stages** via
  `git ls-files -u` / `git show :2:`/`:3:`, which are backend-stable — not `REBASE_HEAD`.)
- **Abort-first** — extract both blobs from the index *while the conflict exists*, then **`git merge
  --abort` immediately** (clean HEAD = this machine's variant). The LLM merge + lint + human gate run on
  a **clean working tree** — a crash mid-gate loses nothing; the pack is never left mid-transaction with
  conflict markers in a loaded `SKILL.md`.

### v2.2 — corrected consolidate flow (replaces §6)
1. `git -C "$PACK" fetch origin`.
2. **Guard**: if the pack is already mid-merge/mid-rebase on entry → STOP, print recovery
   (`git merge --abort`). Never start on a dirty transaction.
3. `git -C "$PACK" merge --no-commit --no-ff origin/<branch>`.
   - **Clean merge** (different slugs → union, the shipped conflict-free case) → it just succeeds; commit
     and `push`. No consolidation needed. (KR1 true-negative.)
   - **Conflict** → `distill-consolidate.sh detect` partitions conflicted paths (from `git ls-files -u`):
     - any **non-`skills/*/SKILL.md`** conflict (e.g. `plugin.json`), or any **add/delete vs edit** (a
       `:2:` or `:3:` blob missing — out of scope for v1) → `git merge --abort` + STOP + hand to user.
     - one-or-more **edit/edit same-slug `SKILL.md`** conflicts → continue.
4. **Extract while stages exist**: for each conflicted `<slug>`, `mine = git show :2:skills/<slug>/SKILL.md`,
   `theirs = git show :3:skills/<slug>/SKILL.md` → temp files. (`distill-consolidate.sh variants <slug>`
   emits both verbatim; pure git, no LLM.)
5. **`git merge --abort`** → clean HEAD. No held transaction across the slow steps.
6. **LLM-merge** each `{mine, theirs}` → canonical (skill prose, §6.4 unchanged): union of distinct steps,
   dedup phrasings, preserve `name:`/`description:`. The skill is instructed to **refuse + escalate to
   manual STOP if the two variants are not recognizably the same procedure** (R1 Architect/Skeptic
   wrong-merge guard).
7. **Lint + human gate** (Step 3 convention): run identifier lint + deny-list on each merged draft;
   present via `AskUserQuestion` (approve / edit / reject). Nothing written unapproved.
8. **Commit the resolution as a real merge** (fast, scripted, held only milliseconds): re-run
   `git merge --no-commit origin/<branch>` (re-conflicts instantly from cache) → overwrite **every**
   conflicted `skills/<slug>/SKILL.md` with its approved canonical → `git add` → `git commit` (completes
   the merge, **both parents recorded** → other machines see a true ancestor). Resolve ALL conflicted
   same-slug paths before committing (R1 Architect multi-slug fix). On **reject** → `git merge --abort`
   (already clean) + STOP/handoff.
9. `git push`. Other machines `git pull` (or fetch+merge) and fast-forward / clean-merge — the canonical
   has both variants as ancestors → no re-conflict.

### v2.3 — scope honesty (R1 Architect + Skeptic)
- **v1 = 2-way only** (this-machine vs incoming-tip). ≥3 unconsolidated variants converge over multiple
  sync cycles, NOT one merge — stated, not hidden. A 3-clone test documents the multi-cycle behavior.
- **Slug-divergence stays out of scope** (two machines naming the same procedure differently → no path
  collision → engine silent). Accepted for v1 per Board Q1-recommendation; alias-matching deferred.

### v2.4 — convergence + rollback corrections (R1 Ops)
- **KR4 downgraded**: "converges when consolidates are **serialized**." Concurrent same-slug consolidate
  on two machines is rare; the second push is rejected → re-merge → re-gate. The LLM merge is
  non-deterministic, so termination is bounded by human re-gates, not guaranteed by an ancestor invariant.
  No pack lock (Board Q4-recommendation: git push-reject self-heal).
- **Fleet-rollback runbook (NEW, required)**: a poisoned approved-then-pushed canonical propagates to the
  fleet. Rollback = `git -C "$PACK" revert <sha> && git push`; other machines absorb the revert on their
  next sync (the same channel that propagated the poison propagates the fix). Document in
  `references/sync-setup.md`; the human gate (KR3) remains the primary backstop.

### v2.5 — test additions (R1 → §9)
- Assert `git show :3:` == `MERGE_HEAD:` and `:2:` != `:3:` (lock the corrected side-labelling).
- True-negative: different-slug merge is clean, `detect` empty (KR1, 0 false positives).
- Scope: `plugin.json` conflict → `detect` excludes it → flow STOPs (no auto-merge of non-skills).
- **Crash-safety invariant**: simulate abort-after-extract → working tree byte-identical to pre-fetch HEAD
  (proves abort-first leaves no half-state). Reject path → same.
- 3-clone fixture documents multi-cycle (not one-merge) convergence for ≥3 variants.

## v3 — post-R2 synthesis (the actual build target; supersedes v2's reactive flow)
**R2 verdict**: all R1 🔴s RESOLVED (merge `:2:`/`:3:` verified correct, abort-first kills the wedge), but
R2 found the v2 design still carries the wrong *frame* and is missing its own precondition. v3 incorporates:

### v3.1 — proactive fetch+compare (replaces v2.2's react-to-conflict dance) — Skeptic 🔵, dissolves 3 Architect/Ops findings
Don't react to a merge conflict — **prevent it**. At `/distill` push time, BEFORE committing the pack:
1. `git -C "$PACK" fetch origin`.
2. For each `skills/<slug>/SKILL.md` about to be written/committed: `theirs = git show @{u}:skills/<slug>/SKILL.md`
   (empty if absent). Compare to `mine` (working tree).
3. **Divergent** (both exist, differ) → LLM-merge {mine, theirs} → lint → human gate → write canonical to
   the working-tree file → then a normal `git add` + commit + `pull --rebase` + `push` (canonical already
   contains theirs ⇒ the rebase applies clean). **No `merge --no-commit`, no `--abort`, no `MERGE_HEAD`
   state, no re-merge window.** This deletes the entire transaction-crash risk class (v2.5's crash-safety
   invariant becomes moot — there is no held transaction to crash). Collapses v2.2's 9 steps to 3.
   - This dissolves R2-Architect's TOCTOU + no-fetch-between guards and R2-Ops's re-merge-window-re-wedge
     + crash-mid-commit findings — they were all artifacts of the reactive merge-state machinery.

### v3.2 — slug-normalizer FIRST (the precondition that makes the engine fire at all) — Skeptic 🔴
The engine fires only on byte-identical independent slug choice → near-zero hit rate without this. Add a
**deterministic slug normalizer** applied at distill *write* time (Step 4 write key): lowercase →
tokenize on `-`/`_` → drop a small stopword set (`fix`, `ensure`, `setup`, `the`, …) → sort tokens →
rejoin. So `fix-git-identity`, `git-identity-fix`, `ensure-git-identity` all converge to one canonical
slug → two machines naming the same procedure now collide on one path → the engine has something to merge.
**This is smaller than the merge engine and is its precondition** — build it FIRST. Pure deterministic,
testable with zero 2nd-machine precondition. (Risk: over-collapse — two *genuinely different* procedures
normalize to one slug. Mitigation: the existing same-name-collision refuse + human gate catches it; keep
the stopword set tiny and conservative.)

### v3.3 — mandatory fixes (R2 Architect 🔴 + Ops 🔴), frame-independent
- **Use `@{u}`, never `origin/<branch>`** — `distill-sync-setup.sh` already sets upstream via `push -u`,
  so `@{u}` resolves the pack's real branch (`main`/`master`/`develop`). STOP if `@{u}` unset.
- **Fleet-revert runbook is broken as written**: a consolidate commit is (under v2) a merge → `git revert`
  needs `-m 1`. Under v3.1 the resolution is a *normal* commit (no merge commit), so plain `git revert
  <sha>` works again — **v3.1 also fixes the rollback**. Still document the **descendant case**: if a peer
  already re-consolidated on top of the poison, the revert is itself a same-slug conflict → manual STOP,
  not auto-merge.
- **Honest test framing**: state plainly that the engine's *correctness* is **human-gated, not tested** —
  the deterministic tests cover git plumbing; the LLM merge quality is a non-gating eval. Don't let 7
  green plumbing tests imply the merge is verified.

### v3.4 — convergence honesty (R2 Skeptic 🟠)
Step 9's "converges, no re-conflict" converges *topologically* (the DAG) but the *content* is re-LLM'd at
every new-variant arrival with no semantic fixpoint. State this: convergence is DAG-level; content
thrashes until variants stop arriving. Acceptable for a rare event; do not overclaim a fixpoint.

### v3.5 — revised phases (dev-flow sizes)
- **P0 — slug-normalizer (size: S/L)**: deterministic normalizer + wire into distill Step 4 write key +
  tests. **No 2nd-machine precondition.** Highest leverage; unblocks the engine's value. Ship-able alone.
- **P1 — proactive fetch+compare consolidate (size: L)**: `distill-consolidate.sh compare <slug>`
  (deterministic: fetch + `git show @{u}:…` + diff/exit-code) + SKILL.md Step 5 prose (LLM-merge + gate +
  normal commit) + `@{u}` guard + tests (true-positive divergent, true-negative identical, absent-on-theirs).
- **P2 — rollback + docs (size: Fix)**: fleet-revert runbook (with descendant case) in
  `references/sync-setup.md`; un-defer §0.3.1; CHANGELOG/INDEX/SKILL.md "Deferred" update; honest
  test-framing note.
- **P-final — release (size: Fix)**: quality-pipeline → preflight-portability → finish-flow (minor bump).

**Activation note**: P0 (normalizer) needs no precondition and is pure upside — build now. P1/P2 (the
engine) still benefit from a real 2nd machine pushing to the *pack*; the twgs-dev evidence is repo-only so
far. Recommend: build P0 now; P1/P2 follow (Board already approved "build engine").

## Review log
- **R0 (planner draft)**: 2026-06-04, Plan agent. Headline: BUILD-DORMANT (thin), conditional on a real
  2nd pushing machine.

### R1 — dialectic loop (Architect / Ops / Skeptic), 2026-06-04
**Architect — NEEDS FIXES (real mechanism bug):**
- 🔴 §6.3 **ours/theirs inverted.** In `git pull --rebase`, stage `:2:` = upstream (the *other* machine),
  `:3:` = your replayed local commit, and `REBASE_HEAD` == `:3:` (same side). The plan labels theirs =
  `:3:` = `REBASE_HEAD`, which is actually *your own* side. Fix: label variants by machine ("this" /
  "incoming"), not by the merge mnemonic; assert `:3:` == `REBASE_HEAD` and `:2:` != `:3:` in tests.
- 🟠 §6.3 **≥3 machines does NOT "accumulate"** — it's 2-way (this-machine vs upstream-tip) or N sequential
  gates. State v1 = 2-way only; add a 3-clone test or drop the "accumulates" framing.
- 🟠 §6.2 **rebase-state parsing is backend-fragile** (`merge` vs `apply` backend; `REBASE_HEAD` only in
  merge backend). Detect from porcelain index stages (`git ls-files -u` / `status --porcelain=v2`), which
  are backend-stable; don't rely on `REBASE_HEAD`.
- 🟡 lock the deterministic/LLM split invariant; resolve ALL conflicted paths before `--continue`.

**Ops/SRE — NEEDS FIXES (durability-backbone hazard):**
- 🔴 **Held-open rebase across LLM-merge + human gate.** If the session dies mid-gate, the pack is wedged
  in `rebase-in-progress` with conflict markers in the *loaded* `SKILL.md`; next `/distill` pull fails;
  fleet source-of-truth stuck. Fix: **abort-first** — `git rebase --abort` immediately on detection,
  extract ours/theirs as detached blobs, merge+gate+write+commit on clean HEAD, then push. Rebase becomes
  a transient extraction step, never a held transaction.
- 🔴 **No rollback for a poisoned canonical already pushed** → KR4's clean propagation becomes the
  blast-radius amplifier (poison fast-forwards to the whole fleet). Add a fleet-revert runbook
  (`git revert <sha>` + push) to `references/sync-setup.md`.
- 🟠 **Concurrency can ping-pong**, not converge (LLM merge is non-deterministic → C_A ≠ C_B → KR4
  "ancestor" claim false under concurrent consolidate). Downgrade KR4 to "converges when serialized."
- 🟡 "zero idle cost" → "zero idle cost on the clean-sync path." 🔵 handle add/delete conflicts (missing blob).

**Skeptic — STAY DEFERRED (empirically grounded):**
- 🔴 **Activation precondition is FALSE today.** Verified the pack on disk: 2 commits, one author, one
  machine, zero remote-machine pushes, zero conflicts ever. By the plan's own §2 gate → stay-deferred now.
- 🔴 **Slug-divergence guts the hit rate to ~0**: fires only on the intersection of (a) same procedure
  distilled on 2 machines, (b) both pushed, (c) byte-identical independent LLM slug choice. R3's
  "≥2-variant branch ~never fires" relocated from content-hash to slug-string, not dissolved.
- 🟠 **Proxy skepticism**: automating a once-or-never one-file merge is artifact-completeness, not toil
  reduction. **Cheapest-thing-that-works**: upgrade Step 5's STOP into a side-by-side "here's both
  variants, merge by hand" message — zero new script, zero rebase automation, zero test suite, zero
  rebase-state risk — captures ~all the value. The plan never compared against this baseline.

### CEO synthesis (Hegelian) — 2026-06-04
- **Thesis** (Architect+Ops): buildable, but only after an abort-first redesign + the ours/theirs fix +
  a fleet-revert rollback + scoping to 2-way.
- **Antithesis** (Skeptic): don't build the engine — the trigger hasn't fired (verified), the hit rate is
  near-zero, and a side-by-side STOP message captures ~all the value at ~1% of the cost and risk.
- **Synthesis (NOT compromise)**: the Skeptic wins the *apparatus* question and the Architect/Ops win the
  *if-we-ever-build-it* question. Ship the **cheap baseline now** (side-by-side STOP hand-off in Step 5 —
  trivial prose, improves the eventual conflict whenever it fires, works without rebase automation), and
  **keep the consolidate engine DEFERRED** with the corrected (abort-first, machine-labelled, fleet-revert)
  design recorded here for the day the trigger actually fires. This honors solve-real-problem (the user's
  friction = raw git archaeology, which the message removes) AND focus-as-subtraction (no near-empty
  apparatus) AND the durability backbone (no held-open rebase on the source of truth).
- **Corrected engine design (for the future build, do NOT build now)**: abort-first extraction; variants
  labelled by machine via index stages `:2:`/`:3:` (backend-stable, not `REBASE_HEAD`); v1 = 2-way only;
  KR4 = "converges when serialized"; fleet-revert rollback runbook; add/delete conflict tolerance.
- **Recommendation to the Board**: down-scope to the cheap baseline; engine stays deferred until a real
  pack `SKILL.md` conflict fires (R3's original trigger, empirically still unmet).
- **Board decision (2026-06-04)**: OVERRIDE — build the engine, corrected version. → see `## v2`.

### R2 — dialectic loop (re-check of v2 corrected design), 2026-06-04
All R1 🔴s confirmed RESOLVED by all three reviewers (merge `:2:`/`:3:` verified, abort-first kills the
wedge). NEW convergent findings → folded into `## v3`:
- **Architect (NEEDS FIXES)**: 🔴 `origin/<branch>` undefined → use `@{u}`. 🟠 re-merge TOCTOU + no-fetch-
  between guards needed. (v3.1 proactive reframe dissolves the TOCTOU class.)
- **Ops (NEEDS FIXES)**: 🔴 fleet-revert runbook broken on merge commits (`-m 1`); 🔴 peer-re-consolidated-
  on-poison descendant case; 🟠 rebase-vs-merge history inconsistency. (v3.1 normal-commit resolution fixes
  the revert; descendant case documented.)
- **Skeptic (NEEDS FIXES)**: 🔵 **proactive fetch+compare** strictly simpler than reactive merge-state
  (→ v3.1); 🔴 **slug-normalizer is the precondition** or the engine is dead code (→ v3.2); 🟠 convergence
  is DAG-topological not semantic (→ v3.4); test/eval split hides that merge correctness is human-gated.
- **CEO R2 synthesis**: corrected engine is mechanically sound but mis-framed. v3 = proactive compare
  (deletes the transaction-crash risk class) + slug-normalizer FIRST (unblocks value) + the mandatory
  `@{u}`/revert fixes. Stop at 2 rounds (dialectic cap); design has converged.
