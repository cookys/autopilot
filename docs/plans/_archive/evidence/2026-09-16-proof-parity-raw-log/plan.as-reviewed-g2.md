# Review proof contract parity across bash and Node, and a rejected reviewer envelope keeps its raw_log

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `proof-parity-raw-log-2026-09-16`) — the first of two cut from BACKLOG row "Managed rail (cuda P1):
> GLM tautological no_finding_proof stops full_diff_review; final panel seat transport_failed" (fired
> 2026-09-16). This plan covers defects (ii) the proof validator false positive and (iii) `raw_log`
> lost on a validator rejection. Defect (i) — the blind final panel refusing a pinned codex seat after
> the campaign spent — is the second deliverable (pre-spend admission), planned separately.

## 0. What is actually broken (verified 2026-09-16, base `0e3ea3cc`)

### 0.1 Two validators, two grammars

- bash battery (`scripts/dispatch-review.sh` ~575): `^checked=(.+)[[:space:];,.]evidence=(.+)[[:space:];,.]conclusion=(.+)$`
  — any single punctuation/space separator between the labelled fields (added 2026-08-15 because
  kimi separated fields with a period). Then the tautology blacklist on each trimmed field.
- Node (`src/runners/review.js:51` `isValidNoFindingProof`): `^checked=(.+);\s*evidence=(.+);\s*conclusion=(.+)$`
  — semicolons only. Same blacklist.
- The engine consumes the shell's `reviewed` envelope through `parseReviewOutput` (`review.js`),
  so a proof the shell accepted with `.`/`,`/space separators throws
  `review output JSON no_finding_proof must contain non-tautological checked, evidence, and
  conclusion fields` — the same message the blacklist path uses. The operator reads "tautological"
  for a concrete proof. Reproduced locally: `checked=diff lines 1-40. evidence=ran tests.
  conclusion=nothing to fix` passes the battery and is rejected by Node with that message.
- Field evidence: cuda saw it three times on GLM-5.2 (r2/r5/r7); revival.3d saw it three times on
  `claude-fable-5` via `claude-native`, and the SAME diff with the SAME seats dispatched manually
  through `dispatch-review.sh` (outside the engine, no Node validator) passed every time. The only
  divergence between the two paths is the Node grammar.

### 0.2 A validator rejection discards the reviewer's text

`dispatchReviewJson` (`review.js` ~262-290): when `parseReviewOutput(stdout)` throws, the result is
`{ result: null, parseError }`. The engine (`autopilot-engine.js` ~3363-3395 `reviewResultBlocked`)
turns that into `status: 'blocked', phase: 'dispatch_review', reason: <validator message>, review:
null`; the ledger entry `dispatch_review blocked` carries runner/model/exit_status only. The shell
envelope's `raw_log` path — the only pointer to what the reviewer actually wrote — is in the discarded
JSON. revival.3d: `grep -oE '"no_finding_proof":"[^"]*"'` over three engine logs — zero hits; the
rejected proof text is nowhere. The final-panel seat receipt (`autopilot-engine.js` ~4986
`finalPanelSeatReceipt`) has no field for it either (closed key set, `campaign-composition.js`
`FINAL_PANEL_SEAT_KEYS`, `schemas/implementation-campaign-receipt.schema.json`).

## 1. Ruling and shape

1. **One proof grammar, two independent validators, one vector table.** Both validators accept
   one-or-more separator characters from `[space ; , .]` between the ordered labels:
   bash `^checked=(.+)[[:space:];,.]+evidence=(.+)[[:space:];,.]+conclusion=(.+)$`, Node
   `/^checked=(.+)[\s;,.]+evidence=(.+)[\s;,.]+conclusion=(.+)$/u`; captures are trimmed and the
   unchanged blacklist is applied to each field. Two DISTINCT failures on both sides: a **shape**
   failure (labels missing/reordered, an empty field, an unsupported separator such as `|`) and a
   **semantic** failure (a field normalizes to a blacklist entry). Precedence: after the ordered-label
   match, any capture that trims to empty (e.g. `checked=; evidence=…` where the greedy capture is
   only `;`) is a SHAPE failure on both sides — bash checks emptiness explicitly before its
   blacklist loop, Node does the same — so the `''` blacklist entry is unreachable and stays only as
   a guard. Node's messages become
   `review output JSON no_finding_proof must contain the ordered checked, evidence, and conclusion
   fields separated by space, ';', ',' or '.'` and `… contains a tautological checked, evidence, or
   conclusion value`; the bash battery's two `BATTERY_FAIL_REASON` strings already distinguish them
   and are unchanged except the `+` quantifier. No producer-side normalization to `;`: Node is an
   independent boundary and must accept the contract the shell declared.
2. **Constrained salvage of `raw_log`.** On a `parseReviewOutput` failure `dispatchReviewJson`
   keeps `result: null` and `parseError`, then — schema-lenient, never text-lenient —
   `JSON.parse(stdout.trim())`; if that yields an object whose `raw_log` is a non-empty string, the
   result gains `salvaged: { runner, model, raw_log }` where `runner`/`model` come from the
   invocation args (not the rejected envelope). Nothing else is salvaged (no status, verdict,
   findings, proof, usage, unratified_verdict). Malformed JSON or a non-string/empty `raw_log` →
   no `salvaged` key.
3. **Propagation.** The engine's blocked review record (`autopilot-engine.js` ~3378) gains
   `raw_log: reviewResult.salvaged ? reviewResult.salvaged.raw_log : null`, the ledger entry
   `dispatch_review blocked` records the same, and `performReview`'s non-reviewed outcome exposes it
   as top-level `raw_log` next to `reason` (the composition sees `outcome.raw_log`; the seat receipt
   reads THAT field, never a nested raw dispatch path). The final-panel seat receipt gains an OPTIONAL `raw_log` key:
   present (non-empty string) only on a failed seat whose salvage succeeded; absent otherwise
   (successful receipts keep their exact shape and digest); when present it is part of the body
   digested into `receipt_digest`. `FINAL_PANEL_SEAT_KEYS` validation becomes "exact keys, with
   `raw_log` optional"; the JSON schema adds `raw_log` as an optional non-empty string.
4. Authority is untouched: `result`, `status`, `verdict`, `review_digest` decide; a seat with a
   salvaged `raw_log` is still `no_verdict`/`parser_failed`, excluded from `final_panel_count`.

## 2. Changes by file

- `scripts/dispatch-review.sh` (+ mirror): battery regex gains `+` on both separator classes; comment
  updated; messages unchanged.
- `src/runners/review.js` (+ mirror): `isValidNoFindingProof` → returns a classification
  (`ok` / `shape` / `tautology`) used by `parseReviewOutput` for the two messages; `dispatchReviewJson`
  salvage block (§1.2).
- `src/engine/autopilot-engine.js` (+ mirror): blocked review record + ledger entry + performReview
  outcome carry `raw_log` (§1.3); `finalPanelSeatReceipt` adds `raw_log` when the outcome's raw
  dispatch result has `salvaged.raw_log`.
- `src/engine/campaign-composition.js` (+ mirror): `FINAL_PANEL_SEAT_KEYS` validation accepts the
  optional `raw_log` (non-empty string when present) — nothing else changes there.
- `schemas/implementation-campaign-receipt.schema.json` (+ mirror): optional `raw_log`
  (`{ "type": "string", "minLength": 1 }`) on the final-panel seat definition, `additionalProperties:
  false` kept.
- Tests (every change-pinning assertion carries `# RED at base 0e3ea3cc: <observed>` in its block
  header; preservation guards labelled `(preservation, green at base)`; stubs only):
  - `hooks/tests/review-runner.test.sh`: **shared vector table** (one heredoc of `proof|expected`
    rows) driven through BOTH the bash battery (via `dispatch-review.sh` with a stub runner whose
    output carries the proof) AND `parseReviewOutput`. Valid rows: `;`, `.`, `,`, space,
    mixed-punctuation+space separators, a `;` inside a substantive field. Invalid rows: missing
    label, reordered labels, `|` separator, empty value per field (class `shape`), every blacklist entry substituted
    into each of the three fields with the other two substantive. Assert per row: both validators
    agree (RED at base: the `.`/`,`/space rows disagree), the Node message class is `shape` vs
    `tautology` as the row says (RED at base: one message for both), and a `;` inside a field keeps
    the whole capture intact (preservation). Salvage: a syntactically valid envelope rejected only by
    proof validation → `result === null`, `parseError` non-null, `salvaged.raw_log` equals the
    envelope's path exactly, `salvaged.runner/model` equal the invocation args even when the envelope
    lies (RED at base: no `salvaged`); malformed JSON → no `salvaged`; `raw_log: ""`/non-string →
    no `salvaged`; a rejected envelope claiming `SHIP-AS-IS` copies no verdict/status/findings
    (authority guard).
  - `hooks/tests/dispatch-review.test.sh`: the battery accepts `.`/`,`/space/mixed separated proofs
    and a doubled separator run (the hand pins the observed base state for the run case), rejects
    `|` with the shape message and a blacklist value with the tautology message (preservation).
  - `hooks/tests/implementation-campaign-routing.test.sh`: engine block — a review dispatcher stub
    that emits a shell-shaped envelope with a proof the Node grammar rejected at base
    (`.`-separated) → at head the review is `reviewed` (RED at base: `dispatch_review blocked` with
    the tautology message); a second stub emitting an envelope with a genuinely tautological
    conclusion → blocked with the tautology message AND the blocked record + ledger entry carry the
    envelope's `raw_log` (RED at base: `raw_log` absent), and `performReview`'s non-reviewed outcome
    (captured via the composition adapter seam) exposes top-level `raw_log` (RED at base); final
    panel: one seat's stub emits a
    rejected envelope → that seat's receipt has `status: 'no_verdict'` (or `parser_failed` per the
    existing mapping), `verdict/review_digest null`, `raw_log` = the path, excluded from
    `final_panel_count`, the panel blocks (RED at base: no `raw_log` key); the other seats' receipts
    have NO `raw_log` key and their digests are unchanged from base (preservation).
  - `hooks/tests/implementation-campaign-receipt.test.sh`: a v1 seat receipt without `raw_log`
    validates (preservation); a failed seat receipt with `raw_log` validates and tampering the path
    changes/breaks `receipt_digest` (RED at base: schema rejects the key); `raw_log: ""` is rejected;
    an unrelated extra key with a recomputed valid digest is rejected by BOTH the composition seat
    validation and the JSON schema (preservation, green at base).
- Docs: `docs/BACKLOG.md` cuda P1 row: Status stays `fired` (deliverable 2 pending), Context gains
  "(ii)+(iii) shipped v2.36.57: Node grammar aligned, raw_log salvaged" and a one-line pointer to the
  second plan; `skills/l5/references/hetero-impl-loop.md` step 11 fixed list gains "proof grammar
  parity + raw_log on rejected envelopes v2.36.57" (+ mirror). `CHANGELOG.md` is NOT sealed.

### 2.5 Sealed `output_paths` (exact)

```
scripts/dispatch-review.sh
platforms/codex/plugin/scripts/dispatch-review.sh
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/review-runner.test.sh
hooks/tests/dispatch-review.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```

## 3. Out of scope

- Defect (i) — pre-spend admission of blind-incompatible final-panel seats (second deliverable).
- Any change to the blacklist contents, to the SHIP-AS-IS/no-proof rule, or to `unratified_verdict`.
- Journaling reviewer text into the campaign ledger; `dispatch-anthropic-review.js` (its own
  validator is producer-side and already label-anchored — verify only, do not edit).
- `scripts/next-touch-validation.js` / `admit-backlog-follow-ups.js` (they pass seat receipts through
  unchanged; the schema change is what admits the key).

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `grammar-parity` | every row of the shared vector table yields the same accept/reject in bash and Node; `.`/`,`/space/mixed separators accepted by both | review-runner + dispatch-review suites |
| `distinct-failures` | shape failures and tautology failures produce different messages on both sides | same |
| `raw-log-salvaged` | a proof-rejected envelope yields `result:null`, `parseError`, `salvaged.raw_log` exactly; no other field salvaged; malformed JSON salvages nothing | review-runner suite |
| `raw-log-propagated` | engine blocked review record, ledger entry and failed final-panel seat receipt carry `raw_log`; successful receipts unchanged | routing + receipt suites |
| `no-regression` | `review-runner`, `dispatch-review`, `autopilot-engine`, `implementation-campaign-routing`, `implementation-campaign-receipt`, `qc-panel-honesty`, `status-task`, `implementation-campaign-state` green; `check-canonical-invariants.sh`; `check-js-syntax.js`; `sync-codex-plugin-skills.sh --check`; `check-backlog-entries.js` | suite output |
| `scope-integrity` | `git diff --name-only 0e3ea3cc HEAD` ⊆ §2.5 (plus committed plan/mission docs); `src/engine/implementation-campaign.js`, `src/engine/campaign-intake.js`, `src/campaign/cli.js` byte-identical to `0e3ea3cc` | command output |

## 5. Dogfood proof (depth-0, after merge)

The next managed campaign's in-rail review on this host (GLM-5.2 or MiniMax) with a `.`-separated
proof is `reviewed`, not `dispatch_review blocked`; and a deliberately tautological stub run shows
`raw_log` in the blocked record. cuda/revival.3d re-run on their side is theirs to report.

## 6. Follow-ups filed, not done here

- Defect (i): `final_panel_seat_blind_incompatible` pre-spend admission + resolver ⚠ (deliverable 2);
  codex containment (bwrap) qualification spike so a codex seat can become blind-capable.
- Reviewer text into the campaign ledger on rejection (bounded), if operators still need it after
  `raw_log` lands.

## Review log

- Design consult 2026-09-16 (codex gpt-5.6-sol on the raw-prompt rail; evidence
  `docs/plans/_archive/evidence/2026-09-16-proof-parity-raw-log/consult-codex-answer.md`): recommends two
  deliverables (A1 alone; B+C together), one-or-more separator grammar on both sides with distinct
  shape/semantic failures and a shared vector table, schema-lenient salvage with runner/model from
  the invocation, optional `raw_log` on the failed seat receipt with old receipts still valid; names
  the red-first assertions folded into §2.
- Plan hetero loop G1 2026-09-16 (GLM-5.2 READY, gpt-5.6-sol STOP 3 blockers; evidence `g1-*`): empty-field
  precedence undefined → shape-before-blacklist on both sides; performReview top-level `raw_log` had no
  assertion → added; unknown-key closure had no preservation case → added. All accepted and folded.
