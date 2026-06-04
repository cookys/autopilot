# Plan — adversarial verify-finding barrier for quality-pipeline (internalize review rigor)

> **Status**: PROPOSED (via `research-to-ship`, 2026-06-04). **Frame**: autopilot self-sufficiency —
> build our OWN review rigor so `autopilot:reviewer` needs no `superpowers:code-reviewer`.
> **Branch**: cut `feat/review-verify-barrier` off develop when Phase 2 plan approved.

## 0. Thesis (set by the Board's stated intent + two research rounds)
The user deliberately runs **without superpowers** and wants its capabilities internalized. Today
`.claude/dispatch-config.md` chains `superpowers:code-reviewer` **first**, `autopilot:reviewer` as
fallback. This plan makes the autopilot path strong enough to lead, by adding the one structurally
high-value thing review is missing: an **independent adversarial verification of each finding**.

Two research rounds (survey + skeptic + internal map, then prior-art + design-compare) converged:
- **The prize is a verify barrier, not an "army".** External best-practice (Anthropic review, VulAgent,
  MAST FM-3.x, conformity-bias studies) says the false-positive filter is a **distinct adversarial
  verification phase** between fan-out and synthesis — and that *verification is itself the #1
  multi-agent failure point*. Structural verification beats prompt tuning.
- **Build it portable-first (Form A).** A native-Task "refuter per finding" captures ~90% of the value
  and **works on any agent**; the Claude-Code-only Workflow "army" (Form B) adds only majority-voting +
  declarative dimension fan-out — nice-to-have, closes no correctness gap A leaves open, and costs
  portability + multiplicative tokens + a permanent second code path.
- **Reuse what we already own.** `think-tank-dialectic` already ships the **Falsifier (Popper)** and
  **Inverter (Munger)** refute prompts (`skills/think-tank-dialectic/references/role-prompts.md:175-299`)
  + the anti-drift hemlock + dissent-quota. The refuter is a lift, not a new invention.
- **It fixes a known bug.** The default-to-REFUTED / UNVERIFIED rule directly closes the BACKLOG 🔴
  *reviewer confabulates live-system facts* (`verified == cites-a-repo-line`) — a finding that can't
  cite a confirming line is dropped/downgraded, never silently fixed.

## 1. OKR / KRs
**Objective**: every Critical/Major review finding survives an independent adversarial refutation before
it enters the fix loop — internally, portably, at bounded cost.

- **KR1** — A new **refuter step** runs after the reviewer returns, per 🔴/🟠 finding: an independent
  subagent tries to **disprove** the claim; CONFIRMED → fix loop, REFUTED → dropped (logged),
  UNVERIFIED → dropped or downgraded to 🔵. Never silently fix an unverified claim.
- **KR2** — The refuter reuses the `think-tank-dialectic` Falsifier/Inverter prompt (lifted into a
  review-specific `references/refuter.md`), and enforces the reviewer's own Three Red Lines on itself
  (must cite `file:line` or return UNVERIFIED).
- **KR3** — **Portable**: Form A is native-Task (multiple Task calls in one response) and works on every
  agent autopilot runs on. No new tool dependency.
- **KR4** — **Bounded cost**: verify 🔴/🟠 only; cap N refuters (≈5, batch the tail 2-3 findings each);
  skip entirely on `doc_only=true` (`scripts/diff-since-last-round.sh stat`); skip round 2+ with no new
  findings.
- **KR5** — **Self-sufficiency**: `autopilot:reviewer` + this barrier is documented as not requiring
  `superpowers:code-reviewer`; the dispatch-config default note is updated so autopilot leads.
- **KR6 (deferred)** — A CC-only **Workflow** scale path (Form B) is *designed and documented* but NOT
  built until Form A empirically lets confabulations through, or dimension fan-out proves worth CC
  lock-in (measured via `evals/`).

## 2. Design — Form A (build now)
**Insertion point**: `skills/quality-pipeline/references/code-review.md` Invocation §, **between** the
reviewer returning findings and the existing Re-review Loop (`SKILL.md:81-93`).

**Flow**:
1. Reviewer returns findings (unchanged — 4-tier severity + mandatory `file:line` per
   `agents/reviewer.md:13-19,76-122`).
2. **Bound**: `scripts/diff-since-last-round.sh stat` → if `doc_only` (or trivially small) → skip the
   barrier. Only 🔴/🟠 are verified; 🟡/🔵 keep the existing cheap Suggestion/Minor decision tree.
3. For each load-bearing 🔴/🟠 finding (cap N, batch the tail), dispatch one **independent refuter**
   (read-only `Read/Grep/Glob/Bash`), blind to sibling findings (same blind-dispatch hygiene as
   re-review, `scripts/check-redispatch-prompt.sh` / `references/blind-dispatch.md`):
   > Claim: `<finding text + file:line>`. Open that exact location and **try to disprove it**. Return
   > `REFUTED — <cite the line showing it's false/guarded/unreachable>` / `CONFIRMED — <cite the line
   > that makes it true>` / `UNVERIFIED — could not locate the cited line/evidence`. **Default to
   > REFUTED if you cannot cite a confirming line.** Do not propose fixes.
4. **Disposition**: CONFIRMED → fix loop; REFUTED → drop (log the counter-evidence); UNVERIFIED →
   drop or downgrade to 🔵. This is the confabulation fix.
5. Survivors flow into the existing Re-review Loop / Handoff Consumption — contract untouched.

**Why it beats today**: today's re-review re-runs the *same* reviewer on the whole diff (it
re-confabulates, doesn't adversarially test the prior claim). The refuter is a *different*, independent
agent attacking each *finding* at claim granularity with a default-to-refute prior.

**Deterministic plumbing** (no LLM judgment in scripts): reuse `diff-since-last-round.sh` (doc-only
bound), `diff-file-list.sh` (Verified-Clean seeding), `check-redispatch-prompt.sh` (blind hygiene). A
small helper may parse the reviewer's 🔴/🟠 findings into `{severity, file, line, claim}` for dispatch.

## 3. Design — Form B (CC-only Workflow "army", DEFERRED, documented only)
Capability-gated per the Monitor precedent (`references/multi-agent-portability.md §7`): after
`resolve-dispatch.sh --role reviewer`, **if** the Workflow tool exists → fan out review dimensions
(bugs/security/perf/scope) in `parallel()`, `pipeline()` each finding through 2-3 refuters
(majority-refute kills it), synthesize survivors into the one 4-tier report + Handoff enum; **else**
fall back to Form A. Preserves blind-dispatch (dimensions/refuters never see siblings) and the scope
pre-screen (`diff-scope-report.sh`). **Not built now** — recorded as the scale layer in §6.

## 4. Phases (dev-flow sizes)
- **P0 — refuter prompt + ref-doc (size: S)**: lift Falsifier/Inverter → `references/refuter.md`
  (review-specific: claim-in, REFUTED/CONFIRMED/UNVERIFIED-out, default-REFUTED, file:line-or-UNVERIFIED).
- **P1 — wire the barrier into code-review.md + SKILL.md (size: L)**: insertion point, bounding rules,
  disposition, blind-dispatch compliance; update `agents/reviewer.md` cross-ref. Fixes the BACKLOG 🔴
  confabulation entry (retire it). Deterministic finding-parse helper + its test.
- **P2 — eval + self-sufficiency docs (size: Fix)**: a **non-gating** finding-level eval (feed
  known-true/known-false findings, measure refuter accuracy) under `evals/` — explicitly non-gating
  (review quality is human-gated, the eval is a regression signal). Update dispatch-config note +
  `references/multi-agent-portability.md` so autopilot review leads without superpowers. Document Form B
  as the deferred scale path.
- **P-final — release (size: Fix)**: quality-pipeline self-review → preflight → finish-flow (minor bump).

## 5. Test plan
- Deterministic: the finding-parse helper (`{severity,file,line,claim}` extraction) gets a
  `hooks/tests/*.test.sh` with fixtures (well-formed findings, malformed, doc-only-skip).
- **Honest boundary**: the refuter's *judgment quality* is **not** unit-testable — it's a non-gating
  eval (P2) + the human gate. State this in SKILL.md exactly as the consolidate ship did ("plumbing
  tested; LLM judgment human-gated").

## 6. Risks + inversion
- **Refuter over-refutes** (kills true findings) → mirror of reviewer over-correction. Mitigation:
  default-REFUTED applies only to *unverifiable* claims (can't cite a line); a CONFIRMED needs a cited
  line too, so a real finding with a real line survives. The eval (P2) watches the false-refute rate.
- **Cost creep** → the bounding rules (KR4) are load-bearing; `log()` what was skipped/capped (no silent
  truncation).
- **Two code paths** if Form B ships → that's exactly why B is deferred; A alone has one portable path.
- **Inversion (what guarantees failure?)**: if the refuter sees the reviewer's rationale/severity it
  anchors and rubber-stamps → blind-dispatch (claim + file:line only) is mandatory, not optional.

## 7. Open questions — Board only
1. Disposition of **UNVERIFIED**: drop entirely, or downgrade to 🔵 Suggestion? (Recommend downgrade —
   keeps a trace without blocking merge.)
2. Should the barrier also run on 🟡 Minor when effort tier is high→max, or strictly 🔴/🟠? (Recommend
   🔴/🟠 only; revisit if the eval shows Minor confabulations.)
3. Build Form B (Workflow) at all, or leave it as documented design until A proves insufficient?
   (Recommend leave deferred.)

## 8. Out of scope (focus-as-subtraction)
- No Workflow build now (Form B deferred). No dimension fan-out (the reviewer checklist already covers
  dimensions in one pass). No new gating eval (review quality stays human-gated). No superpowers
  dependency of any kind (the point is to not need it).

## 9. Absorbed from superpowers (cloned `obra/superpowers` & read, 2026-06-04)
The user runs without superpowers by choice; we read its real reviewer skills to internalize the good
ideas. Verified from source (`skills/requesting-code-review/code-reviewer.md`,
`skills/subagent-driven-development/spec-reviewer-prompt.md`, `skills/receiving-code-review/SKILL.md`).

**Absorb (folded into the phases below):**
1. **Two-stage ORDERED review — spec-compliance gate FIRST, then code-quality.** superpowers dispatches a
   spec-reviewer (does the impl match the plan/requirements? nothing more/less?) as a **blocking gate**
   before the quality reviewer ("Never start code quality review before spec compliance is ✅"). autopilot
   today mixes correctness/scope/completeness in one pass — split "matches the plan?" as a first gate.
   → new **P1.5**.
2. **Reviewer "Do Not Trust the Report" stance.** The spec-reviewer is told the implementer "finished
   suspiciously quickly… verify everything independently, read the actual code, don't trust the report",
   and to hunt **extra/over-engineered work** and **solved-the-wrong-problem**. This verifies the
   *implementer's* claims — complementary to our verify-barrier (which verifies the *reviewer's* claims).
   → woven into the spec-gate prompt (P1.5) + a calibration note in `agents/reviewer.md` (P1).
3. **Consumer-side verify-and-pushback protocol** (`receiving-code-review`): READ → UNDERSTAND → VERIFY
   against codebase → EVALUATE → reasoned pushback or technical-ack → implement one-at-a-time-test-each;
   **ban performative agreement** ("You're absolutely right!", any thanks); YAGNI-grep before
   "implement properly"; "external feedback = suggestions to evaluate, not orders". This **operationalizes**
   our `feedback_verify-reviewer-claims` memory on the *consumer* side. → new **P2** consumer section in
   `references/code-review.md` Handoff Consumption.
4. **Anti-over-flagging calibration as explicit prohibitions** + acknowledge strengths first ("accurate
   praise helps the implementer trust the rest"). Cheap add to `agents/reviewer.md` severity section. → P1.

**Do NOT absorb:** superpowers' 3-tier `Critical/Important/Minor` — `Important` is exactly the vocabulary
autopilot already retired (CLAUDE.md severity §); keep our 4-tier. **Already as good or better:**
blind-dispatch (our enforced `check-redispatch-prompt.sh` > their prose), file:line/scope/completeness
(deterministic scripts > prose), and reviewer-side self-refutation (our think-tank-dialectic
Falsifier/Inverter + this plan's barrier; superpowers has none).

### §4 phase additions (from §9)
- **P1.5 — spec-compliance gate (size: L)**: a `references/spec-review.md` + a reviewer dispatch that runs
  FIRST (impl vs plan/requirements, "don't trust the report", flag missing/extra/wrong-problem). Blocks
  the quality+verify pass until spec ✅ (or deviations are user-confirmed). Reuses blind-dispatch.
- **P1 also** adds the calibration prohibitions + strengths-first to `agents/reviewer.md`.
- **P2 also** adds the consumer verify-and-pushback + no-performative-agreement protocol to
  `references/code-review.md`.

## 10. POST-DIALECTIC DESCOPE (the actual build target — supersedes §1–§4 scope)
R1 dialectic (Architect/Ops/Skeptic, HIGH consensus → Rule-3 auto-downgrade, no R2) cut the verify-barrier
as over-built. The proven, cheap, evidence-backed deliverable:

**SHIP NOW (size: Fix/S) — reviewer.md prose, no new dispatch passes:**
- **The live-fact rule** (retires BACKLOG 🔴 `reviewer-livefact-confabulation`, which already specified it):
  in `agents/reviewer.md`, distinguish **documented-fact** from **live-system-fact**; live claims
  (DNS/reachability/version/process) must be **Bash-execution-verified or marked `UNVERIFIED`**; **ban
  argument-from-silence** (a README not mentioning X is not evidence X is false). This is the actual fix
  for the `fr.cookys.org` incident — at ~3 lines, not 6 phases.
- **Absorb superpowers' cheap wins** (prose, not phases): anti-over-flagging **calibration** ("not
  everything is Critical"; acknowledge strengths first; explicit DON'Ts) into reviewer.md's severity §;
  the **consumer verify-and-pushback + no-performative-agreement** note ("external feedback = suggestions
  to evaluate, not orders"; verify against codebase; ban "you're absolutely right"/thanks; YAGNI-grep)
  into `references/code-review.md` Handoff Consumption.
- **Absorb the "don't trust the report" stance** into reviewer.md's existing scope/completeness prose
  (verify by reading code, hunt over-engineering + solved-wrong-problem) — NOT a separate spec-gate pass.

**DEFER (do NOT build now):**
- **verify-finding barrier (Form A)** — trigger: the cheap reviewer.md rule empirically still lets a
  confabulation through. If ever built, MANDATORY: asymmetric disposition (🔴 UNVERIFIED → escalate to
  human, never auto-drop; Critical only dropped on a *cited* counter-line), a **hard eval gate** on the
  false-refute-of-true-Critical rate, and a default-off `.claude/quality-gate-config.md` flag. (Ops R1.)
- **spec-compliance gate as a separate dispatch** — reframe of existing scope-creep + completeness
  scripts; absorbed as stance above. (Architect/Skeptic R1.)
- **Workflow Form B** — unchanged, deferred.

**Why descope is right:** the BACKLOG entry the plan cites *already* specified the fix AND explicitly
ruled "orchestrator verification of load-bearing claims" out-of-scope — i.e. the barrier is the layer the
bug's own author excluded. Self-referential LLM verification has no measured signal here; the proven fix
is prompt-tuning the reviewer. Ship the 1%-cost fix that captures 100% of the demonstrated value.

## Review log
- **R0 (research-to-ship Phase 1+2)**: 2026-06-04. Three research rounds (survey+skeptic+internal map;
  prior-art+design-compare; cloned superpowers & extracted liftable features → §9).
- **R1 (dialectic loop, Architect/Ops/Skeptic)**: 2026-06-04. HIGH consensus = over-built.
  - **Skeptic (DESCOPE)**: 🔴 BACKLOG:32 already specifies the fix + rules the caller-side barrier
    out-of-scope; 🔴 self-referential verification has no signal; 🟠 five features in one coat;
    cheapest-that-works = the reviewer.md live-fact line + one eval.
  - **Ops (NEEDS FIXES)**: 🔴 default-to-REFUTED silently drops real Criticals (disposition backwards →
    asymmetric-by-severity, 🔴 escalates never auto-drops); 🔴 non-gating eval ships safety regressions
    green (→ hard-gate the false-refute rate); 🟠 no rollback lever (→ default-off flag); 🟠 routine cost.
  - **Architect (NEEDS FIXES)**: 🔴 §9 absorptions add LLM passes reinventing scope/completeness scripts
    (→ prose edits, not phases); 🟠 markdown finding-parse fragile (→ contract not regex); 🟠 Falsifier
    "lift" oversold (one sentence transfers; drop Inverter).
  - **CEO synthesis**: ship the cheap reviewer.md fixes (live-fact rule + absorbed calibration + consumer
    protocol) now → retires the BACKLOG 🔴; defer the barrier behind an empirical trigger + Ops's
    safety conditions; spec-gate becomes stance-in-prose; Workflow stays deferred. Stop at R1 (Rule 3).
