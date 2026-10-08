# Total QC before 3.0.0-alpha.1 (2026-10-08)

Owes: the full QC of the protected diff recorded in the execution log ("Push and QC debt"). Scope chosen by the owner: **Train A + Train B**, range `8a10980f..3aae28a4` on `release/3.0.0`. The mods P1W part of the debt (`7fc8efc5..8a10980f`) is covered by its per-fix hetero reviews in `../../2026-10-04-mods-p1c/accepted-heads-p1w.txt`.

## Method

- The range is ~1.07 MB of reviewable diff (excluding `platforms/codex/**` mirrors, `evals/skill-onoff/packs/**`, `evals/skill-onoff/results/**`, `profiles/*.json`). `hetero-review-loop.js collect` cannot carry it: its `--exclude` allowlist forbids path slicing by design, and even the pack copies cannot be excluded. So this is a **direct `dispatch-review.sh` panel**, not a `hetero-review-loop` chain, and there is no `chain.json` receipt. This directory is the receipt.
- 8 packets cut **by plan phase / concern, each carrying code with its own tests** ([`packets.json`](packets.json), focus per packet in [`focus.json`](focus.json)). Every spec ([`common-head.md`](common-head.md) template) carried the full packet map, the deterministic gate outputs at `3aae28a4`, the full frozen plan (develop copy, incl. A1, R-K1, execution deviations) and, for K6, [`profiles-summary.txt`](profiles-summary.txt) (the 364 new `removed` dispositions with each P0 line verbatim).
- Excluded surfaces were verified deterministically instead: `sync-codex-plugin-skills.sh --check` (in sync), `check-guidance-eval.js --base 8a10980f --results …v5.jsonl` (ok, 43/43 byte-equal, scorer SHIP), `check-stage-vocab --gate` (0), `check-canonical-invariants.sh`, `check-claude-md-inventory.js`, `check-js-syntax.js`, profile `catalog --check`.
- Seats: opus (claude-native; owner substituted it for the roster's fable seat for cost), GLM-5.2 (cc-shim), MiniMax-M3 (cc-shim); Qwen3.8-Max-Preview (qoderclicn) as the standby. 30 min timeout per seat.

## Seat verdicts ([`seats/`](seats/))

| Packet | Seat | Status | Verdict | Findings |
|---|---|---|---|---|
| K1-graph | glm | reviewed | SHIP-AS-IS | 🟡1 🔵1 |
| K1-graph | minimax | reviewed | SHIP-AS-IS | none |
| K1-graph | opus | reviewed | FIX-THEN-SHIP | 🟡1 🔵2 |
| K2-marker | glm | reviewed | SHIP-AS-IS | 🔵3 |
| K2-marker | minimax | reviewed | SHIP-AS-IS | none |
| K2-marker | opus | no_verdict | — | none |
| K3-ladder-release-backlog | glm | reviewed | SHIP-AS-IS | 🔵2 |
| K3-ladder-release-backlog | minimax | no_verdict | — | none |
| K3-ladder-release-backlog | opus | reviewed | SHIP-AS-IS | 🟡2 🔵1 |
| K3-ladder-release-backlog | qwen | reviewed | SHIP-AS-IS | 🔵2 |
| K4-eval-harness | glm | reviewed | SHIP-AS-IS | 🔵3 |
| K4-eval-harness | minimax | reviewed | SHIP-AS-IS | 🔵3 |
| K4-eval-harness | opus | reviewed | SHIP-AS-IS | 🔵3 |
| K5-eval-tasks | glm | reviewed | SHIP-AS-IS | 🔵1 |
| K5-eval-tasks | minimax | reviewed | SHIP-AS-IS | none |
| K5-eval-tasks | opus | reviewed | SHIP-AS-IS | 🔵4 |
| K6-devflow | glm | reviewed | SHIP-AS-IS | 🔵4 |
| K6-devflow | minimax | reviewed | SHIP-AS-IS | 🟡2 🔵2 |
| K6-devflow | opus | reviewed | FIX-THEN-SHIP | 🟡1 🔵3 |
| K7-guidance | glm | reviewed | SHIP-AS-IS | none |
| K7-guidance | minimax | reviewed | SHIP-AS-IS | none |
| K7-guidance | opus | reviewed | FIX-THEN-SHIP | 🟠2 🔵2 |
| K8-a1 | glm | reviewed | SHIP-AS-IS | 🟡2 🔵2 |
| K8-a1 | minimax | reviewed | SHIP-AS-IS | none |
| K8-a1 | opus | reviewed | SHIP-AS-IS | 🔵3 |

Instrument notes:
- **K2 / opus `no_verdict` → adopted.** The parser rejected a multi-line NO-FINDING-PROOF; the raw log ([`seats/K2-marker.opus.rawlog.txt`](seats/K2-marker.opus.rawlog.txt)) holds a complete framed block with `checked=`, `evidence=` and `conclusion=`, verdict SHIP-AS-IS + 4 🔵.
- **K3 / MiniMax `no_verdict` → rejected, replaced by Qwen.** Its NO-FINDING-PROOF has no `evidence=` field ([`seats/K3-ladder-release-backlog.minimax.rawlog.txt`](seats/K3-ladder-release-backlog.minimax.rawlog.txt)); not counted as a vote.

Every packet has three valid verdicts. FIX-THEN-SHIP came from opus on K1, K6, K7.

## Dispositions

Accepted and fixed (each re-verified by depth-0 from the committed state, with an own mutation for code fixes):

| Id | Finding | Fix |
|---|---|---|
| F1 | K1 opus 🟡 + glm 🟡: `docs/skills.md` dev-flow row "Sizes tasks (S/L/H)"; `docs/scripts-inventory.md` next-pick row "L/H" | `fcc93cad` |
| F2 | K3 opus 🟡: `probe-unknown.js` classify `break`s on an over-max U2/U3 before the position-free U4 (plan P4: U2 receipt + S4\|S1) | `c1f776f3`; mutation (revert) → `over-max U2 does not hide the signal-gated U4 … got 'none'` |
| F3 | K3 opus 🟡: `preflight-release.sh` final-version filter drops a whole line mixing `v3.0.0` and a pre-release | `f23e0c68`; mutation → 3 semver assertions red. Deviation from the brief: only `-alpha\|-beta\|-rc` suffixes are refused after a final version (not every `-`), because `semver.test.sh` pins `v2.7.2-followup` as tolerated |
| F4 | K6 opus 🟡: 12 dispositions claimed "relocated verbatim … outside the two-file rule inventory"; false — targets are the inventory sources (a verbatim rule there would make the disposition dead) | `95230eb6`; each row re-checked by trimmed line equality, rationale now "restated (reworded)" with the new location; catalog `guided_dispositions_sha256` re-pinned (no builder write mode exists — hand-set to the file sha256, as the suite computes it) |
| F5 | Full suite (`run.sh --parallel 4`): 7 test-maintenance regressions (tests not kept in step with the range; product code fine) — dispatch-hetero heading, resolver-a stub `unknown_budget_u4`, resolver-b missing `lib/stage-write.js`, consult-discuss-switch allowlists, test-identity-guard `lib.sh`, canonical-invariants sandbox `check-stage-vocab.js`, scorecard-tools r75 argv > 128 KiB | `2c0bec20`; each suite green solo; triage logs in [`triage/`](triage/) |
| G1 | K7 opus 🟠: finish-flow clears the l4–l6 marker only in the L/XL checklist; an M-sized (or XS/S) /l4–/l6 session never clears it nor passes `can_close` | `0cf239d0` — new "Session-mode marker" row keyed by level l4/l5/l6 at any size, carrying the old L5/L6 status gate + clear text; the lite "no marker-clear step" sentence is gone; Entry step 1 also reads `level` |
| G2 | K7 opus 🟠: ceo-agent keys project dir / INDEX / intent / tree init on M/L/XL; closing side is L/XL; the 2026-06-12 Board directive said L | `5e8717c8` — project dir, README, INDEX, tree init, scope audit and both forcing-function tasks tagged (L/XL); size-agnostic M/L/XL items kept; profiles re-pin with 3 `rewritten` dispositions |
| G3 | K6 opus 🔵 + MiniMax 🟡: urgent placement probe also told S! to expect a post-finish code-review (XS/S: urgency is a mark only) — owner chose to fix | `0458c7bf` — probe scoped to urgent M/L/XL; "XS/S: urgency is a mark only" added in dev-flow, stage-graph.md and ceo-agent step 4 |
| G4 | K6 GLM 🔵 (partly verified): 2.x S "if from backlog, delete the item" had no successor | `7c1f0042` — lite item and full item 5: delete the backlog row the work came from |
| G5 | K6 GLM 🔵: resume replay omits `--unit` | `1fc8de26` — replayed `implement` takes `--unit` |

G1–G5 change guidance, so the v5 packs no longer match: they ship only after a v6 eval arm (owner decision: fix, then run v6).

Refuted:
- K6 MiniMax 🟡 "`scripts/completeness-scan.sh` missing": it exists, unchanged in the range (so in no packet).
- K6 MiniMax 🔵 "triggered BACKLOG pickup dropped": carried by finish-flow full checklist item 6.
- K6 GLM 🔵 "`stage-graph.js limits` / `unit_kind` may not exist": `stage-graph.js limits --size S` → `{"files":6,"lines":200}`; `nodes` returns `unit_kind`.
- K2 GLM 🔵 pre-push degrades open when `scripts/lib/qc-evidence.sh` is missing: kept as 🔵 — the hook is installed only in this repo's clone via `core.hooksPath`, and it already degrades open when the resolver is missing; a stderr line is worth adding (BACKLOG).

Not fixed (🔵 / follow-up, recorded here only): K5 none-keyed `|| true` no-assert, redundant `red -le 4`, OLD_BASE_COMMIT skip on shallow clones, `work_done` with unset `FROZEN_BASE_SHA`; K8 cost-tracker sink without fallback, advisory trim race, `/dev/shm` in `review-input.test.js`, config read per hook fire, band chip wiring (P7 body, alpha.2 by plan); K2 `set --level` drops init fields, engine unit order, init overwrites a malformed marker, empty `--review-families`, init flags without size, one tautological assert; K1 owner_u4 bare-form / negation, bug `replace` with a missing target, plan-review families without fallback; K3 golden case 13 comment, one backlog sidecar status line, graph re-read, semver build metadata, legacy suffixed effort; K4 results↔arm binding (BACKLOG), pack copies of unchanged files, freeze-pack ref label, declared amend-2/3 residuals, generic overlay (BACKLOG); K6 inventory bound slack (exact 689 pin covers it), urgent DB-migration bump not retroactive (consistent with §2.7 E1).

## Suite

Full `run.sh --parallel 4` at `3aae28a4` (run concurrently with the panel): 10/452 files red. Solo triage: 7 regressions → F5; 3 host-state (a stray empty `/tmp/.git` made every `/tmp` path look like a work tree: L1 import-aa ×22, qualification-feed-adopt, scorecard-tools r51/r52 — removed with owner approval, suites green after); `skill-onoff-generic` is the known host-dependent guard (same at base).

## Delta review of the fixes (`3aae28a4..0458c7bf`)

Same three seats, full delta (164 KB incl. the codex mirror), spec [`delta-spec.md`](delta-spec.md) listing each accepted finding and its commit. Verdicts: opus SHIP-AS-IS (1 🔵), GLM SHIP-AS-IS (3 🔵), MiniMax SHIP-AS-IS (none) — [`seats/D1-delta.*.json`](seats/).
- The first two dispatches were refused before spend by `check-blind-evidence.sh` (class C2): the spec said "Depth-0 verified the findings …" and "whether each fix is correct". Rephrased to neutral wording; nothing else changed.
- Two 🔵 stale index rows (probe-unknown "U0–U3 (U4 is the run's own stop)", finish-flow "urgent adds the post-finish review") were fixed in `8184a7b4` (docs only). The others stay here: `version_in_file` relies on callers' `[^0-9])` tail (both callers carry it, pinned by `semver.test.sh`); M CEO sessions no longer get the L/XL forcing-function finish row (finish-flow creates its own lite rows).
