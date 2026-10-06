# Plan — dev-flow stage graph: one named graph, T-shirt sizes, a marker the band can read

> Status: R2 FROZEN (G2 terminal, depth-0 adjudicated) · Owner: cookys · Branch: Train A on develop, Train B on `release/3.0.0` (§4) · Frame: guidance + mechanism, authorized-breaking (3.0.0)
> Blocks the mods P1W TUI band (`2026-10-03-mods-visible-dispatch.md` R5.10/R5.11) and therefore the next release.

## 0. Context / thesis

The band's position and progress slots have no data source; the live band printed `● 進行中 autopilot · — · 5m · —` / `回合進行中（0 分）`. The owner ruled that a placeholder UI with no data is pointless. The stage inventory (`docs/plans/evidence/2026-10-06-dev-flow-stage-inventory/README.md`) found:
- dev-flow stages exist only in prose;
- "L" means three things and "phase" six;
- no skill or hook writes the current stage where a program can read it.

This plan replaces the stage prose with one named graph that a script owns. Writers record the graph position in the session marker, and the band is rebuilt on that data.

### Settled — do not reopen (owner rulings, 2026-10-06)

1. **Graph.** `intent → [research when needed] → proposal → plan → plan-review⟲ → per phase (implement → verify) → code-review⟲ → qc-gate → finish`. Bugs enter at `diagnose`. Exact sequences are in §2.7.
2. **Research before proposal.**
   - Unknown-ladder U0: the model proposes from its own knowledge, with no survey.
   - Otherwise it climbs the ladder, and the proposal comes after the research.
   - `proposal` is a web page of assumptions plus illustrated options that the user picks from.
3. **Two review layers.** Each phase is verified by a qualified verifier (engine scorecard verifier role). The hetero code review runs once after all phases, on the full diff. The same rule applies to bug and urgent work.
4. **Sizes.**
   - `XS S M L XL` decide only which nodes run.
   - A bug is an entry node, not a size.
   - Urgency is a suffix after the letter: `S!`, alias `S急`. A prefix `!` is eaten by Claude Code's bash mode.
5. **Levels.** `/l3–/l6` are hetero/delegation mode (who implements, who authors verification), orthogonal to size.
6. **Review strength.** It is a third axis: the number of model families on a review node, resolved by `scripts/resolve-review-loop.sh` from risk and roster. No node is named hetero, and a Claude-only `/l3` user runs the same graph.
7. **No compatibility shims.** Old names are migrated, not aliased, and the marker `phase` field is removed. Rollback means pinning the previous tag.
8. **Releases.** Pre-releases are `3.0.0-alpha.N`, tested by the owner as the heaviest user. 2.37.0 is never cut, and mods P1W folds into 3.0.0.
9. **Proposal-page answers** (https://claude.ai/artifact/WhaLzUsfwmMdDut9ndVB7X v2): `A2 B1 C2 D2 E1 F2 G1`.
   - A2: hard rename.
   - B1: JSON + CLI.
   - C2: `stage-advance.js` validates.
   - D2: structured marker.
   - E1: size at entry plus a diff-threshold bump.
   - F2: new ladder rungs here.
   - G1: low-risk review = one family, fresh context, as the default.

## 1. Problem

The owner wants to glance at the band or review page and know four things:
- which step a session is in;
- how far along it is;
- whether it needs them;
- how strongly it is being checked.

None of this is recorded mechanically outside `/l5–/l6` campaigns. Claude-only colleagues cannot tell what dev-flow expects of them, because review strength is tangled into stage names.

## 2. OKR / KRs

- **KR1 — real-machine gate.** The gate re-run passes per field (`references/evidence-discipline.md` §54) in every mode: dev-flow, `/l3`, ceo, `/l4`, `/l5`, `/l6`.
  - The band shows `size·level ▸ stage [unit k/N] [·n族]`.
  - Each slot is derived from a marker field (§2.9), with no dash placeholder.
  - Each check has a colored screenshot (same file, §55).
- **KR2 — rail tests.** Every rail row in §2.7 has a deterministic test that runs the rail against a temp marker and asserts `stage`, `stage_set_at` and, where applicable, `review_families`.
- **KR3 — eval.** The P0-registered eval meets its frozen ship rule, and `check-guidance-eval.js` passes at every cut.
- **KR4 — vocabulary.** `node scripts/check-stage-vocab.js` reports zero hits in shipped non-history files. It checks for:
  - old stage ids;
  - the old size enum `Fix`/`H` in effort fields and descriptions;
  - the marker `phase` field;
  - owner-rung `U4`.
- **KR5 — backlog.** `docs/BACKLOG.md` passes `check-backlog-entries.js` after migration.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Sizes are exactly `XS`, `S`, `M`, `L`, `XL`. Urgency is the suffix `!` (alias `急`) written after the size letter, never before it; scripts and the marker carry it as `urgent: true`.
- Graph node ids are exactly: `intent`, `diagnose`, `research`, `proposal`, `plan`, `plan-review`, `implement`, `verify`, `code-review`, `qc-gate`, `finish`. No node id contains `hetero`.
- `/l3`–`/l6` keep their current meaning. Size never encodes level and level never encodes size.
- Review strength = the distinct model families on a review node, resolved by `scripts/resolve-review-loop.sh`; never silently lowered (a shortfall goes through `on_engine_unavailable`); the marker records the family ids actually used.
- `references/stage-graph.json` is the graph's single canonical definition; prose cites `scripts/stage-graph.js` output and never re-lists node sequences.
- New scripts are Node ≥ 20.10, built-ins only; one JSON object on stdout, diagnostics on stderr, exit codes in the header.
- Mechanism commits never edit files in the guidance manifest (§2.8); guidance ships only on a cut where `check-guidance-eval.js` passes.
- No trust machinery (ADR-0001): the marker is telemetry; gates re-derive, never trust a stage claim.

## 2.6 Change-policy decisions

- **Compatibility impact: `authorized-breaking`** (owner A2, 2026-10-06). The target is 3.0.0, via `3.0.0-alpha.N`.
  - **Consumers affected:**
    - backlog `**Effort**:` rows (`check-backlog-entries.js:31`, `next-pick.js:167`);
    - consumer `.claude/dev-flow-config.md`, generated by `scaffold-config.js` (no update mode), and `finish-flow-config.md`, copied by hand; both may carry old ids;
    - skill routing via the `description:` of dev-flow, finish-flow and team;
    - ladder rung ids (owner rung U4 → U5);
    - marker readers of `phase`.
  - **Migration:**
    - `migrate-backlog-entries.js` maps `Fix→S`, `H→S!`, and leaves `S/M/L` unchanged;
    - `check-stage-vocab.js --repo <consumer>` lists every stale line in `.claude/*.md` and the backlog files, with its replacement;
    - the CHANGELOG 3.0.0 migration section names both tools and the hand step for configs.
  - **Rollback:** pin the last 2.x tag. Old markers are per-session telemetry with a TTL, so a 2.x reader after a 3.x session only sees no phase.
  - **Contract validation:** graph and marker schemas, through `check-contract-schema.js`.
- **Dependency decision: `platform/stdlib`.**

## 2.7 The graph (frozen rules; P0 enumerates every cell into the fixture P1 must reproduce)

**Base sequences (feature entry):**
- `XS`: implement → qc-gate → finish
- `S`: implement → verify → qc-gate → finish
- `M`: plan → implement → verify → code-review → qc-gate → finish
- `L`: intent → [research] → proposal → plan → plan-review → (implement → verify)×N → code-review → qc-gate → finish
- `XL`: as L, but units are deliverables: (implement → verify)×N with `unit.kind` = `deliverable`, then **one** full-diff code-review after all units (settled item 3). In an l5/l6 campaign, the engine's per-deliverable review is that unit's `verify`.

**Variant rules:**
- **`--bug`:** `diagnose` replaces the leading node.
  - XS, S: `diagnose → implement…`
  - M: `diagnose → plan…`
  - L, XL: `diagnose → [research] → proposal…`
- **research (L and XL only):** both `intent|diagnose → research → proposal` and `intent|diagnose → proposal` are legal. Taking the edge is the ladder's call.
- **units:** N ≥ 1. `verify → implement` either repeats the unit (repair) or starts the next unit (§2.9 unit rules).
- **`--urgent` without high risk:** `… verify → qc-gate → finish → code-review`. The post-finish code-review is terminal, with no edge back to implement; each finding opens a new `S` task.
- **`--urgent` with high risk:** the normal order. XS and S have no code-review, so for them urgency is a mark only.
- **High risk:** `resolve-review-loop.sh` returns `review_risk: high` on the `risk_flags` of `classify-diff-risk.sh --range <base_ref>..HEAD`. The result is stored as marker `high_risk` (§2.9).

**Fixture.** `expected.json` holds one cell for every combination of size × bug × urgency {normal, urgent-low, urgent-high} × research {yes, no} (L and XL only) × units {1, 3}. Each cell carries its `nodes` set and its full walk.

**Loop-backs:**
- plan-review → plan
- verify → implement
- qc-gate → implement
- code-review → implement, except on the urgent-low path

The terminal node is finish, or the post-finish code-review on the urgent-low path.

**Size bump (E1).**
- Stage-advance into `verify` or `qc-gate` computes `git diff --numstat <base_ref>..HEAD` across all paths and compares it to the limits (files / added+deleted lines):

  | Size | Files | Lines |
  |---|---|---|
  | XS | ≤2 | ≤20 |
  | S | ≤6 | ≤200 |
  | M | ≤20 | ≤800 |
  | L, XL | no limit | no limit |

- A diff equal to a limit fits. Over a limit, the call exits 4 with `bump_to`.
- The caller then runs `session-mode.js set --size <bump_to>` (upward only) and advances to `stage-graph.js next --from <current stage>` under the new size. It never retries the original `--to`.
- Earlier nodes are not retroactively required. Downstream review nodes of the new size always remain, because `next` is computed from the current stage.

**Writers** (rail, or `prose` + the skill that calls `stage-advance.js`):

| Node | Writer |
|---|---|
| intent, proposal, plan | prose (dev-flow) |
| diagnose | prose (debug) |
| research | prose (the caller acting on the `probe-unknown.js` recommendation) |
| plan-review | rail: `dispatch-plan-review.js` `main()` |
| implement | rail at l5/l6: `bin/autopilot.js engine implement-review` (with unit); prose at l3/l4 (dev-flow, foreman) |
| verify | prose (dev-flow; at l6, the verification-author dispatch; in a campaign, the engine's per-deliverable review) |
| code-review | rail: `hetero-review-loop.js` `main()` |
| qc-gate | prose (quality-pipeline) |
| finish | prose (finish-flow) |

## 2.8 Guidance manifest (what the eval must cover)

- **Manifest paths:** `skills/*/SKILL.md`, `skills/*/references/**`, `references/*.md`, `agents/*.md`, `project-config-template/*.md`.
- **Change pack:** the P0 prereg lists exactly which of these files P4b and P5 change, and the P0 change pack is built from exactly those files.
- **Cut gate:** `check-guidance-eval.js` checks two things at each cut:
  1. Every manifest file that differs from the 2.x base is byte-equal to its copy in the evaluated pack (digests in `evals/skill-onoff/packs/manifest.json`).
  2. Re-running the scorer on the recorded results reproduces SHIP.

## 2.9 Marker schema (frozen; `schemas/session-marker.schema.json`, registered in `check-contract-schema.js`)

**Fields kept:** `level` (`l3|l4|l5|l6|null`) and the identity fields. **Fields removed:** `phase`, `phase_set_at`.

**Fields set by init:**

| Field | Type |
|---|---|
| `size` | `XS\|S\|M\|L\|XL` |
| `urgent` | bool |
| `bug` | bool |
| `base_ref` | commit sha |

**Fields absent until their first write:**

| Field | Type |
|---|---|
| `stage` | node id |
| `stage_set_at` | ISO-8601 UTC, with ms |
| `unit` | `{kind: phase\|deliverable, index ≥1, total ≥1, label ≤64}` |
| `review_families` | array of family ids, written only from completed seat receipts; the band shows its length |
| `high_risk` | bool, sampled when `urgent` and leaving the last verify |

**Unit rules:**
- `kind` and `total` are fixed once set.
- `index` never regresses and never exceeds `total`.
- `verify → implement` keeps `index` (repair) or increments it.
- Leaving the unit loop requires `index = total`.

**Init:** `session-mode.js set --size <S> [--urgent] [--bug] [--base-ref <sha>]`, under one lock with an atomic rename.
- Creates the marker if absent (`level: null`), or merges into an existing one (`level` preserved).
- `--base-ref` defaults to `git merge-base HEAD <default branch>`.

**`stage-advance.js --to <node> [--unit kind:i/N:label] [--review-families a,b]`**
- `--to <current stage>` is a same-node update. Review rails use it at completion to record `review_families`.
- Exit codes:
  - 0: written
  - 2: no marker
  - 3: illegal transition or unit rule; prints `{allowed:false, from, to, legal_next}`. A first write must target the entry node for (size, bug).
  - 4: bump required; prints `{bump_to}`
  - 5: `size` missing

## 3. File-structure map

| File | Responsibility | Phase |
|---|---|---|
| `references/stage-graph.json`, `schemas/stage-graph.schema.json` (new) | §2.7 as data | P1 |
| `scripts/stage-graph.js` (new) | `nodes --size S [--bug] [--urgent] [--high-risk] [--research] [--units N]`, `next --from N --size S [same flags]`, `validate` | P1 |
| `hooks/tests/fixtures/stage-graph/expected.json` (new) | Frozen fixture, every §2.7 cell with walks | P0 |
| `scripts/session-mode.js`, marker schema | §2.9 fields and init flags (P2a); remove `--phase`/`phase`/`phase_set_at` (P2b) | P2 |
| `scripts/stage-advance.js` (new) | Transition legality, bump check, marker write | P2a |
| `src/status/phase-input.js`, `planned-input.js`, watcher, review page | Read §2.9 fields only | P2b |
| `scripts/dispatch-plan-review.js`, `scripts/hetero-review-loop.js`, `bin/autopilot.js` engine implement-review | Rail writers (§2.7) | P3 |
| `scripts/probe-unknown.js`, `scripts/decision-ledger.js` | U3 panel, U4 experiment, owner → U5 | P4 |
| `scripts/check-stage-vocab.js` (new) | KR4 gate; `--repo` consumer report; semantic U4 check. Report-only in P1, a gate from P5 | P1, P5 |
| `scripts/check-guidance-eval.js` (new) | §2.8 cut gate, called by `preflight-release.sh` | P0 (written), P8 (wired) |
| Guidance manifest files (§2.8) | Graph vocabulary; ladder text | P4b, P5 |
| `profiles/*`, `platforms/codex/plugin/*`, `evals/skill-onoff/packs/*` | Hash re-pin, mirror sync, pack freeze | P5 |
| `scripts/{check-backlog-entries,next-pick,migrate-backlog-entries}.js`, `docs/BACKLOG.md` | Effort = sizes + suffix; migration | P6 |
| `scripts/lib/semver.js` (new), `scripts/sync-version.js`, `scripts/preflight-release.sh`, `scripts/check-optin-changelog.js`, `hooks/session-start.js` | Pre-release support through one parser | P-R |
| `mods/live/{band.tsx,pane.tsx,model.ts}`, `docs/plans/evidence/2026-10-04-mods-p1c/gate/check.js` | V4a band + ⓘ panel; per-field gate | P7 |

## 4. Phases and landing trains

Phase sizes use the **pre-plan** vocabulary (S/L/H/Fix), because the new one does not exist until P5.

- **Train A** (additive): P-R, P0, P1, P2a, P4a. Each phase lands on develop independently and changes no existing behavior. develop's working tree is what this host loads via the directory marketplace.
- **Train B** (breaking): **one atomic landing unit**, built on `release/3.0.0` in a worktree. Its sub-steps P2b, P3, P4b, P5 and P6 are build order, not landings.
  - Train B merges to develop at the alpha.1 cut, which is the pre-release the owner opts into. It merges only with every invariant green, so no broken intermediate state reaches develop.
  - P7 follows as alpha.2.
- **Discovery wiring:** every phase that creates a `scripts/*.js` adds, in that same phase, the CLAUDE.md group-list entry and a `docs/scripts-inventory.md` row. These are index metadata, not guidance. SKILL.md "Available scripts" rows and reference docs land in P5.

### P-R — pre-release tooling (S; mechanism; Train A)

1. New `scripts/lib/semver.js` parses `X.Y.Z(-(alpha|beta|rc).N)?` and orders a pre-release below its release (semver §11).
2. Route these consumers through it:
   - `sync-version.js` `validateArgs` (:101, :162) and its badge replacers, including README.zh-TW; shields badges escape `-` as `--`;
   - `preflight-release.sh`: the `VERSION` grep and `## v$VERSION`;
   - `check-optin-changelog.js` `isValidSemver` / `compareSemver`;
   - `hooks/session-start.js` `parseSemver` / `headerRe`;
   - anything else a `grep -rnE '[0-9]+\.[0-9]+\.[0-9]+'` sweep of `scripts/ hooks/ src/ bin/` finds parsing versions.
3. Probe once with the real `claude plugin list` that a pre-release plugin.json loads, and record it in the evidence dir.

**Acceptance:**
- A shared fixture matrix passes for every consumer: ordering across alpha < beta < rc < final, equality, rejection of malformed versions, and badge escaping.
- A canonical `3.0.0-alpha.1` makes preflight demand `## v3.0.0-alpha.1`.
- The probe is recorded.
- `lib/semver.js` is wired into CLAUDE.md and the inventory.

### P0 — eval pre-registration (S; mechanism — eval infrastructure, no skill text; Train A; before P1)

1. Write `expected.json` from §2.7, covering every cell.
2. Freeze base packs from HEAD (`evals/skill-onoff/freeze-pack.js`) for every §2.8 file that P5 will change.
3. Write 12 briefs in `evals/skill-onoff/tasks/stage-graph-*`:
   - XS, S, M and L feature tasks;
   - an XL deliverable task;
   - XS and M bug tasks;
   - an `S!` task;
   - an `M!` task with a high-risk path;
   - one U0-known L task;
   - two research-needing L tasks, which use zero-hit terms so classify's S4 recommendation is deterministic.

   Each answer key holds size, bug, urgent, research, the expected walk (a cell of `expected.json`), a frozen `horizon` (the last checkpoint reachable in the cell budget), and the expected first rung.
4. Write the scorer `evals/skill-onoff/score-stage-graph.js`.
   - It extracts, in order, from Bash `tool_use` via `lib/transcript-query.js`:
     - `session-mode.js set --size … [--bug] [--urgent]`;
     - `stage-advance.js --to …`;
     - the first `probe-unknown.js` recommendation.
   - A rep passes when:
     - size, bug and urgent are exact;
     - the walk matches the expected walk exactly up to `horizon`, which for the high-risk brief includes code-review placement;
     - the first rung is exact.
   - A task passes when 2 of 3 reps pass.
5. Write the ship rule to `evals/skill-onoff/prereg/stage-graph.md` (reps 3, sonnet):
   - the change arm passes ≥ 10/12;
   - a planted-red arm passes ≤ 4/12. The red rotates the size table so only M keeps its sequence, which deterministically invalidates the 9 non-M briefs;
   - no `skill-onoff-generic` marker that base passes in ≥ 2/3 reps regresses.

   A failure is recorded and the next attempt is a new arm. There is no rerun-until-green.
6. Write `check-guidance-eval.js` (§2.8) and wire it into CLAUDE.md and the inventory. Re-key `lib/p1w-markers.sh` on `expected.json`.

**Acceptance:**
- The prereg is committed before any P5 text exists.
- The planted-red fixture fails in `hooks/tests/skill-onoff-*.test.sh`.
- `check-guidance-eval.js` fails on a fixture whose shipped file differs from its pack copy.

### P1 — graph data + CLI (L; mechanism; Train A; after P0)

1. Write `stage-graph.json` and its schema, wired into `check-contract-schema.js`.
2. Write `stage-graph.js`.
3. Write `check-stage-vocab.js`, report-only (exit 0).
4. Wire both scripts into CLAUDE.md and the inventory.

**Acceptance:** `hooks/tests/stage-graph.test.sh` iterates every cell of `expected.json` and requires exact `nodes` and walk stdout. Named cases:
- `nodes --size XS` gives `["implement","qc-gate","finish"]`.
- `next --from verify --size L` gives `["code-review","implement"]`.
- `next --from finish --size M --urgent` gives `["code-review"]`.
- `next --from code-review --size M --urgent` gives `[]`.
- `validate` exits 1 on a planted graph with an unreachable node.

### P2a — marker fields + stage-advance (L; mechanism; Train A)

1. Implement the §2.9 schema file, the init (create or merge), and `stage-advance.js`. `phase` is untouched in this phase.
2. Wire it into CLAUDE.md and the inventory.

**Acceptance:**
- Per size: init, then the full legal walk from `expected.json`.
- Init creates an absent marker and preserves `level` on an existing one.
- Exits:
  - illegal `plan → implement` on L → 3;
  - first write to `plan` on S → 3;
  - no marker → 2;
  - no `size` → 5.
- Units:
  - index regression → 3;
  - index above total → 3;
  - changing total → 3;
  - leaving the loop early → 3;
  - repair and advance are legal.
- `high_risk` is sampled for `M!` with and without a planted high-risk diff.
- Bump walks reach finish via exit 4 → `set --size` → `next` from current:
  - XS→S at qc-gate;
  - S→M at verify;
  - S→M at qc-gate;
  - M→L at verify;
  - M→L at qc-gate.
- A downward `set --size` is refused.

### P2b — remove `phase`, switch readers (S; mechanism; Train B)

1. Remove `--phase`, `phase` and `phase_set_at` from `session-mode.js`.
2. Move every reader (watcher, review page, band `model.ts` and their tests) to the §2.9 fields.

**Acceptance:** `check-stage-vocab.js` finds no `phase`-field reader or writer, and the status suites are green.

### P3 — rail writers (L; mechanism; Train B)

1. The three §2.7 rails call `stage-advance.js` on entry, passing `--unit` where the engine knows it.
2. Review rails make a same-node update with `--review-families` at completion, and only from seats whose receipts completed. Planned families are written nowhere.
3. A failed or refused write is fail-open: the rail continues and prints exactly one stderr line `stage-advance: <exit> <reason>`.

**Acceptance:**
- KR2: each rail runs with a stub engine against a temp marker and asserts `stage`, `review_families` and `unit`.
- An unavailable-engine run records only the completed families.
- A forced exit 3 produces the one-line diagnostic, and the rail exits 0.

### P4 — ladder: U3 panel, U4 experiment, U5 owner (L; P4a and P4b are both mechanism; ladder text is in P5)

**P4a (Train A)** is additive, behind `unknown_ladder_v3` (default off). P4b deletes the knob.
- **Budgets**, using probe-unknown's per-work-unit unit: U1 2, U2 1, U3 1, U4 1.
- **U3 panel.**
  - Eligible iff `unknown_type ∈ {why, whether}` and at least one of S1, S2, S3, S5 is present. A `how` unknown is capped at U2.
  - Rail: `dispatch-discuss.js` when the discuss seat is qualified. Otherwise think-tank (`whether`) or debugger PUA (`why`), recorded with `heterogeneous:false, reason:not-heterogeneous`.
  - Receipt: the existing ladder row plus `rail` and `families[]`.
- **U4 experiment.**
  - Eligible iff a U2 receipt exists for the work unit and S4 or S1 is still present.
  - It is a spike in a throwaway worktree.
  - Receipt adds `question`, `criterion` and `result: pass|fail|inconclusive`.
- **Exhaustion** is unchanged: a used rung is never repeated; when all rungs are spent, the result is `recommend:none, reason:budget-exhausted`.
- **U5 owner** is reached only by the caller's own stop. classify never emits it.

**P4b (Train B)** renumbers owner U4 → U5 in `probe-unknown.js`, `decision-ledger.js`, `hooks/tests/probe-unknown.test.sh` and their mirrors. It is driven by grep, not by a line catalog, because P4a shifts the lines. The unrelated `U4` in `docs/BACKLOG.md` and `mission-convergence.test.sh` is excluded by path in `check-stage-vocab.js`.

**Acceptance:**
- `probe-unknown.test.sh` has planted cases for each new rung's eligibility, receipt and exhaustion, and for classify never emitting U5.
- classify fixtures use the argv of each of the four call sites (§P5).

### P5 — guidance rewrite (L; guidance; Train B; after P0, P2a, P4b)

1. **dev-flow**: sizes, entry and init (§2.9); stage calls citing `stage-graph.js`; the E1 bump; remove `L-1…`, `S-scope-gate`, the Fix/H sections and the duplicate S session-end; contract-card trim.
2. **finish-flow**: the `finish` checklist keyed by size; the urgent post-finish code-review.
3. **ceo-agent**: cite the graph; keep the level table.
4. **team**, `references/plan-template.md`, the config templates, and the G1 default in `review-loop-config.md`.
5. **Ladder text** for the four call sites:
   - `skills/debug/SKILL.md` step 4;
   - the `skills/dev-flow/SKILL.md` intent/plan consult;
   - `skills/think-tank/SKILL.md` Step 5;
   - `skills/ceo-agent/references/depth0-control-loop.md` round end.

   Also `skills/{l4,l5,l6}/SKILL.md`, `skills/ceo-agent/SKILL.md`, `references/hetero-dispatch.md` and `docs/scripts-inventory.md`.
6. The `description:` lines of dev-flow, finish-flow and team, plus the SKILL.md "Available scripts" rows and reference docs for the new scripts.
7. Run the P0 eval: base vs change, plus planted-red.
8. On SHIP:
   - `profiles-hash-repin`;
   - codex mirror sync;
   - re-freeze the packs;
   - switch `check-stage-vocab.js` to a gate inside `check-canonical-invariants.sh` and drop its `S-scope-gate` literal.

**Acceptance:**
- KR3 and KR4.
- grep finds zero owner-rung `U4` in the four call-site files.
- The profiles chain is green.
- `sync-codex-plugin-skills.sh --check` is in sync.

### P6 — backlog effort rename (S; mechanism; Train B)

1. `check-backlog-entries.js`: valid values are the sizes from `stage-graph.json` plus an optional `!`/`急`. `Fix` and `H` are rejected with the mapping and the migration command. `XL` becomes valid, so its negative fixture changes.
2. `next-pick.js`:
   - parses the suffix;
   - human gate = `L|XL` or urgent;
   - tie-break `XS > S > M`.
3. Migrate `docs/BACKLOG.md`.

**Acceptance:** KR5, plus a fixture for each old value.

### P7 — TUI band + ⓘ panel (L; mechanism; Train B → alpha.2)

1. Implement V4a (TUI README) on the §2.9 fields:
   - band line: `size·level ▸ stage`, `unit k/N`, `·n族`, and the `stage_set_at` age;
   - panel: legend, detail, and the graph with the current node highlighted.
2. `gate/check.js`:
   - judges each slot against its marker field, expected output `PASS <mode> fields=<n>`;
   - adds a colored-screenshot step (`capture-pane -e` → `ansi2html.py` → headless chrome).
3. Re-run the gate in every mode.

**Acceptance:** KR1.

### P8 — cuts (S; release; repeated)

**Cut points:**
- alpha.1 = Train B merged (P2b, P3, P4b, P5, P6) with every invariant green.
- alpha.2 = P7.
- 3.0.0 = owner sign-off plus the KR1 gate.

**Each cut:**
1. A CHANGELOG section. 3.0.0's folds in the mods P1W entries and `a2b91aef`'s Unreleased section, plus migration and rollback.
2. The INDEX row.
3. `preflight-release.sh`, now calling `check-guidance-eval.js`.
4. Plan graduation (final cut only).
5. Ask the owner before every push.

**Dependency map:**
- `P0 → P1 → P2a → {P2b, P3, P5, P7}`
- `P0 → P5`
- `P4a → P4b → P5`
- `alpha.1 → P7`
- `P1 → P6`
- `P-R → P8`
- `{P2b, P3, P4b, P5, P6} → alpha.1`
- `P7 → alpha.2 → 3.0.0`

P-R and P0 run first, in parallel. P4a runs in parallel with P1/P2a.

## 5. Test / validation

- **Script-gated:**
  - per-phase acceptance;
  - `check-contract-schema.js`;
  - `check-stage-vocab.js`;
  - `check-guidance-eval.js`;
  - the profiles chain;
  - mirror parity;
  - `gate/check.js`.
- **Eval-gated:** P0's frozen rule, with a planted red and no rerun-until-green.
- **Human-gated:**
  - the proposal page (done);
  - the colored-screenshot judgment;
  - each push.

## 6. Risks + inversion

- **A vacuous eval.**
  - Mitigation: a planted-red arm must fail, and the exact-sequence fixture binds the scorer.
- **Prose writers skip `stage-advance`** (six nodes are prose-written).
  - Exit 3 refuses illegal jumps but cannot force a call.
  - Mitigation: the band shows the `stage_set_at` age, and the gate asserts that stages advance in real runs.
  - If staleness shows anyway, an event-inferring hook (option C3) goes to BACKLOG.
- **The breaking change reaches develop early.**
  - Mitigation: Train B stays on `release/3.0.0` until alpha.1.
- **Stranded consumers.**
  - Mitigation: the reject message names the mapping; `check-stage-vocab.js --repo`; the CHANGELOG migration section.
- **Scope.** F2 doubles the work; the owner accepted the TUI wait.
  - Mitigation: Train A parallelism.
- **Hash-chain churn.**
  - Mitigation: one P5 guidance commit and one re-pin.
- **Graph/prose drift.**
  - Mitigation: prose cites the CLI, and the KR4 gate catches leftovers.

## 7. Out of scope

- An event-inferring stage hook (option C3).
- The codeforge mod and the shared TUI style guide.
- Changes to `/l3–/l6` meaning or to campaign engine states, which map onto `unit` only.
- Re-qualifying verifier engines.
- The stale `2.36.36` cache, which the doctor already warns about.
- Compatibility aliases of any kind.

## 8. Open questions (Board)

None. Resolved 2026-10-06:
- Ladder order: U0 local · U1 consult · U2 survey · U3 panel · U4 experiment · U5 owner, with no alias.
- No 2.37.0.

## Review log

- **R0** (2026-10-06, Claude Opus 5.5 at depth-0): drafted from the owner discussion and the proposal-page answers.
  - Frozen rubric: `docs/plans/2026-10-06-dev-flow-stage-graph.rubric.md` (R1–R11).
  - Manifest: `docs/plans/2026-10-06-dev-flow-stage-graph.plan-review-manifest.json`, `logical_plan_id: dev-flow-stage-graph-2026-10-06`.
  - Seats: sol chair (openai), grok deep (xai), MiniMax consult; minimum 2 families.
- **G1** (2026-10-06): CONDITIONAL. Transport was complete (3/3 seats), with 16 blocker candidates.
  - Artifact: `docs/plans/2026-10-06-dev-flow-stage-graph.g1-artifact.json`.
  - Depth-0 dispositions: `….g1-dispositions.json` — 9 accepted blockers; the rest duplicates or accepted non-blocking; none rejected.
- **R1** was the bounded repair of the accepted G1 blockers and nothing else:
  - §2.7 graph and writers;
  - §2.8 manifest and cut gate;
  - §2.9 schema;
  - P0 scorer;
  - P4 budgets;
  - landing trains;
  - E1;
  - discovery points.
- **G2** (2026-10-06): CONDITIONAL, terminal (generation cap). Transport complete, with 18 blocker candidates.
  - Artifact: `….g2-artifact.json`.
  - Dispositions: `….g2-dispositions.json` (generation 2). 17 were accepted as blockers, of which 3 were merged into other folds; 3 are duplicates of non-blocking items; 1 is accepted non-blocking; and 1 was rejected with rationale: R3's CLAUDE.md-in-manifest and per-commit gate, which is index metadata and redundant with the cut gate.
- **R2** is the bounded repair of the G2 accepted blockers only:
  - one XL code-review, and the urgent terminal edge;
  - fixture cells for research and units;
  - `review_families` from completed receipts;
  - pre-stage and unit rules;
  - bump resume;
  - `high_risk` and init create/merge, and the schema file;
  - scorer horizon and rung;
  - the rotated planted-red;
  - the four call sites, the U3 predicate, and P4b as mechanism-only;
  - the P-R consumer list and `lib/semver.js`;
  - `check-stage-vocab.js` moved to P1, plus P7 dependencies;
  - per-phase discovery wiring;
  - Train B as one atomic landing.
- **FROZEN** (2026-10-06). The criterion: after depth-0 adjudication of G2, no construct- or mechanism-level finding is left unanswered (each one is folded or refuted). This is not a zero-findings criterion. Receipt gate: `check-phase-review-receipt.js --plan-artifact ….g2-artifact.json --dispositions ….g2-dispositions.json` rc=0, run against the reviewed R1 text (`git show 7c8a941f:<plan>`, sha256 `18dfc0a2…`), because the artifact binds the plan bytes the panel saw.
- **Execution deviations** are bookkeeping, not a re-review. They are logged in [`evidence/2026-10-06-stage-graph/README.md`](evidence/2026-10-06-stage-graph/README.md):
  - **§2.7 E1 bump and `high_risk`** measure `base_ref` against the working tree plus untracked files, instead of `..HEAD`. qc-gate runs before commit, so `..HEAD` would never fire.
  - **P0 first rung** is `eligible_max`, not `recommend`. `recommend` depends on the host roster.
  - **`stage-graph.js next` from `research`** needs `--research`. `stage-advance.js` passes it, and P3 rails calling `next` directly must pass it too.

## Owner addendum A1 (2026-10-06): band widgets and advisory bridge in 3.0.0

The owner chose "b" on the mods-candidates survey (`scratchpad` report summarised in the execution log). It folds four survey items into 3.0.0, beside P7. This is scope added after freeze, by owner decision. It is not re-reviewed as a plan: the code-review node of each phase reviews it. The §2.5 Global Constraints and the V4a owner decisions in `docs/plans/evidence/2026-10-06-tui-band/README.md` apply unchanged. The phases are mechanism unless stated, and none of them edits advisory wording. Moving a text from model context to a human surface is mechanism; rewording it would be guidance, so it would need eval.

### P7 (expanded): one-line band of side-by-side widgets

V4a, one line, theme-key text colour only, sized to `bodyColumns`. Slots appear in priority order, separated by a `│` drawn in `subtle`:

| Slot | Shows | Example |
|---|---|---|
| verdict | the verdict glyph and word | `▲ 要你決定` |
| position | size·level ▸ stage, plus the `stage_set_at` age | `L·l5 ▸ verify ◷12m` |
| unit | the unit bar, k/N, and family count | `▰▰▱▱ 2/4 ·3族` |
| dispatch | live dispatch count and stalled count | `⚙n ⏸n` |
| review | the review round and QC chip (P7c) | `R2 ⟲ · QC ✓` |
| decisions | decisions taken for the owner, decisions with no record, and the ladder rung | `◆n ?n U1` |
| spend | spend against the cap | `$41/150` |
| hygiene | load source (P7b) and worktree residue | `dev ↓3 · wt 9` |
| ⓘ | opens the panel | `ⓘ` |

At narrower widths the low-priority slots drop:

| Width | Slots kept |
|---|---|
| < 160 | hygiene is dropped |
| < 140 | spend and decisions are also dropped |
| < 120 | the age and review are also dropped |
| < 80 | verdict, dispatch, unit bar and ⓘ |

The ⓘ panel has these tabs: Legend · Now · Graph (current node highlighted) · Dispatch · Review (P7d) · Decisions · Spend · Hygiene.

**Acceptance:**
- KR1 per-field gate: every rendered slot is checked against its source field.
- Colored screenshots at 209, 120 and 80 columns.

### P7a: advisory bridge (mechanism)

`cost-tracker` queued advice, `version-drift-check`'s SessionStart text, `context-budget` T1 and `suggest-compact` stop being injected into model context.

- Each one writes the same text, unchanged, to `<live>/advisories/<sid>.jsonl` as `{id, kind, severity, text, at}`.
- The mod shows it as a toast or a chip.
- A stderr copy remains, and a per-hook knob restores injection.
- These stay model-facing: `context-budget` T2, `cost-fuse` warn, `depth0-delegate-gate`, `foreman-guard`, `dispatch-model-guard`, `failure-escalation`, and the SessionStart handoff snapshot.

**Acceptance:**
- Each moved hook has a test showing no `additionalContext` and one advisory row.
- With the knob on, injection comes back.
- The mod renders a toast fixture.

### P7b: plugin load-source chip

The hygiene slot shows the plugin version and its source (`dev` vs a versioned cache dir), plus the commits it is behind upstream. The data comes from `dev-setup.sh --check` facts, published by the watcher.

**Acceptance:** with a planted semver cache dir, the chip shows the cache source; for the real dev tree it shows `dev`.

### P7c: QC chip

A watcher publishes whether HEAD's protected-path diff since the remote carries a `QC-Verdict: PASS` trailer, using the same rule as `.githooks/pre-push`. The band shows `QC ✓` or `QC owed`.

**Acceptance:** fixture repos for each state.

### P7d: review tab

The panel reads `~/.autopilot/plan-review/<session_key>/state.json` for the plan-review generation, seats and verdict. It also reads a published hetero-review-loop round summary, which the loop's `collect` writes as a new small JSON.

**Acceptance:** fixture states render, and a missing state shows "no review".

**Dependencies:**
- `{P2b, P3} → P7` (already true).
- `P7a`, `P7b`, `P7c` and `P7d` are independent of each other, and each lands before alpha.2.
- They are built on `release/3.0.0` in parallel with the P5 eval revision.
