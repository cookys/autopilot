# dev-flow hetero loops as default — plan loop → dispatch → per-phase hetero review → qc gate

Status: **design, owner go 2026-09-04 (this host, direct)**. Plan review (rubric-frozen, ≤2
generations) runs before any code. Ships as MINOR **v2.36.0** (new skill `hetero-review`).

## 0. Context / thesis

Usage investigation 2026-09-04 (878 local sessions + 7 fleet session replies, populations kept
separate): the owner's dominant phrasing is "叫 autopilot plan loop review hetero", "coding 完成後
過 hetero loop review", "engage hetero engine review". **No skill `description:` contains any of
these words.** `scripts/dispatch-plan-review.js` has exactly one caller (`research-to-ship`
Phase 3); the three-seat qc panel is reachable only through `finish-flow` L-5.2; per-phase code
review inside dev-flow L-4 is one free-text checklist line ("Code review: no blocking issues
remain"). The observed confusion between "hetero engine" and "agent-call" is a routing gap, not a
vocabulary problem: the verb decides the posture (ask/consult → a model; call/dispatch/notify →
a CLI engine if X is an engine name, a session if X is a host/project/pane).

Thesis: the loops the owner already runs by hand become the **default shape of dev-flow L-size**
(opt-out, not opt-in), and the owner's own phrases become the trigger of one thin routing skill.

```
L-2 plan → L-2.5 plan hetero loop review → L-4 dispatch (v2.35.16 topology)
        → per-phase hetero review loop → L-5 qc gate (three-seat panel, QC-Verdict trailer)
```

What already exists (do not rebuild): `dispatch-plan-review.js` (rubric-frozen, manifest seats,
two-generation cap, growth rails); `plan_review` / `plan_reviewer_*` / `plan_review_max_*` knobs in
`resolve-review-loop.sh` (line ~383, validated, `off` by default, consumed by nobody but
research-to-ship); `dispatch-review.sh` (one seat, SHIP-AS-IS / FIX-THEN-SHIP protocol);
`qc_panel` + `qc_panel_aggregation: union-on-verified-critical` roster fields; the pre-push
qc-gate trailer; `resolve-dispatch-topology.js` (implementer ladder + judge from host facts);
`dispatch-consult.sh` (raw-prompt rail, blind-evidence preflight, six qualified consult seats
fleet-wide, `consult_dispatch: off`, zero callers).

## 1. Problem

1. **No trigger.** The owner's phrases route nowhere; the session improvises a review by hand
   (three `dispatch-review.sh` calls + manual union), unreproducibly.
2. **Plan review is opt-in twice.** `plan_review: off` by default, and dev-flow L-2 never calls it
   even when on — only research-to-ship does. A plan that never met a hetero reviewer enters L-3.
3. **Per-phase code review is prose.** L-4's advance gate says "code review: no blocking issues"
   with enforcer `documented-only`. Nothing names the reviewer, the verdict, or the evidence.
4. **Consult is chained to the codex plugin.** `references/hetero-dispatch.md` presents "peer
   consult" as the codex-plugin channel; the seat rail (`dispatch-consult.sh`) has no hook point
   in any skill and its switch is off, so every "ask a model" happens via a raw CLI call.

## 2. KRs

- KR1: on a host whose topology yields ≥2 qualified plan-review seats of distinct families, a fresh
  L-size dev-flow run reaches L-3 only after `dispatch-plan-review.js` returned READY or a
  depth-0-adjudicated CONDITIONAL — with **zero** project config edits (`plan_review: auto`).
- KR2: each owner phrase ("plan loop review hetero", "過 hetero loop review", "hetero review",
  "engage hetero engine review") appears verbatim in exactly one skill `description:`
  (`hetero-review`), and no other skill description contains "hetero review".
- KR3: the L-4 phase advance gate's code-review item is satisfied only by a recorded
  `hetero_review` outcome (`SHIP-AS-IS`, or `FIX-THEN-SHIP` followed by a delta re-review reaching
  SHIP), written to the project ledger with seat provenance; a phase with no recorded outcome
  cannot advance (enforcer: `scripts/check-phase-review-receipt.js`, exit 1).
- KR4: size rules hold: S skips the plan loop and runs one hetero review seat + qc; Fix runs qc
  only; L/H run all four stages. `hetero_review: off` and `plan_review: off` remain honoured and
  every opt-out is logged in the ledger.
- KR5: `consult_dispatch: auto` resolves a consult seat from the host topology (preferring a
  family different from the asking model), and `dispatch-consult.sh` runs on a host with no codex
  plugin installed.
- KR6: prose ratchet: `skills/dev-flow/SKILL.md` and `skills/ceo-agent/SKILL.md` do not grow past
  their recorded baselines; new judgment prose lands in `references/`.

## 2.5 Global constraints (verbatim into every dispatch)

- ADR-0001: a review verdict is a claim until depth-0 re-derives it from the reviewer's JSON
  artifact and the git diff it reviewed; a hetero implementer's green is a claim, never a gate.
- Every new knob has `auto` derived from `~/.autopilot/topology.json` facts (installed runners ×
  qualified seats), `on` requiring an explicit tuple, `off` logged. A missing or garbage value fails
  closed toward "no hetero seat → native fallback + warning", never toward silently skipping the
  stage.
- No new severity vocabulary; no trust machinery; no third canonical statement of "what the
  reviewer reads" (code-review.md Invocation § stays canonical).
- Citations in this plan are provenance, not reading assignments: reviewers judge this packet as
  self-contained.
- `check-redispatch-prompt.sh` hygiene applies to every implementer brief (no fenced code, no
  "around line N").

## 3. File-structure map

| File | Change |
|---|---|
| `scripts/resolve-dispatch-topology.js` | `--role implementer\|plan_reviewer\|reviewer\|consult\|discuss` (default: all). Topology JSON gains `plan_review_panel` (≤3 seats, distinct families, chair = highest effort rank), `reviewer_ladder`, `consult_ladder` (ordered: family ≠ `--asking-family` first, then latency, then cost rank), `discuss_ladder`. Facts from `engine-scorecard.js seat-status` per role; never from `ladder`/`report`. Role mapping (scorecard has no `plan_reviewer` role): plan seats derive from `reviewer` rows (chair must be reviewer-qualified) plus `consult` rows for non-chair seats; runner token aliases are normalised (`codex-cli` ≡ `codex`, seen on sol event 141) so a qualified seat is not dropped by a spelling drift |
| `scripts/resolve-review-loop.sh` + `schemas/review-loop-contract.schema.json` + `project-config-template/review-loop-config.md` | `plan_review: auto` (new default; expands to the topology panel; `on` keeps the explicit-tuple rule), `hetero_review: auto\|on\|off` (new; default `auto`), `consult_dispatch: auto` (new value; default `auto`). `--field` emits the expanded tuples. Invalid ⇒ exit 3 with the existing message shape |
| `scripts/plan-rubric-scaffold.js` (new) | from a plan file, emit a rubric skeleton: one `R<n>:` per KR, one per §2.5 constraint, one per §6 risk; ids stable across re-runs; never overwrites an existing rubric (exit 2) |
| `scripts/hetero-review-loop.js` (new) | code loop driver: resolve seats (`--field reviewer_*` / `qc_panel*` or `--role reviewer` topology), run `dispatch-review.sh` per seat in parallel, synthesise `union-on-verified-critical`, write `<ledger>/review-<phase>-g<n>.json` (verdict, per-seat verdict, findings with seat provenance, diff sha), emit FIX-THEN-SHIP findings as a hands brief skeleton that passes `check-redispatch-prompt.sh`; `--delta <sha>` re-reviews only the delta. Reuses `adjudicate-findings.js` where it already covers union |
| `scripts/check-phase-review-receipt.js` (new) | KR3 enforcer: given ledger dir + phase id, exit 0 iff the latest receipt's verdict is SHIP and its `diff_sha` equals the phase branch head |
| `skills/hetero-review/SKILL.md` (new, ≤120 lines) + `references/{plan-loop,code-loop}.md` | thin router: input is a plan path → plan loop (`plan-rubric-scaffold.js` → manifest from topology → `dispatch-plan-review.js --timeout 20m` → depth-0 adjudication → freeze); input is a branch/diff → code loop (`hetero-review-loop.js` → hands repair via topology → delta → SHIP → trailer). `description:` carries the owner phrases verbatim |
| `skills/dev-flow/SKILL.md` (line-neutral) + `skills/dev-flow/references/hetero-loops.md` (new) | L-2.5 row (→ `hetero-review` plan loop; gate: frozen rubric + READY/CONDITIONAL-adjudicated); L-4 advance-gate code-review item → `check-phase-review-receipt.js`; size table gains the KR4 rule; judgment prose in the reference |
| `skills/ceo-agent/SKILL.md` (line-neutral) + `references/level-front-door.md` | pointer to the four-stage default; front-door § Default dispatch topology gains one "review seats" row |
| `skills/research-to-ship/SKILL.md` | Phase 3 becomes "invoke `hetero-review` (plan loop)"; Phase 5 unchanged; the skill is survey + dev-flow with gates |
| `references/hetero-dispatch.md` | § "Peer consult — the codex plugin channel" → "Codex-plugin consult (optional)"; "peer" reserved for sessions; consult seat § gains hook points (debug after two failed hypotheses, think-tank 3.5, dev-flow L design decision, qc seat exclusion) |
| `skills/agent-call/SKILL.md` (`description:` only) | owner verbs (通知／跟 X 說／叫 <host>), hangar-bridge trigger; Not-for → `hetero-review` / consult seat / `/l4`–`/l6`; note: Claude sessions are addressed by `fleet peers` instance id, `fleet local list` shows non-Claude panes only |
| `references/evidence-discipline.md` | two rows: hetero implementer green is a claim not a gate (openclaw 2026-07-02 live-test ACL loosening); a leaf that is a systemd/CLI process cannot be `SendMessage`d — re-dispatch instead |
| `profiles/rule-inventory.json`, `rule-migration.json`, `profile-catalog.json` (+ codex mirror) | hash repin after the dev-flow / ceo-agent edits (skill `profiles-hash-repin`) |
| `docs/scripts-inventory.md`, `CLAUDE.md` group list, `README.md` skill count, `platforms/codex/plugin/**`, opencode mirror, `.claude-plugin/plugin.json` | wiring for three scripts + one skill; `sync-version.js --version 2.36.0 --skill-count 30` |
| `scripts/dispatch-plan-review.js` | `RUNNERS` gains `kimi` (already a `dispatch-review.sh` runner; its absence forced D0 to seat GLM instead of kimi) |
| `hooks/tests/{resolve-dispatch-topology,resolve-review-loop,plan-rubric-scaffold,hetero-review-loop,check-phase-review-receipt,check-hook-inventory}.test.sh`, `evals/` slash-entry probe row | tests |

## 4. Phases (deliverables; each is one foreman, one cut at a time)

| # | Deliverable | Size | Acceptance |
|---|---|---|---|
| D1 | Topology roles + resolver `auto` knobs (`plan_review`, `hetero_review`, `consult_dispatch`) | M | on this host `--role plan_reviewer` yields ≥2 seats of distinct families; `--field plan_review` prints the expanded tuple; a topology with zero plan seats ⇒ `plan_review` resolves `off` + `capability_warnings` line; unit tests for auto/on/off × present/absent topology; schema x-field-order updated; `check-contract-schema.js` green |
| D2 | `plan-rubric-scaffold.js` + `hetero-review-loop.js` + `check-phase-review-receipt.js` | L | scaffold reproduces this plan's rubric ids from this plan file; loop driver on a synthetic three-seat fixture (canned `dispatch-review.sh` outputs via `PATH` shim) produces the union verdict and a hygiene-passing hands brief; receipt checker: SHIP+matching sha ⇒ 0, stale sha ⇒ 1, missing ⇒ 1 |
| D3 | `hetero-review` skill + dev-flow / ceo-agent / research-to-ship / front-door edits + profiles repin | M | `grep -l "hetero review" skills/*/SKILL.md` → exactly `hetero-review`; slash-entry probe green; `build-profile-payload.js catalog --check` rc 0; `wc -l` dev-flow ≤ 733, ceo-agent ≤ 550 |
| D4 | Consult decoupling + agent-call description + evidence-discipline rows | S | `dispatch-consult.sh` dry-run resolves a seat with `consult_dispatch: auto` on this host; hetero-dispatch.md has no "peer consult" heading; `check-canonical-invariants.sh` green |
| D5 | Release: version 2.36.0, CHANGELOG (`prose-justification:` line), README/INDEX/mirrors, archive | S | `preflight-release.sh` green; full suite; qc three-seat SHIP; trailer on merge |

D0 (this plan) runs the plan loop itself: manifest sol@codex max (chair), GLM-5.2@cc-shim,
MiniMax-M3@cc-shim (kimi is not yet a plan-review runner, see §3); `--timeout 20m`; ≤2 generations; depth-0 dispositions; freeze before D1.

Execution posture (v2.35.16 topology, dogfooded): branch `feat/dev-flow-hetero-loops`;
governance shadow on the branch (precedent 5ca93e08), restored before merge; `worktree.baseRef:
head`; session marker l4; one sonnet foreman per deliverable, one cut at a time, Bash cap 40;
hands `gemini-3.8-flash-low@agy` rung 0, climb on red; every brief line 1 `Engine: …`; verification
by git artifacts; per-deliverable hetero review loop (D2's own driver once it exists — until then,
three `dispatch-review.sh` seats with depth-0 union) before merge into the feature branch.

## 5. Test / validation

Script-gated: every new script has a `hooks/tests/*.test.sh` with fixtures under scratch dirs
(`ENGINE_*_DIR` redirection, never the real scorecard store); resolver tests cover the
auto/on/off matrix; the loop driver is tested against a `PATH`-shimmed `dispatch-review.sh` so no
model is spent in CI. Human-gated: one real plan loop (D0) and one real per-phase code loop (D3's
merge) recorded in the project ledger with seat provenance.

Negative controls (evidence-discipline): delete the receipt file → `check-phase-review-receipt.js`
must exit 1; point the topology at an empty seat store → `plan_review` must resolve `off` with a
warning, never `on` with an empty tuple; hand-written `plan_reviewer_runner: bogus` → exit 3; a
union fixture where one seat says FIX-THEN-SHIP with a verified critical → union is FIX-THEN-SHIP
even when two seats say SHIP.

## 6. Risks + inversion

- **Loop fatigue makes the default get switched off.** Guaranteed if every S-size change pays for
  three seats. Hence the KR4 size rule and one-seat S posture; the opt-out is logged, not hidden.
- **Chair over-production.** sol@max emits 8–9 findings per generation; freezing on "zero
  findings" never converges. Freeze criterion is zero construct/mechanism-level findings after
  depth-0 adjudication (brain precedent, 2026-08-18).
- **Growth rail.** A repaired plan over 1.25× R0 bytes trips the warn rail, 1.5× stops. Repair by
  moving narrative to the evidence dir, never by raising the ratio.
- **Receipt theater.** A receipt written by the implementer is worthless; `hetero-review-loop.js`
  writes it from reviewer JSON + `git rev-parse`, and the checker compares to the branch head.
- **Hetero seats down (429/5xx).** `auto` degrades to the native panel with a warning; the stage
  still runs; the ledger shows which seat family actually judged.
- **Prose ratchet.** dev-flow is at 733 lines (baseline 717 already justified); D3 must be
  line-neutral — every added row removes a line of prose into the reference.

## 7. Out of scope

New qualification exams; a top-level `/ask` skill; making the codex plugin mandatory; putting
claude-native into the hetero implementer ladder; P5 fleet rollout of v2.35.16 (still cuda-first,
owner-gated); changing `qc_panel_aggregation` semantics.

## 8. Owner rulings (2026-09-04, this host — not open)

1. Default is opt-out: L/H size dev-flow runs all four stages unless `plan_review`/`hetero_review`
   are set `off`.
2. Trigger words are the owner's own phrases; one thin `hetero-review` skill routes plan vs code.
3. Consult is a seat, not a plugin; codex plugin stays optional.
4. Plan review is depth-0-adjudicated: chair proposes, brain freezes.

## Review log

R0 author: autopilot session on aimax395, 2026-09-04. Plan loop D0 pending (this file's own
first dogfood of the design).
