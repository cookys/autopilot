# Verdict-bytes preservation — transport failure vs verified verdict bytes 分欄

> **Status**: ✅ Shipped in v2.34.33 — merged as `f98c7ea0` (was R3 FROZEN: G1 15 + G2 9
> findings all dispositioned at depth 0; G2 terminal at the two-generation cap —
> `evidence/.../g2-adjudication.md` is final plan authority)
> **Target version**: v2.34.33 (PATCH — hardening of existing rails, no new user-facing surface)
> **Size**: L-flow, M effort (BACKLOG「Reviewer transport exits can erase an otherwise valid fail-closed verdict」)
> **Branch**: `feat/v2.34.33-verdict-bytes-preservation`

## 1. Problem — three verified destruction points

A **complete, content-verified review verdict** can be destroyed by its transport, leaving only
a raw log a human must excavate:

1. **Shell rail, parse-position/exit class** — 2026-08-08: a real `VERDICT: SHIP-AS-IS` in an
   intact nonce-marker block discarded as `no_verdict` over prepended CC chrome; v2.34.7 fixed
   cc-shim only. Chrome-prepend or non-zero exit after a complete block still loses the verdict
   (`dispatch-review.sh:1012` start-anchor; six inline non-zero-exit emitters).
2. **Envelope rail, classification class** — a failed plan-review seat returns
   `parser_status:'not_attempted', payload:null` on every non-success classification
   (`plan-review-normalize.js:152-158`); bytes that DO exist are never parsed. G1 correction:
   the recorded 2026-08-20 incident shape is **0-byte stdout, no raw reference** (frozen in
   `plan-review-transport-fixes.test.sh`) — nothing to salvage there; this KR addresses the
   *bytes-exist-but-unparsed* variant (CONSTRUCTED, not incident-replay).
3. **Aggregation layer** — verified at `dispatch-plan-review.js:1584-1591`: when any REQUIRED
   seat exhausts, the artifact omits `reviewer_verdicts` AND findings — a COMPLETED seat's
   verdict (e.g. a minimax STOP) is destroyed by a *different* seat's transport death. This is
   the actual 2026-08-20 destruction point.

All three rails are **correctly fail-closed** — that must not change. Missing is the
observability half: no machine trace that content-verified verdict bytes existed, so each
incident costs a manual raw-log excavation with no integrity-checked home for the result.

## 2. Non-goals / invariants (frozen)

- **No parser relaxation for authority.** `status`, `verdict`, `findings`, `semantic_verdict`,
  exit codes, and every consumer-facing decision surface are byte-identical on all existing
  paths. Relaxing the authoritative parser reopens the prompt-echo hole the suite pins.
- **no_verdict / transport_exhausted stay fail-closed** everywhere (resolve-review-loop
  `--prior-status` cascade, qc-panel skip path, plan-review exit 4).
- **Salvage battery = the authoritative battery, extracted, not re-listed** (G1 VB1): the ONLY
  admissible weakenings are (a) the start-anchor → locator rule (G2 #8: exactly one exact-line
  derived BEGIN in the capture; FIRST exact-line derived END after it; missing END → null; END
  uniqueness NOT required), (b) the runner-exit-0 requirement. Every content check — leak scan,
  16 KB cap, single anchored VERDICT, FINDINGS line, fence-aware NO-FINDING-PROOF count, proof
  field-structure regex, tautology blacklist — applies to salvage via the same shared function.
- **Closed reader allowlist, mechanically guarded** (G1 VB2): `unratified` may appear only in
  producers, schemas, the pass-through validator, display-only projections, tests, and docs —
  enforced by a guard in `check-canonical-invariants.sh`, proven able to go red by a synthetic
  authority-reader fixture.
- **No salvage from contradicted or unbindable evidence** (G1 VB3): on the envelope rail,
  salvage requires `private_raw_reference` present AND digest == captured bytes;
  `raw_binding_mismatch` / `identity_mismatch` never salvage. (The shell rail is digest-free by
  construction — the dispatcher writes its own capture; no claim/verify split exists.)
- **No trust machinery** (ADR-0001): unratified fields are re-derivable observations (re-running
  the battery on the raw log reproduces them), not attestations.

## 3. Design

One concept, three surfaces: when transport fails after the model produced output, run the
SAME content-integrity battery over the captured bytes; only a full pass is recorded, in
explicitly non-authoritative `unratified_*` columns, next to the unchanged failure
classification. "Unratified" = content-verified, transport-unratified; consumers may not derive
authority from it (guarded, see §2).

### KR1 — shell rail (`scripts/dispatch-review.sh`)

- Extract the authoritative BLOCK_FILE battery (§2) into one shared function; the main rail
  keeps calling it with identical behavior (emit_no_verdict on first failure), salvage calls it
  in collect-mode.
- Unify ALL no_verdict emissions — `emit_no_verdict` plus the six inline printf sites
  (codex :662, grok :702, qoder :749, cc-shim :880, claude-native :908,
  anthropic-compatible :932) — into one funnel that takes the runner-specific **salvage capture
  path** explicitly (capture topology differs: PARSE_INPUT / RAW_LOG / KIMI_CLEAN /
  AGY_PARSED). Each branch keeps its exact error text, usage JSON, passive-capture call,
  status, and exit code.
- Salvage locates the block per the frozen locator (§2), then runs the full battery. Salvage is
  a **total no-op** unless the capture is readable AND non-empty AND both derived markers are
  passed explicitly as arguments (G2 #3 — no unset-global reads; four precondition-failure
  negative tests assert unchanged status/error/usage/exit). Result lands as ONE additive field:
  `"unratified_verdict": "SHIP-AS-IS" | "FIX-THEN-SHIP" | null`, emitted ONLY on no_verdict
  paths — the reviewed (:1180) and precondition emitters stay byte-identical (G2 #7). Findings
  recovery stays in `raw_log`.
- **Contract surfaces updated atomically in one commit** (G1 VB5 — the result contract is
  strict `additionalProperties:false`): `schemas/review-result.schema.json` (+ codex mirror via
  sync-all) gains `unratified_verdict` as an OPTIONAL nullable enum, non-null only with
  `status:no_verdict`; `src/runners/review.js` `REVIEW_RESULT_FIELDS` + validation admit the
  key, asserted never copied into `verdict`/`status`; review-runner tests keep
  unknown-keys-fail while admitting this key; round-trip assertion on a no_verdict artifact.
  `check-contract-schema.js` out of scope (reconciles the review-loop contract, per header).

### KR2 — envelope rail (`plan-review-normalize.js` + `dispatch-plan-review.js`)

- `normalizePlanReviewPayload` returns an additional `unratified` observation
  (`{ payload, parser_status } | null`) computed ONLY under this admission matrix (G1 VB3):

  | classification | admission |
  |---|---|
  | `timeout` / `exit_failure` / `quota` | reference digest matches bytes AND (`strict` parse OR `objectCandidates` finds exactly ONE complete valid object **with a clean scan tail** — depth 0, not inside a string, no open candidate at end (G2 #5: timeout IS the kill classification; complete-READY + truncated-STOP ⇒ null, pinned)) |
  | `interrupted` / `unavailable` | reference digest matches bytes AND `strict` parse only (no unique-extract — mid-flush truncation risk) |
  | `raw_binding_mismatch` / `identity_mismatch` | never |
  | empty or unreadable capture | never |
  | out-of-attempt / reused capture | never (G2 #0: each attempt requires a controller-allocated, newly created exclusive capture; the seat loop asserts the reference locator belongs to THAT attempt; stale-capture fixture pinned) |

  Authoritative fields (`transport_status`, `semantic_status`, `parser_status`, `payload`)
  unchanged on every path.
- Seat loop: every attempt record gains controller-side-bound salvage provenance (attempt,
  target_id, family, request digest, raw digest — recorded by the code that parsed those exact
  bytes; NO in-band payload-contract binding, which would add a model-compliance failure mode).
  **Carry rule frozen** (G2 #4): per-attempt records keep every admitted salvage; seat summary
  = null if zero salvages; `unratified_conflict` if ≥2 distinct payloads (canonical
  verdict+findings); else that single payload with the provenance of the latest attempt that
  produced it. No strict-only promotion.
- **Aggregation preservation** (G1 VB5, verified): the `required_seat_transport_exhausted` and
  `panel_family_diversity_exhausted` artifacts retain completed-seat observations (seat,
  target, attempt, transport provenance, parser status, verdict, findings) in an explicitly
  non-semantic field; `semantic_verdict:null`, `verdict:'CONDITIONAL'`, exit 4 unchanged.
  Panel manifest gains a boolean observation marker; `dispatch-status --panel` renders it.
  **KR2 strict surfaces named** (G2 #2/#7): attempt-record keys ride the schema-free
  `attempts.items` (`plan-review-artifact.schema.json:73-77`, verified `{type:"object"}`); the
  exhaustion observation field enters `schemas/plan-review-artifact.schema.json` + codex mirror
  in the same commit as the emitter, with old-artifact AND new-artifact compatibility tests;
  the panel progress manifest has no strict schema (recorded at implementation with evidence,
  not assumed). Artifact round-trip test.

### KR3 — fixtures with provenance + bidirectional pinning

Fixture bytes are frozen BEFORE coding, each with provenance + SHA-256; a shape not
recoverable from a stored artifact is explicitly labeled **CONSTRUCTED**, never presented as
incident bytes (G1 VB4).

| Fixture | Shape | Provenance | Expected |
|---|---|---|---|
| A | multi-line chrome prepended + intact valid block, rc=0 | G2 #6: live reproduction FIRST (`claude -p`, non-Anthropic model, suppression env unset → freeze exact prefix bytes + SHA-256 in evidence dir); if irreproducible, CONSTRUCTED-labeled multi-line prefix (blank lines + context-window/unknown-model wording), never called the 8/8 incident shape. Dead-gate green runs against the frozen file | `no_verdict` + `unratified_verdict` present |
| B | complete block printed, then runner rc≠0 (on a currently-inline runner) | CONSTRUCTED | `no_verdict`, exit 1 + `unratified_verdict` present |
| B2 | truncated block (no END marker), rc≠0 | CONSTRUCTED | `unratified_verdict:null` |
| C-incident | 0-byte stdout, no raw reference, seat killed | frozen 2026-08-20 shape (plan-review-transport-fixes.test.sh) | classification preserved + `unratified:null` (negative control) |
| C-complete-timeout | seat killed by the PRODUCTION timeout path — deterministic stub author writes+flushes one complete payload then hangs; real dispatcher kills it; resulting envelope/capture/reference frozen (SHA-256) before salvage exists (G2 #1) | production-path generated | `timeout` preserved + `unratified.payload` present |
| D | `timeout` + digest MISMATCH + valid payload in raw | CONSTRUCTED | `timeout` preserved + `unratified:null` |
| E | block containing prompt-framing leak lines, rc≠0 | CONSTRUCTED | `unratified_verdict:null` |
| F | TWO valid BEGIN marker blocks in capture | CONSTRUCTED | `unratified_verdict:null` |
| G | SHIP block whose NO-FINDING-PROOF is tautological (`checked=diff; evidence=none; conclusion=looks good`), rc≠0 | CONSTRUCTED | `unratified_verdict:null` (full-battery proof) |
| H | aggregation: completed STOP seat + required seat exhausted | CONSTRUCTED (replays the 2026-08-20 aggregation class) | exit 4 + completed-seat observation retained |
| I | multi-attempt conflict: attempt-1 STOP, attempt-2 READY, both valid | CONSTRUCTED | `unratified_conflict`, no summary |
| J | attempt-1 salvaged STOP, attempt-2 no salvage | CONSTRUCTED (G2 #4) | seat summary = STOP |
| K | complete READY object + truncated STOP object in one timeout capture | CONSTRUCTED (G2 #5) | `unratified:null` |
| L | attempt-2 timeout referencing attempt-1's stale capture | CONSTRUCTED (G2 #0) | attempt-2 `unratified:null` |

Bidirectional pinning (evidence-discipline §13):
- **Green**: A/B/C-complete-timeout/H produce the columns.
- **Red (dead-gate)**: one RECORDED mutation per rail — revert the shell salvage call; revert
  the normalize salvage branch — named per call site, evidence under
  `docs/plans/evidence/2026-08-21-verdict-bytes-preservation/`, each turning named assertions
  red.
- **Authority**: consumers fed unratified-bearing artifacts still fail closed
  (resolve-review-loop cascade, qc-panel skip, plan-review exit 4 — one assertion each); a
  synthetic consumer reading `unratified_verdict` as verdict turns the
  check-canonical-invariants guard red (recorded); `src/runners/review.js` never copies the
  field into `verdict`/`status` (assertion); emitted no_verdict JSON validates against the
  updated schema via `validate-json-schema.js` (first runtime consumer of
  review-result.schema.json — closes its zero-loader gap).

## 4. Execution

Single admitted Mission deliverable. Order: KR2 (Node, test-first) → KR1 (shell) → KR3 woven
throughout → docs/version. Tests extend `hooks/tests/dispatch-review.test.sh`,
`plan-review-transport-fixes.test.sh`, `dispatch-plan-review.test.sh`, review-runner tests.

## 5. Verification contract

```bash
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/plan-review-transport-fixes.test.sh
bash hooks/tests/dispatch-plan-review.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/run.sh --parallel 8          # full suite, no regression
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh
```

Red-green: fixture assertions authored first, run against base (fail: no unratified fields),
green after implementation. Recorded dead-gate mutations per KR3.

## 6. Scope boundary — frozen rail inventory (G1 VB5)

Verdict producers and their destruction boundaries:

| Rail | Status | Reason |
|---|---|---|
| `dispatch-review.sh` (shell result contract) | **in scope** (KR1) | producer; six inline destroy sites + funnel |
| plan-review normalize + panel aggregation | **in scope** (KR2) | producer; classification + aggregation destroy points |
| engine implement-review | transitively in scope | consumer of the KR1 result contract via `parseReviewOutput` — handled by schema pinning, no producer change |
| qc-panel judge seats | out of scope | different verdict.txt contract; no recorded residual on this class |
| qualification-review-provider | out of scope | own purpose-bound JSON contract; exam rail, not review rail |
| adjudicate-findings | out of scope | post-verdict intake, not a transport |

Also out of scope: automated promotion of unratified to authority (human adjudication only);
retroactive re-classification of historical artifacts; a standing acceptance-search binding
the inventory (the reader-allowlist guard already fails new consumers; a new verdict TRANSPORT
is an engine-onboarding event — BACKLOG trigger instead); parser relaxation anywhere.

## Review Loop History

- G1 (sol max + grok xhigh): STOP+STOP, 15 findings, all dispositioned at depth 0
  (`evidence/2026-08-21-verdict-bytes-preservation/g1-dispositions.json`); repairs folded.
  Two sub-repairs rejected with rationale there: in-band attempt binding; acceptance-search.
- G2 (same panel): STOP+STOP, 9 findings, terminal at the two-generation cap; ALL accepted at
  depth-0 terminal adjudication (`evidence/.../g2-adjudication.md` — final plan authority) and
  folded above. Growth 1.495 with warning carried honestly. Plan FROZEN as R3.
