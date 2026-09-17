# Evidence — mission `blind-review-cleanroom-intake-2026-09-17` (v2.36.63; blind review redesign cut 1b-B)

- Plan: `../../2026-09-17-blind-review-cleanroom-intake.md` (base `d7912c7e` = v2.36.62; sealed at `130b97a8`).
  `base-suites-d7912c7e.txt`: twelve §4.1 commands green at base, detached checkout.
- Unknown-escalation: `ladder-classify.json` U0 (coined names already had repo hits) — no consult.
- Plan hetero loop (GLM-5.2 anthropic-compatible + claude-fable-5-1 claude-native): G1 `g1-*` (10 folded,
  `plan.as-reviewed-g1.md`), G2 `g2-*` terminal at the cap (7 folded, `plan.as-reviewed-g2.md`; the G1 fold had
  contradicted frozen R2 and was walked back: `unknown` = absent launcher, shadow-only). Receipts rc 0. Growth 1.38×.
- Campaign attempt 1 (`grant.json`, `impl-brief.md`, `impl-run1-attempt1-blocked.json`; rails in `scratch/`):
  hand cursor-grok-4.6-low `29d852e4`, 71 min, 16 files ⊆ §2.5 (+1166/−88); in-rail scope passed, verification
  passed (12 commands, 22 min, detached), then the in-rail MiniMax-M3 review returned `no_verdict` — `NO-FINDING-PROOF
  contains a tautological checked, evidence, or conclusion value` (raw `review-minimax-r1-raw.log` holds a full
  SHIP-AS-IS block; instrument fault, not a vote). The engine reported `durable_wait:true, resumable:true` but
  `--resume` (`impl-run2.json`) was refused: `campaign resume from REVIEWING is unavailable until phase-aware
  dispatch ships` — REVIEWING is not in the durable-wait set (`campaign-intake.js:770-788`). Rail defect (BACKLOG
  row). Degraded per doc: `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- Depth-0 at `29d852e4`: scope ⊆ §2.5, `src/engine/autopilot-engine.js`/`src/runners`/`dispatch-review.sh`/
  `scripts/lib`/`schemas`/`bin` byte-identical; §4.1 twelve on a scratch branch: `head-suites-29d852e4.txt`.
- Second-family reviews of `130b97a8..29d852e4` (no path filter, spec = plan): GLM-5.2 anthropic-compatible
  (`review-glm-r2.json`, raw `review-glm-r2-raw.log`) → `no_verdict` framing fault (a sentence + code fence after the
  END marker; the block itself is SHIP-AS-IS with a full proof — recorded, not counted); claude-fable-5-1 claude-native
  (`review-claude-r2.json`, raw `review-claude-r2-raw.log`) → FIX-THEN-SHIP, 1 🟡 MUST-FIX + 2 🔵.
- Adjudication: ✅ 🟡 `probe-step-dropped-on-reject` re-derived (`cleanroomProbeSteps.push` guarded by
  `status !== 'rejected'`; the cleanroom-unavailable and unqualified returns sent `steps: [rejection]`) → repaired at
  depth-0 on the mission branch (`af1879cb`): every decision is a step; both returns spread the probe steps;
  RED-first case in the routing suite (rejected stub launcher → step present with `launcher`/`deny_paths`); mirror
  synced. 🔵 probe-before-none-refusal: the plan fixes the loop order (tier/probe → qualification); an extra spawn on
  a roster that is refused anyway has no correctness effect — follow-up. 🔵 head-evidence-not-supplied: depth-0's
  own run is `head-suites-af1879cb.txt` (the reviewer cannot see evidence dirs by design).
- Plan §5 dogfood (`dogfood-resolver.txt`, `dogfood-probe.txt`): the resolver with a codex qc seat in a scratch
  config emits the cleanroom advisory into `capability_warnings[]`, no refusal; the REAL `defaultCleanroomProbe` on
  this host → `ready` with the launcher JSON and `deny_paths` = repo, git common dir, HOME, contract dir; with
  `bwrap: /nonexistent/bwrap` → `rejected exit 2: bwrap not found …`; with a missing launcher → `unknown` (shadow).
  The pin swap (§1.5) is NOT done: no live codex verdict yet (quota returns 2026-09-19 16:26) — BACKLOG row.
- Merge `bc4ea99e`; `integration-record.json`, `reap-*.json`, `residue-receipt.json` = closeout.
