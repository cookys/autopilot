# Skill contract card — shape spec

> Canonical operational definition of the 童子軍規則 target (CLAUDE.md keeps only a pointer here —
> single canonical home). Origin: `docs/plans/2026-07-08-observation-first-skills.md` (合約卡);
> shipped by `docs/plans/2026-08-18-dev-flow-contract-card.md` P1. Style precedent:
> [`four-layer-design.md`](four-layer-design.md) ("a rule without a named enforcer is prose, and
> prose is not governance") and [`scaffold-tiers.md`](scaffold-tiers.md) (single-canonical-home).

A contract card is a SKILL.md whose every line is one of four elements. Anything else is judgment
prose and belongs in `skills/<name>/references/` behind a pointer.

## The four elements — what qualifies

| Element | Qualifies | Does NOT qualify |
|---|---|---|
| **Trigger** | The frontmatter `description:` ONLY. Routing is description-driven — the body loads at invocation, never before | Body text claiming to be a trigger; "use when" prose repeated in the body |
| **Inputs** | Auto-injected config blocks (the `` !`cat` `` preprocessor lines) and named artifacts the skill reads (plan doc, README, `session-start-sha`) — each names its file path AND its absence behavior | Vague "check the project context"; an input with no stated absence behavior |
| **Decision tables** | Every branch as a table row whose condition column is a mechanically testable predicate | A branch whose condition cannot be stated as a testable predicate — that is judgment prose → references/ |
| **Engine pointers** | Verbatim script command lines; TaskCreate forcing-function blocks (verbatim — they ARE the enforcement); Skill-tool handoffs (→ finish-flow, → quality-pipeline) | Paraphrases of a script's behavior; a second statement of another skill's contract |

## Judgment-prose extraction rule

Historical rationale, "why this gate exists", worked examples, PASS/FAIL illustrations, and
multi-paragraph warnings move to `skills/<name>/references/` with a one-line pointer left at the
original heading. A heading another file references **by name** keeps its heading in the card
(the enforcer table below says which those are).

## Named enforcer or documented-only

Every MUST/MANDATORY row in a card names its enforcer:

| Enforcer class | Example |
|---|---|
| TaskCreate + system-reminder + blockedBy | L-1.6, L-5, S-scope-gate |
| Deterministic script/hook | `mission-routing-admission.js`, quality gates |
| Textual invariant check | `check-canonical-invariants.sh` repeat/reference rows |
| `documented-only` tag | Everything else — and prose is not governance |

## Measurable per-skill definition (the 童子軍規則 target)

1. **Line budget**: SKILL.md ≤ 500 lines for orchestrator-class skills (dev-flow, ceo-agent),
   ≤ 250 for all others. Per-skill line counts are recorded in
   `docs/metrics/surface-lines.json` (`skills{}` map) at each
   `preflight-release.sh --update-baseline`.
2. **Ratchet**: a skill's SKILL.md may not grow past its recorded baseline without a
   `prose-justification:` line in the current version's CHANGELOG section — same soft-hard shape
   as the aggregate north-star gate. Enforcer: `preflight-release.sh` check 8 (per-skill block).
3. **Contract density** (advisory): structural lines (table rows, checklist items, fenced blocks,
   headings) / body lines ≥ 0.55. `documented-only` until a scripted counter lands
   (BACKLOG row "contract-density counter").

## What a card may never lose

- Frontmatter untouched (a `description:` change is a routing change — separate decision class).
- All `` !`cat` `` injection lines byte-identical (they are the input mechanism).
- TaskCreate forcing-function blocks verbatim.
- Headings pinned by `check-canonical-invariants.sh` or referenced by name from other skills.
- Profiles rule-universe accounting: any body edit regenerates `profiles/rule-inventory.json` /
  `rule-migration.json` and re-runs `build-profile-payload.js catalog --check`; baseline-covered
  lines need a `relocated`/`removed`/`rewritten` disposition (see the dev-flow-contract-card plan
  §7 for the ontology).

## Review checklist (walk this when reviewing a rewrite against the spec)

- [ ] `description:` byte-identical — `git diff` shows no frontmatter change.
- [ ] `` !`cat` `` line count unchanged — `grep -c '!\`cat' skills/<name>/SKILL.md`.
- [ ] Pinned literals survive — `bash scripts/check-canonical-invariants.sh`.
- [ ] Profiles accounting closes — `node scripts/build-profile-payload.js catalog --check`.
- [ ] Every MUST/MANDATORY row names its enforcer class or carries `documented-only`.
- [ ] **Every asserted mechanism names its executable path.** A card may not say "the lint" / "the
      scanner" / "the gate" — it says `scripts/<name>.<ext>`. An unnamed mechanism is
      undereferenceable by construction, so no gate can ever check whether it exists; naming it is
      what lets `doc-drift-gate.js`'s `script-refs` check dereference it. Prose and mechanism ship in
      the same commit. See [`evidence-discipline.md`](evidence-discipline.md) §14 and
      [`knowledge-routing.md`](knowledge-routing.md) §6.
- [ ] Relocated prose is reachable — each pointer target exists (`bash scripts/validate.sh`).
- [ ] Line budget respected — `preflight-release.sh` check 8 per-skill block passes.
- [ ] Evidence gate (成績單前置): the rewrite cites its eval ON/OFF evidence; an unevidenced
      rewrite is an unevidenced trust claim and does not merge.
