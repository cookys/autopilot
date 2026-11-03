# Plan — internalize 3 superpowers capabilities (verification / writing-plans / brainstorming)

> **Status**: PROPOSED (via `research-to-ship`, 2026-06-04). Board chose all 3 HIGH candidates, build
> together. Grounded in a clone-and-read survey + a coverage-scoping pass.
> **Frame**: autopilot self-sufficiency — own the capability, don't depend on superpowers.
> **Branch**: `feat/internalize-sp-trio` off develop.

## 0. Scoping (what already exists — don't reinvent)
- **verification-before-completion**: **~80% already shipped** — `anti-rationalization.md` has the 7-point
  checklist + a rationalization table (`:22-35,:178-188`); `agents/reviewer.md:18-24` already bans soft
  language ("probably/likely/seems"); finish-flow L-5.2 already gates fresh verification. **Delta = S**:
  formalize "no completion claim without fresh verification evidence" as a *general* discipline (not just
  reviewer findings / pre-merge), a centralized soft-language red-flag vocab, and the spirit-over-letter line.
- **writing-plans**: ~30% — `plan-bootstrap.md` parses plans, `agents/planner.md` decomposes into Task
  Prompts, EnterPlanMode is a flag. **Delta = L**: a genuine plan-*authoring* skill.
- **brainstorming**: ~50% in spirit — think-tank *decides between known options*, survey *researches*; the
  gap is a *pre-code exploratory design gate* (discover options → spec → approve before coding). **Delta = M**.

## 1. The three deliverables

### A. verification-before-completion (S — formalize, don't rebuild)
Add to `skills/quality-pipeline/references/anti-rationalization.md` a short, shared section:
- **Completion-claim iron law**: no "done / fixed / works / passing" claim without **fresh** verification
  evidence produced *this turn* (ran the command, read the output). Spirit-over-letter: satisfying the
  words while dodging the verification is a violation.
- **Soft-language red flags** (centralized list): "should / seems / probably / likely / appears /
  I think / arguably / pretty sure" in a completion/finding context ⇒ stop, verify, restate as fact or
  mark `UNVERIFIED`. (Reviewer already bans these for findings — this generalizes it.)
- Reference it from `finish-flow` (closing claims) and `agents/reviewer.md` (already partial). No new gate
  mechanism — it's a discipline doc that existing gates point to.

### B. `skills/writing-plans/` (L — new skill)
A plan-*authoring* skill: fuzzy task → structured plan doc. Coexists with: `research-to-ship` (its Phase 2
delegates here), `dev-flow` L-2 (the gate that invokes it), `agents/planner.md` (decomposes an *existing*
plan into Task Prompts — different job). Body discipline (lifted + autopilot-fit):
- File-structure map (which files, what responsibility).
- **Bite-sized phases** with dev-flow sizes (S/L/H/Fix) + per-phase acceptance.
- **Every step concrete** — the actual command / code-shape / expected output, never "add error handling".
- **Self-review checklist** before done: scope-coverage (every requirement → a phase), placeholder scan,
  dependency map, risks + inversion. (Reuse `completeness-scan.sh` framing for the placeholder check.)
- Output to `docs/plans/<YYYY-MM-DD>-<slug>.md` (the existing convention; real date from env).
- Multi-agent portable (pure methodology prose).

### C. `skills/brainstorm/` (M — new skill)
A **pre-code exploratory design gate**. Coexists with: `think-tank` (decide between *known* options /
multi-perspective), `survey` (external research). The distinct job: *discover* options before any are
fixed, and gate implementation on design approval. Body:
- **Socratic, one question at a time** — explore the real need before proposing solutions.
- Surface **2–3 genuinely different approaches** with honest tradeoffs (not strawmen).
- Converge to a short **design spec** + a **hard gate**: do NOT invoke any implementation skill / write
  code until the user approves the approach.
- Hand off to `writing-plans` (B) on approval. Not for: deciding between already-known options
  (→ think-tank), research (→ survey), or a task already scoped (→ dev-flow).

## 2. Cross-cutting (the cargo-cult guardrail)
superpowers' rigor (Cialdini persuasion, "human partner" rhetoric, pressure-test apparatus) is tuned for a
*public* shared codebase (94% PR rejection). autopilot is **self-use** — internalize the **discipline**
(verify-before-claim, design-before-code, concrete-plans), **not** the persuasion machinery. Also absorb
superpowers' **CSO description principle**: a skill's `description:` states **triggering conditions only**,
never a workflow summary — apply to B and C's frontmatter.

## 3. Phases (dev-flow sizes)
- **P0 — verification discipline (S)**: the anti-rationalization.md section + finish-flow/reviewer refs.
- **P1 — writing-plans skill (L)**: `skills/writing-plans/SKILL.md` + wire into research-to-ship Phase 2
  ("delegate → autopilot:writing-plans") + dev-flow L-2 note + fix the 3 dangling `→ writing-plans` refs
  (dev-flow/finish-flow/project-lifecycle "Not for" lines that point at a non-existent skill).
- **P2 — brainstorm skill (M)**: `skills/brainstorm/SKILL.md` + research-to-ship Phase-0 option +
  think-tank/survey boundary notes.
- **P-final — release (Fix)**: validate (skills 18→20) + sync-version 2.13.0 + CHANGELOG + INDEX +
  README skill table/count + quality-pipeline self-review → finish-flow.

## 4. Out of scope (focus-as-subtraction)
- No persuasion/Cialdini apparatus, no "human partner" rhetoric (self-use).
- No pressure-test harness for these skills (overkill for self-use; revisit only if publishing skills).
- writing-plans does NOT decompose into Task Prompts (that's `planner`'s job) — it authors the plan doc.
- brainstorm does NOT decide between known options (that's `think-tank`).

## 5. Test / validation
Doc + skill files → `scripts/validate.sh` (all skills valid, frontmatter), `preflight-portability.sh`,
`preflight-release.sh`. Honest boundary: the *quality* of a brainstorm/plan is human-gated, not testable;
the deliverables are methodology prose, not deterministic scripts.

## 6. Risks + inversion
- **Skill bloat / overlap confusion** (brainstorm vs think-tank vs survey; writing-plans vs planner vs
  dev-flow L-2). Mitigation: crisp "Not for" boundaries in each description; CSO trigger-only descriptions.
- **verification doc becomes ornamental prose** nobody reads. Mitigation: keep it short, reference it from
  the gates that already fire (finish-flow, reviewer), don't add a new unenforced gate.
- **Inversion (what guarantees failure?)**: shipping 2 new skills whose descriptions overlap existing ones
  → the router mis-fires / they never trigger. Mitigation: validate trigger phrases are distinct from
  think-tank/survey/dev-flow; this is the one thing to get right.

## 7. Open questions — Board only
1. Skill name for C: `brainstorm` (discoverable) vs `design-gate` (function-clear)? (Recommend `brainstorm`.)
2. Should `research-to-ship` Phase 2 hard-delegate to `writing-plans`, or keep its inline plan + offer
   writing-plans? (Recommend: research-to-ship delegates to writing-plans — removes its inline duplication.)

## 8. POST-DIALECTIC DESCOPE (build target — supersedes §1/§3)
R1 light dialectic (Architect/Ops/Skeptic, strong consensus) right-sized each candidate:
- **A. verification-before-completion → ALREADY-DONE; salvage = 1 line.** `anti-rationalization.md:17`
  (Unverified completion), `reviewer.md:19` (soft-language ban), `reviewer.md:24` (spirit-over-letter) all
  already exist. Only delta: **generalize the soft-language ban from "findings" to ANY completion claim** —
  one greppable sentence in `anti-rationalization.md`.
- **B. writing-plans → DOWNGRADE to `references/plan-template.md` (a DOC, not a skill).** It's a form, never
  triggers standalone (only invoked by research-to-ship Phase 2 / dev-flow L-2). Repoint the dangling
  `→ writing-plans` refs (grep — ~4 sites) at the template.
- **C. brainstorm → the ONE genuine new skill.** But the trigger MUST be **"options don't exist yet / 還沒想
  清楚 / help me think through"**, NOT "tradeoffs/compare" (which collide with think-tank + survey — the
  discriminator is *whether options exist yet*). Hands off to the plan-template (B), not a plan-skill.
- **Net new skills = 1 (brainstorm), not 2.** Resolve `→ brainstorming` dangling refs to it.
- **Validation (Ops):** the eval harness is an isolation test — can't catch router collision; P-final must
  also do a manual multi-skill routing walk on ambiguous plan/brainstorm/survey/think-tank queries.

Revised phases: P0 = the 1-line verification generalization (S→XS). P1 = `references/plan-template.md` +
repoint `→ writing-plans` refs + research-to-ship Phase 2 delegates to it (Fix). P2 = `skills/brainstorm/`
with options-don't-exist-yet triggers + resolve `→ brainstorming` refs + think-tank/survey boundary (M→S).
Skill count 18→**19** (brainstorm only).

## Review log
- **R0 (research-to-ship)**: 2026-06-04. clone-and-read survey of 14 superpowers skills + coverage scoping.
- **R1 (light dialectic)**: 2026-06-04 → DESCOPE per §8. Skeptic: verification ALREADY-DONE (1-line),
  writing-plans → template-not-skill, brainstorm = the only real skill. Architect: brainstorm trigger =
  "options-don't-exist-yet" not "tradeoffs" (router collision). Ops: eval is isolation-only → manual
  routing walk at P-final. CEO: build the 1 skill + 1 template + 1-liner; all 3 capabilities addressed at
  their correct size.
