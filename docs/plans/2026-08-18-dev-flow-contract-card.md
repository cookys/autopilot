# dev-flow contract-card rewrite — evidence-gated (成績單前置)

> Status: Draft (pre-review)
> Consumes BACKLOG row: "Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）" (docs/BACKLOG.md:51)
> North-star sequence step 3 (ADR-0001): roster qualification → eval ON/OFF 證據 → contract-card 改寫.
> Trigger audit (2026-08-18): conjunct 1 (四層 Policy 層定案) SATISFIED — shipped v2.34.11, ADR-0001 accepted.
> Conjunct 2 (目標 skill 的 eval ON/OFF 證據) NOT satisfied — no instrument measures a depth-0 skill
> present-vs-absent today; producing that evidence is this project's first half.

## 1. Goal & claim

Rewrite `skills/dev-flow/SKILL.md` (713 lines) to contract-card shape (trigger / inputs /
decision-table / engine-pointers; judgment prose → references/), shipping the rewrite **only if**
a pre-registered 3-arm experiment demonstrates the card is non-inferior to the full prose for a
depth-0 orchestrator. The evidence instrument, the contract-card spec doc, and the profiles
baseline re-establishment ship regardless of the card verdict; the card body swap is conditional.

**Claim scoping (honest boundary)**: the experiment measures single-turn, sonnet-class depth-0
behavior on 7 micro-tasks over the marker families below. Multi-turn scope-creep escalation and
Mission Routing Override are NOT measured — those sections are preserved under a static
KEEP-verbatim checklist instead (§6 disposition). Opus-class behavior is an acknowledged
extrapolation; a haiku advisory block bounds the weak end. Prior `evals/skill-transport/` H1
(dev-flow prose as dispatched-leaf pack, D=0) answered the leaf channel; this instrument answers
the so-far-unmeasured **routing + loading at depth 0** channel.

## 2. Settled decisions (user, 2026-08-18 — 不重議)

1. **證據閘控出貨**: single project; card draft is instrument input first, shipped only on
   SHIP-GATE-MET verdict.
2. **Target: dev-flow only**. quality-pipeline is a follow-up after the instrument is validated.
3. **Budget: 60–90 live runs** (each ≈ one `claude -p` call). Pre-registered spend: 63 primary
   (sonnet) + 21 advisory (haiku) + ≤6 smoke; worst case +21 card-iteration re-run.
4. **Frontmatter `description:` frozen byte-identical** — routing surface constant; a description
   change is a separate MAJOR-class decision, explicitly avoided.

## 3. Construct — `evals/skill-onoff/` (new sibling harness)

New harness; `evals/orchestration/run-orchestration-eval.sh` is untouched (its 3 green tests stay
green by not being modified; its arm vocabulary is hardwired `on|off` and its ON arm carries a
known required-artifacts confound at :123-155 — de-confounding in place would retroactively
poison committed 2026-07 campaign evidence). Reused from it: task dir format, frozen-base-SHA
temp-repo init, scratch-HOME + `.credentials.json`-only seeding (never point CLAUDE_CONFIG_DIR at
the real `~/.claude`), `failure_class` closed vocabulary, stub-runner env pattern for spend-free
tests. Resume-by-cell + recorded-seed matrix driver copied from `evals/skill-transport/run-matrix.sh`.

### Arms — real plugin load (verified: `claude --help` advertises repeatable `--plugin-dir`;
`evals/test-helpers.sh:15` already uses it headless)

Per run, the harness assembles a synthetic plugin in scratch space:

| Arm | `skills/dev-flow/SKILL.md` in synthetic plugin |
|-----|---|
| FULL | frozen byte-copy of current 713-line file (digest-pinned in `packs/manifest.json`) |
| CARD | frozen draft card (digest-pinned; frontmatter byte-identical to FULL — test-asserted) |
| OFF  | directory absent |

Companion roster (`finish-flow`, `quality-pipeline`, `learn` SKILL.md byte-copies) is IDENTICAL
across all three arms — the only variable is dev-flow presence/content. OFF = "dev-flow absent",
not "plugin absent" (controls for catalog existence; gives quality-pipeline equal self-routing
base rate). No hooks in the synthetic plugin. Runner: non-bare `claude -p` (`--bare` breaks OAuth
credential seeding), scratch HOME, `--plugin-dir`, `--output-format stream-json --verbose`,
`--setting-sources project --strict-mcp-config --dangerously-skip-permissions`.

**Pre-registered fallback**: if Phase-0 smoke shows `--plugin-dir` skills not surfacing in `-p`
mode, downgrade to prompt-injection arms AND narrow the recorded claim to "prose-in-context
non-inferiority" with the routing/loading channel explicitly recorded as unmeasured.

### Task set (d1–d7, single-turn, prompts byte-identical across arms, zero artifacts contract)

Marker channels (all deterministic, no LLM judging): (1) git/FS residue in temp repo; (2) task-store
residue `$SCRATCH_HOME/.claude/tasks/<session>/<n>.json` copied out before cleanup (TaskCreate JSON
incl. `blockedBy` — Phase-0 re-probes the path on current CLI); (3) stream-json tool_use events
(Skill invocations, Bash-before-Edit ordering).

| Task | Exercise | Key markers (family) |
|---|---|---|
| d1-s-tiny-feature | S path | task title `^S-scope-gate:` (F2); NO `docs/projects/` (F1); Skill(quality-pipeline) before commit (F6) |
| d2-l-multimodule | L gates | `.claude/session-start-sha` == frozen base SHA + plan file + project README (F1); `L-1.5:`/`L-1.6:`/`L-5:` tasks + phase task `blockedBy`→L-1.6 (F2) |
| d3-fix-known-bug | Fix path | `fix/*` branch merged to develop (F3); ongoing-maintenance ledger row regex (F4); test-run event before first Edit (F5) |
| d4-hotfix | H path | compound: `^hotfix/` branch AND from main AND `--no-ff` merge to main (F3); `^H-9:` task (F2) |
| d5-verify-contract | 驗證合約 | red run before first Edit, green run after last (F5) |
| d6-quality-gate | quality-gate rule | Skill(quality-pipeline) before first `git commit` (F6) |
| d7-fix-vs-l-boundary | anti-pattern cell (multi-module bug stays Fix) | `fix/*` branch (F3); absence of project dir AND of L-1.x tasks (F1, divergence pair with d2) |
| all | manipulation check | Skill tool_use naming dev-flow (M; FULL/CARD only) |

Prompt-hygiene grep gate (test-enforced): no task.md contains marker vocabulary (`S-scope-gate`,
`L-1.5`, `L-1.6`, `L-5`, `H-9`, `ongoing-maintenance`, `session-start-sha`, `dev-flow`,
`quality-pipeline`, `finish-flow`, `blockedBy`).

### Run matrix

- **Primary (gating)**: sonnet, 7 tasks × 3 arms × 3 reps = **63 runs**. All rules evaluate here.
- **Advisory (non-gating)**: haiku, 7 × 3 × 1 = **21 runs** — weak-orchestrator robustness signal.
- Phase-0 smoke ≤6 live runs, reused as matrix cells via resume-by-cell.
- Model rationale: production depth-0 is strong-model; historical sonnet ceiling was on *outcome*
  oracles, but *compliance-residue* markers discriminated 80% vs 0% on sonnet (2026-07-04 campaign,
  `patterns_named`). Claim ships scoped to sonnet-class depth-0.

## 4. Pre-registered decision rules (FROZEN before first live run; mid-campaign edits = restart block)

```
Marker families: F1 sizing/workflow-selection (d1,d2,d7) · F2 forcing-function
TaskCreates (d1,d2,d4) · F3 branch discipline (d3,d4,d7) · F4 maintenance ledger (d3)
· F5 verification contract (d3,d5) · F6 quality gate (d1,d3,d6).
Per family per arm: n = tasks×3 reps (F1/F2/F3/F6: n=9; F5: n=6; F4: n=3);
a run scores 1 for a family iff ALL that family's markers for that task are true.

Exclusions: rows with failure_class=infra_fail (timeout/auth/5xx/empty) are excluded
and their cells re-run (max 3 attempts, then recorded missing). If >10% of any arm's
cells end infra_fail, the campaign block is invalid — fix infra, re-run block.

V1 Manipulation check: skill_invoked_devflow ≥ 14/21 runs in FULL AND in CARD.
   Failure ⇒ INSTRUMENT-INVALID (routing failure, no content judgment recorded).
V2 Sensitivity gate (negative-control discipline): family f is LOAD-BEARING iff
   FULL_f − OFF_f ≥ 3 counts (n=9), ≥ 2 (n=6), ≥ 2 (n=3).
   Instrument VALID iff ≥ 4 of 6 families are load-bearing. Otherwise
   INSTRUMENT-INVALID (vacuous: FULL ≈ OFF; per references/evidence-discipline.md
   "The one question"), regardless of how CARD looks.
V3 Non-inferiority (evaluated only if V1∧V2): on EVERY load-bearing family,
   CARD_f ≥ FULL_f − m_f where m_f = 2 for n=9, 1 for n≤6;
   AND CARD_f − OFF_f ≥ ceil((FULL_f − OFF_f)/2)  (card must beat absence, not
   merely tie a weak FULL).
Verdict map:
   V1∨V2 fail             → INSTRUMENT-INVALID: repair tasks/harness; no card verdict.
   V3 pass on all         → SHIP-GATE-MET: P7 may swap skills/dev-flow/SKILL.md to the
                             frozen card fixture (byte-frozen; any edit = re-run CARD arm).
   V3 fail on ≤2 families → ITERATE-CARD: one revision permitted; re-run CARD arm only
                             (21 runs) against the SAME frozen FULL/OFF rows, same model,
                             same claude CLI version (version drift ⇒ full re-run).
                             Second failure ⇒ ABORT.
   V3 fail on >2 families → ABORT-RECORD: keep FULL; BACKLOG entry "card refuted at
                             <sha>, do not re-litigate without a new card + new runs".
All counting is mechanical in score-onoff.js from the results JSONL; the final ship
decision remains a Board read of the printed table. Frozen at P3-freeze: task set,
markers.sh set, fixtures manifest digests, seeds, this rules text.
```

## 5. Card spec doc — `references/skill-contract-card.md` (new, ~120 lines)

Canonical operational definition of CLAUDE.md:73's one-liner. Style precedent:
`references/four-layer-design.md` ("a rule without a named enforcer is prose, and prose is not
governance") + `references/scaffold-tiers.md` (single-canonical-home). Sections:

1. **The four elements — what qualifies**: Trigger = frontmatter `description:` ONLY (routing is
   description-driven; body loads at invocation). Inputs = auto-injected config blocks
   (`` !`cat` `` preprocessor lines) + named artifacts with absence behavior. Decision tables =
   every branch as a table row with a mechanically-testable condition; a branch that can't state
   its predicate is judgment prose → references/. Engine pointers = verbatim script command lines,
   TaskCreate forcing-function blocks (they ARE the enforcement), Skill-tool handoffs.
2. **Judgment-prose extraction rule**: historical rationale / worked examples / PASS-FAIL
   illustrations / multi-paragraph warnings → `skills/<name>/references/` with one-line pointer;
   headings referenced by name elsewhere keep their heading.
3. **Named enforcer or documented-only** (adapted from four-layer-design.md): every
   MUST/MANDATORY row names its enforcer class (TaskCreate+blockedBy / deterministic script /
   textual invariant check / `documented-only` tag).
4. **Measurable per-skill definition** (童子軍規則 target): SKILL.md line budget ≤500 for
   orchestrator-class, ≤250 others; per-skill counts recorded in
   `docs/metrics/surface-lines.json` `skills{}` map at each `--update-baseline`; ratchet = a
   skill may not grow past its recorded baseline without CHANGELOG justification (soft-hard,
   same shape as check 8). Contract density ≥0.55 is advisory/`documented-only` until a scripted
   counter lands (BACKLOG row).
5. **What a card may never lose**: frontmatter; `` !`cat` `` injection lines byte-identical;
   TaskCreate blocks verbatim; headings pinned by `check-canonical-invariants.sh` or referenced
   by-name from other skills; profiles rule-universe accounting.
6. **Review checklist** — checkbox rows each naming its verification command.

Enforcer for rule 4: extend `preflight-release.sh` check 8 with the per-skill map (no new script
basename — avoids new inventory wiring).

## 6. Card draft methodology (P2) — dev-flow disposition summary

Full line-by-line disposition table lives in
`docs/plans/evidence/2026-08-18-dev-flow-contract-card/disposition.md` (authored at P2).
Summary of the audit already performed:

- **KEEP verbatim (pinned)**: frontmatter (1-10); the four `` !`cat` `` injection lines (15, 18,
  23, 600-601); S-scope-gate TaskCreate block 220-233 (pinned by `check-canonical-invariants.sh`
  repeat-invariant AND `profiles/rule-inventory.json` owner `shared.s-scope-gate`); rule-inventory
  owner lines 23 / 490 / 204-206; L-1.6/L-5/H-9 TaskCreate blocks; L-1.5 heading
  `#### Scope Completeness Audit (MANDATORY before phase TaskCreate)` (referenced by name from
  ceo-agent, checked by invariant #2); 驗證合約 section 165-187 (shipped via four-layer §A with
  5-family review); Mission Routing Override + Available Scripts (676-713).
- **KEEP compressed**: Phase-1 session-start prose, scope-creep indicators → table, L-1 intent,
  L-4 per-phase, anti-patterns table (trim only rows duplicating TaskCreate text).
- **MOVE → `skills/dev-flow/references/session-end.md`** (~85 lines new): L-Full Reference
  checklist 525-575 (keep heading — finish-flow names it), Context Health Check 577-592.
- **MOVE → historical-rationale.md**: L-5 "Why delegated" 466-470, L-1 PASS/FAIL example table.
- **CUT (dedup)**: S Session End 249-263 (near-duplicate of S-Lite 518-523) — requires P4.

**Estimated card: ~440–470 lines** (~35% body reduction). North-star check 8 counts skills AND
references, so relocation is ~net-zero repo-wide (net delta ≈ +30..+60 incl. spec doc, far under
the +5% allowance vs baseline 13800); the real win is per-invocation context, which the per-skill
map (§5 rule 4) makes visible. The draft must be a good-faith best card, not a straw man — the
experiment tests the classification.

## 7. Profiles guided-compatibility baseline re-establishment (P4) — Board-visible

**The dominant constraint** (verified 2026-08-18): `scripts/build-profile-payload.js`
`validateSourceOwnership` pins dev-flow SKILL.md by sha256 + per-segment line ranges
(`profiles/rule-inventory.json`), and `validateGuidedCompatibility` requires the current
dev-flow+ceo-agent rule multiset to be a **superset of the immutable P0 baseline**
(`profiles/p0-sources/08d0aecd….txt`, 661 lines, all still present in today's file — every change
since 2026-07-26 was purely additive). Deleting or rewording ANY of those lines ⇒
`PROFILE_GUIDED_COMPATIBILITY_DRIFT`. Three test literals pin `"canonical_rules": 798`
(`codex-plugin-package.test.sh:245,254`, `profile-context-isolation.test.sh:276`).

**Approach (Board decision at plan approval)**: establish a successor baseline whose source
universe extends to `{ceo-agent SKILL.md, dev-flow SKILL.md, skills/dev-flow/references/*.md}` so
the superset check proves rules were **relocated, not lost** (faithful to
`profiles/guided-compatibility.json` intent). Truly deleted duplicates get explicit `removed`
dispositions in the migration map (the `obsolete` category already models this). Old snapshot
retained for audit. The `798` literals + baseline pointer update in the same commit, with a
red-case test: deleting a rule present in the NEW baseline must still fail. ADR-0001-compatible:
this is verification of rule retention, not trust machinery. P4 merges before P7 can.

## 8. Phase DAG

```
P0  Prologue repairs (no-bump, docs-only commit)
    - add the tier-A/B BACKLOG row promised by four-layer D6 (plan :269) — absent today; repair+note
    - annotate the contract-card BACKLOG row as claimed by this plan
P1  Card spec doc references/skill-contract-card.md + check-8 per-skill map (PATCH-carrying commit)
P2  Card draft (branch-only fixture, NOT merged) per §6; frozen into packs/ with digest
P3  Instrument: evals/skill-onoff/ harness + tasks + 3 hooks/tests (stub-runner, planted-red)
    → rules freeze (§4) → Phase-0 live smoke ≤6 runs (plugin load / dev-flow invocation /
    tasks-dir capture proven)                                   [P2∥P3 until CARD fixture needed]
P4  Profiles baseline re-establishment (§7)                      [∥ P3; Board gate at approval]
P5  Primary block 63 runs (resume-by-cell) + advisory haiku 21
P6  Adjudication: score-onoff.js verdict + Board read; evidence dir report
P7  Conditional ship: single swap commit (SKILL.md + regenerated profiles artifacts + codex
    mirror resync) — clean `git revert` granularity. On non-SHIP verdict: ship P0/P1/P3/P4 only,
    record verdict, BACKLOG the draft with evidence pointer
P8  Closeout: finish-flow L-5; preflight-release + --update-baseline; INDEX/archive
```

## 9. Ship surfaces (L-1.5 audit output; verification command per surface)

| # | Surface | Verify |
|---|---|---|
| 1 | `skills/dev-flow/SKILL.md` card body; frontmatter frozen; 4 `` !`cat` `` lines intact | `bash scripts/validate.sh`; `grep -c '!\`cat' skills/dev-flow/SKILL.md` = 4; diff shows no frontmatter change |
| 2 | Pinned literals shared with ceo-agent | `bash scripts/check-canonical-invariants.sh` |
| 3 | `skills/dev-flow/references/` new/grown files | `scripts/validate.sh`; never hand-edit generated `model-routing.md` mirror |
| 4 | Profiles: rule-inventory + rule-migration + catalog + baseline + 798 literals ×3 | `node scripts/build-profile-payload.js catalog --check`; `hooks/tests/profile-context-isolation.test.sh`; red-case per §7 |
| 5 | Codex mirror (dev-flow is a projected skill; references auto-mirror via compareTree) | `bash scripts/sync-codex-plugin-skills.sh && … --check`; `hooks/tests/codex-plugin-package.test.sh` |
| 6 | OpenCode / agent-bodies: no impact (verified copy scopes) | `bash scripts/sync-all.sh --check` |
| 7 | New eval files under `evals/skill-onoff/` — not codex-mirrored (mirror consumes only clean/known-bad + named SUPPORT_FILES); discoverability via evals row | extend `docs/scripts-inventory.md` evals row + `evals/README.md` section |
| 8 | README badges (28 skills unchanged); no doc pins dev-flow line counts (grep "713" clean) | `node scripts/sync-version.js --check`; `node scripts/doc-drift-gate.js` |
| 9 | CHANGELOG + version: **PATCH** (no new skill/agent; body rewrite + refs + scripts are PATCH classes; description change would be MAJOR — avoided) | `bash scripts/preflight-release.sh` 8/8 |
| 10 | Plan/project/INDEX/evidence dirs | preflight INDEX check |
| 11 | BACKLOG: consume contract-card row; add tier-A/B row (P0); add post-ship observation row (2-release watch via ongoing-maintenance + retro; TaskCreate-compliance telemetry is `documented-only` — honest gap) | manual diff |

Instrument regression tests (all spend-free via `ONOFF_STUB_BIN`):
`hooks/tests/skill-onoff-eval.test.sh` (arm assembly digests; roster parity across arms; prompt
byte-identity; task-store capture; infra_fail classification),
`skill-onoff-markers.test.sh` (per-task three-way probe: no-op ⇒ false / planted-compliant ⇒ true
/ planted-cheat ⇒ false),
`skill-onoff-score.test.sh` (vacuous FULL==OFF fixture can NEVER reach SHIP-GATE-MET; margin and
manipulation-check fixtures; mixed-model rejection; digest + description-byte-equality;
task-prompt leakage grep).

## 10. Risks

| Risk | Mitigation |
|---|---|
| Profiles rule-ratchet breakage (dominant) | P4 first-class phase, Board gate, red-case test, old baseline retained; P7 blocked on P4 |
| Plugin skills not surfacing headless | Phase-0 smoke ≤6 runs before any spend; pre-registered downgrade narrows the claim, never silently |
| Marker gaming by generic competence | OFF arm + V2 sensitivity gate exist precisely for this |
| Scorer passes when gate deleted (known family) | planted-red fixtures in skill-onoff-score.test.sh; vacuous fixture asserted un-shippable |
| 529 windows mid-campaign | resume-by-cell, infra_fail excluded+re-run (max 3), >10% arm infra_fail invalidates block |
| CLI auto-update mid-block | runner_version recorded per row; version change invalidates block |
| Routing regression from body trim | description frozen; `evals/run-trigger-test.sh` as cheap negative control post-swap |
| Non-inferior in-lab, degrades in production | per-skill baseline ratchet; post-ship observation BACKLOG row; limits stated honestly in claim scoping |
| Rollback | P7 single swap commit; revert ritual = same-commit profiles regen + mirror resync |
| Plan-review churn | evidence → evidence dir; growth hard-stop 1.45×; rubric IDs `- R1: [label]`; G2 disposition generation=1; clear `~/.autopilot/plan-review/<hash>/` before re-panel |

## 11. Acceptance criteria (quantified)

1. Instrument: 3 new hooks/tests green; planted-red demonstrations recorded (delete-the-gate
   mutation turns skill-onoff-score.test.sh red) — evidence dir.
2. Phase-0 smoke: dev-flow Skill invocation observable in ≥1 FULL-arm transcript; tasks-dir
   residue captured or fallback channel pinned — before rules freeze.
3. Campaign: 63 primary rows with 0 unresolved infra_fail cells; verdict computed mechanically by
   score-onoff.js; committed results JSONL + report.
4. Card ship (conditional): V1∧V2∧V3 per §4; all §9 surface checks pass; preflight-release 8/8.
5. Regardless of verdict: spec doc merged; P4 merged with red-case proof; BACKLOG rows placed.

## 12. Out of scope

- quality-pipeline card (follow-up; reuses the validated instrument).
- Multi-turn / Mission-mode measurement (recorded instrument gap; static checklist covers).
- Contract-density scripted counter (BACKLOG; `documented-only` until then).
- Any `description:` change; any hook changes in the synthetic plugin.

## Review Loop History

- (pending) G1/G2 bounded hetero plan review per dispatch-plan-review contract.
