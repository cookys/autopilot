# Plan v2 — Skill Leverage Extraction (SKILL.md context-cost reduction)

> **Status**: review round 1 complete (Architect/Ops/Skeptic) → revised → scope pending Board confirm
> **Owner**: CEO-agent (autonomous, involvement = results-only)
> **Branch**: `feat/skill-leverage-extraction`
> **Created**: 2026-06-02 · **Revised**: 2026-06-02 (post review R1)
> **Source**: `/next` C-level deep scan (2026-06-01) flagged 4 skills > 200 lines.

## 0. Review round 1 — what changed (verified, not trusted)

Three adversarial lenses dismantled plan v1. All load-bearing claims were re-verified against the actual files before acceptance:

- **🔴 Cross-skill name-lookup coupling** (Architect, verified): `finish-flow/SKILL.md:64` invokes dev-flow's *"Session End L-Full"* checklist **by name**; `ceo-agent/SKILL.md:224` references the *"dev-flow L-1 dimensions checklist"* **by name**. Extracting either block silently breaks a consumer skill that won't have dev-flow's body in context.
- **🔴 Forcing-function extraction = regression** (all 3, verified): dev-flow's Scope Completeness Audit (`:323`) carries the **MANDATORY L-1.5 TaskCreate**; the H Workflow (`:459`) carries the **MANDATORY H-1 TaskCreate**. Hiding a forcing function behind a `(see ref)` pointer reintroduces the exact "passive markdown gets compressed/skipped" failure that `finish-flow` was built to eliminate.
- **🔴 Nested ref paths break the validator** (Ops, reproduced + verified): `validate.sh:65` regex `references/[a-zA-Z0-9_.-]+` cannot match `/`, so `references/<skill>/x.md` is checked as a file named `references/<skill>` → FAIL. v1's KR1 (nested) contradicted KR3 (validate passes).
- **🟠 Hot-path ROI is near-zero for aggressive dev-flow extraction** (Skeptic, accepted): dev-flow's bulk *is* the L-path, and dev-flow is invoked precisely to run L-size work — so extracting L-detail that L-invocations then load back saves nothing on the expensive path. Real savings accrue only on the always-loaded *tail* (anti-patterns, checklists) across all invocations.
- **🟠 P3/P4 are churn** (Skeptic, accepted into Board Decision): think-tank-dialectic and ceo-agent are mostly inline-core control flow; what's extractable is small, low-frequency, and risk ≈ benefit ≤ 0.
- **🟠 validate.sh is too weak to be the verification backbone** (Ops, verified): it checks only frontmatter + link existence — not content. A skill that lost its whole L-workflow would still PASS. Behavior-preservation must rest on a deterministic verbatim-no-loss diff, not validate.sh.
- **Reviewer error caught**: Ops claimed §4 line citations were swapped; verification showed they were correct (`:459`=H, `:501`=L-Full). Rejected.

## 1. Problem framing (proxy-skepticism applied)

No documented 200-line convention exists (the threshold lives only in `skills/next/SKILL.md` as a scanner heuristic; `validate.sh` checks structure, not length). The real lever is **per-invocation context cost**: a `SKILL.md` loads on every invocation. Moving *genuinely passive, on-demand* detail to flat `references/*.md` trims the always-loaded file.

**Loading model — resolved without a new assertion**: this codebase *already* relies on progressive disclosure for passive detail (think-tank-dialectic ships 6 refs, ceo-agent 2, quality-pipeline references anti-rationalization.md, dev-flow references model-routing.md). We extend the **existing shipped pattern** — not a novel unproven mechanism. The hard-won corollary, embodied by `finish-flow`'s very existence, is that **forcing functions stay inline**. This plan obeys that. No spike needed because we assert nothing new: passive detail → ref (proven pattern); forcing function → inline (proven rule).

## 2. OKR (Board framing: 槓桿驅動抽離)

**Objective**: Trim the always-loaded tail of the flagged skills by relocating genuinely passive leaf content to flat `references/`, with **zero behavior change**.

**Key Results**:
- KR1 — Passive leaf blocks (templates, tables, narrative rationale, anti-patterns, checklists) extracted to **flat** `skills/<skill>/references/<topic>.md` with an inline pointer at the origin.
- KR2 — **Behavior preserved**: no forcing function, gate, MANDATORY step, severity vocab, or routing rule extracted; no cross-skill-named section moved without updating the consumer.
- KR3 — Deterministic **verbatim-no-loss** check passes per phase (every removed non-pointer line appears verbatim in a ref).
- KR4 — `scripts/validate.sh` **and** `scripts/preflight-portability.sh` pass.
- KR5 — Line count drops as a *side effect*. No `<200` target. No per-skill line target.

## 3. Hard Extraction Rules (the v2 guardrails)

- **R1 — Never extract a forcing function.** Any block containing a MANDATORY/gate/TaskCreate/red-line stays inline verbatim. (Excludes: dev-flow Scope Audit L-1.5, H Workflow H-1, Quick Decision/Scope-Creep, L-step TaskCreates; ceo-agent Scope Creep Detection "(mandatory)"; think-tank-dialectic Grounding Rules 1-5.)
- **R2 — Never extract a cross-skill-named section** unless the consumer is updated in the same commit. (Excludes: dev-flow "Session End L-Full" [finish-flow:64], "L-1 dimensions checklist" [ceo-agent:224].)
- **R3 — Flat paths only**: `references/<topic>.md`. No nesting.
- **R4 — Verbatim relocation, not rewrite.** Move the block unchanged; leave a pointer that states the trigger.
- **R5 — Extract only genuinely passive content**: templates, example tables, anti-pattern lists, checklists, narrative rationale the runtime never branches on.

## 4. Scope & per-skill targets (PENDING Board confirm — see §10)

Recommended scope = **Option A** (review-converged): real safe work where it pays, cut the churn.

### P1 — dev-flow (conservative; only R1-R5-safe passive blocks) — REVISED post R2
**Extract (flat `skills/dev-flow/references/`):**
| Block | → ref | Why safe |
|---|---|---|
| Post-Feature Doc Sync (`:570-583`) | `post-feature-doc-sync.md` | passive table, no forcing tokens, no external ref (verified R2) |
| Context Continuation (`:105-125`) | `context-continuation.md` | on-demand (resume path only); descriptive, no TaskCreate/gate (verified R2) |

**R2 🔴 fix — DROPPED from extract (must stay inline):**
- ~~Anti-patterns table (`:596-619`)~~ — rows `:610-618` *are* the forcing-function guardrails ("The parent task IS the forcing function", "batching breaks the surface-per-tool-use mechanism", scope-audit reminders). Branched-on defensive content, not passive. **Stays inline.**
- ~~Pre-impl Checklist (`:620-631`)~~ — items `:627-630` *are* the L-1.5/L-1.6/L-5 TaskCreate gates. **Stays inline.**

**Stays inline (R1/R2):** Scope Completeness Audit (L-1.5 TaskCreate + cited by ceo-agent:224), H Workflow (H-1 TaskCreate), L-Full Reference (cited by finish-flow:64), Quick Decision, Scope Creep Detection, Session Rules, Anti-patterns, Pre-impl Checklist, all workflow entry/TaskCreate skeletons. Est. trim ~30 lines (645 → ~615). Small but zero-risk — trims genuinely on-demand tail. *(Note: this is now modest enough that retro/P2 is the substantive win — consistent with the Skeptic's read; P1 retained per Board Option A as a safe, free trim.)*

### P2 — retro (the clean win) — KEEP
Linear skill, no forcing functions, no cross-skill coupling, no `references/` yet.
- `references/data-collection.md` ← Step 1 bash snippets (`~22-53`)
- `references/report-templates.md` ← Step 4 output templates (`~108-176`; block starts at "Format the report as follows", ends at the `---` delimiter — exact ranges re-derived at extraction time per R4)
Keep Step 1-6 sequence inline. Largest clean reduction of the two.

### P3 — think-tank-dialectic — **proposed CUT** (Option A)
Review: low leverage, mostly inline control flow, ~30-60 extractable framing lines woven into rules. Net ROI ≤ 0.

### P4 — ceo-agent — **proposed CUT** (Option A)
Review: same. Scope-Creep-Detection is a mandatory gate (R1, can't move); remainder is small + risk ≈ benefit.

## 5. Verification (per phase) — verbatim-no-loss is the backbone

1. **No-loss diff** (multiplicity-preserving, per R2 🟡): for each extracted block, assert every removed non-pointer line appears verbatim **and with the same count** in its ref — compare with `diff <(grep -vF '<pointer>' removed | sort) <(sort ref)` (no `-u`/dedup, so duplicate blank lines / fence lines / separators can't be silently dropped). Must be empty. This is the named exit criterion; validate.sh is *not* the backbone (it can't see content).
2. **Pointer-completeness**: each ref filename appears exactly once in the origin SKILL.md as a pointer stating the trigger.
3. **External-referrer grep** (the missing structural check): before extracting any block, `grep -rn "<section title>" skills/ agents/ hooks/ scripts/`; if any external referrer exists, either keep inline (R2) or update the referrer in-commit.
4. **`scripts/validate.sh`** passes (frontmatter + link resolution).
5. **`scripts/preflight-portability.sh`** passes at end of P-final (OpenCode discovery + symlink + validate gate).

## 6. Risk (inversion reflex) — post-mitigation

| Risk | Mitigation |
|---|---|
| Forcing function hidden behind pointer | R1: never extract them. |
| Cross-skill dangling reference | R2 + §5.3 external-referrer grep. |
| Silent content drop | §5.1 verbatim-no-loss diff (deterministic). |
| validate.sh false-confidence | §5.1 is backbone; validate.sh demoted to link check. |
| Nested-path validator break | R3: flat only. |
| Theatrical churn (P3/P4) | Option A cuts them; Board confirms. |

## 7. Phases (sequential, one commit per phase = rollback unit)

- **P0**: plan + review loop (this doc) → converge. ✅ R1 done.
- **P1**: dev-flow conservative extraction + verify + commit.
- **P2**: retro extraction + verify + commit.
- *(P3/P4 only if Board picks Option B.)*
- **P-final**: `quality-pipeline` (independent gate) → `preflight-portability.sh` → `finish-flow` (merge develop --no-ff, CHANGELOG Internal entry, INDEX/project update, `learn` eval, archive). Rollback contract: any phase = one `git revert`.

## 8. Out of scope
- Other ~12 sub-200 skills; stdin-pipe hook L-pivot (parked); any skill *content/methodology* change (pure relocation); a `validate.sh` length check (would institutionalize the proxy metric — backlog candidate only, flag don't add); fixing the validate.sh nested-path regex (separate change if ever needed; R3 sidesteps it).

## 9. Versioning (decided, not deferred)
**No version bump.** Internal behavior-preserving refactor, no user-facing change. CHANGELOG entry under a **Maintenance/Internal** heading; INDEX project row + project README. If the Board later overrides to a patch bump, P-final must additionally run `scripts/preflight-release.sh` (CHANGELOG + INDEX + mirror parity).

## 10. Board Decision — scope (the one item contradicting the explicit "all 4" choice)
The Board chose "all 4 skills." Review R1 unanimously flagged P3/P4 as negative-ROI churn. This is a scope *reduction* against an explicit Board choice → surfaced, not decided unilaterally.
- **Option A (CEO-recommended)**: P1-conservative + P2; cut P3/P4 (evaluated-and-rejected, recorded in §4).
- **Option B**: honor "all 4" — add conservative P3/P4 (small, low-value, low-risk).
- **Option C**: P2 only (Skeptic's floor — if even conservative P1's tail-trim isn't worth the indirection).
