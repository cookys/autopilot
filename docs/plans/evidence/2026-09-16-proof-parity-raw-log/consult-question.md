Design question (autopilot managed campaign rail; bash scripts/dispatch-review.sh, Node
src/runners/review.js, src/engine/autopilot-engine.js, src/engine/campaign-intake.js). Three defects
from one peer report (cuda P1, 2026-09-16) plus one local reproduction; the owner wants them worked
as one or two /l5 deliverables. Recommend the split and the shape of each fix.

## Defect A — final panel refuses a pinned codex seat AFTER the whole campaign ran
`dispatch-review.sh:288-293`: when `AUTOPILOT_BLIND_DISCOVERY=1` only
`qoderclicn|cc-shim|claude-native|anthropic-compatible` are allowed; anything else dies with
`blind review requires an enforceable no-tools runner profile (got: codex)`. The engine sets
`blindDiscovery: true` for EVERY managed review dispatch (`src/runners/review.js` ~195-215 copies the
diff/spec into a 0700 scratch cwd and exports the env; `autopilot-engine.js` ~4839 full-diff, ~9683
final panel). The rationale (file header ~95-125 for opencode/kimi/cursor/grok): those runners can
execute tools and read the real repo from the scratch cwd, so outcome-blinding (references/
blind-dispatch.md: the reviewer must not see prior verdicts/evidence) is not enforceable. codex
`exec --sandbox read-only` can still read the whole filesystem.
Measured: the operator's standing qc_panel pin is `[gpt-5.6-sol/codex, GLM-5.2/cc-shim,
MiniMax-M3/cc-shim]` (v2.36.46 lets pins admit seats). Intake accepts the roster
(`campaign-intake.js` ~1413-1440 checks only qualification/pins), the campaign runs to the end
(implement, verify, review, full_suite, adjudicate, convergence) and only then the codex seat is
`transport_failed` → `final_panel_seat_transport_failed`, panel 2/3, campaign blocked. Seen on cuda
(fleet-comms, twice) and on this host (campaign C today). cuda's manual `dispatch-review.sh --runner
codex --model gpt-5.6-sol` (no blind env) works every time.
Options:
 (A1) Pre-spend: intake refuses a qc_panel seat whose runner is not in the blind allowlist with a
      remedy message (pin a blind-capable seat or drop it), the same class as
      `final_panel_seat_unqualified` (pre-claim, no attempt burned). Also
      `resolve-review-loop.sh --check-scorecard` prints the ⚠ so the operator sees it before
      /l5. No runtime behaviour change for the final panel itself.
 (A2) Make codex blind-capable: run the codex seat inside `bwrap` with only the scratch cwd, the
      codex binary/node runtime and `~/.codex` (auth/config) bound, network kept (API), like the
      existing agy bwrap in dispatch-review.sh (~1400-1420). Enforceable no-repo-access; keeps the
      operator's pin useful; bigger surface (codex needs its own config dir, the CLI may need /proc,
      /dev, TLS certs; must be probed live).
 (A3) Per-seat operator knob `blind: advisory` recorded on the pin: the seat runs non-blind and the
      final_panel_seat receipt carries `blind_discovery: false`; the panel still counts it.
      Weakens the integrity property on the operator's explicit say-so.
Question A: which option(s) ship now, in what order? If (A1) now and (A2) as a spike, say what the
spike must probe. Name the concrete failure (A1) alone leaves (an operator who pins codex simply
cannot run a managed campaign at 3 seats).

## Defect B — `no_finding_proof` validator false positive
Two validators disagree on the field separator. bash battery (`dispatch-review.sh` ~575):
`^checked=(.+)[[:space:];,.]evidence=(.+)[[:space:];,.]conclusion=(.+)$` — any punctuation/space
separator, added 2026-08-15 because kimi separated fields with a period. Node
(`src/runners/review.js:51` `isValidNoFindingProof`): `^checked=(.+);\s*evidence=(.+);\s*conclusion=(.+)$`
— `;` only. Both share the same tautology blacklist. The engine consumes the shell's `reviewed`
envelope through `parseReviewOutput` → the Node regex; a proof the shell accepted (labels present,
non-`;` separators) throws `review output JSON no_finding_proof must contain non-tautological
checked, evidence, and conclusion fields` — the same message the blacklist uses, so the operator
reads "tautological" although the proof is concrete. cuda saw this three times on GLM-5.2 (r2/r5/r7);
revival.3d (cuda) then reproduced it three times with `claude-fable-5` via `claude-native` — a
different family — and reports that the SAME diff with the SAME seats dispatched manually through
`dispatch-review.sh` (outside the engine) passed the proof every time. The rejected proof text was
never logged by the engine (Defect C). The separator mismatch is the only divergence between the
two validators, so it is the prime suspect.
Fix shape: one label-anchored regex shared by both (Node adopts the bash form), distinct error
messages for "labels/separators missing" vs "tautological value", and a unit table of proofs that
must agree between bash and Node (`;`, `.`, `,`, space separators; a `;` inside a field value;
each blacklist entry per field).
Question B: agree on the shape? Should Node keep a stricter form for any reason (e.g. the review
JSON is machine-emitted by the shell and could be normalized there instead)?

## Defect C — a validator rejection loses `raw_log`
`dispatchReviewJson` (`src/runners/review.js` ~262-290): when `parseReviewOutput(stdout)` throws,
the result is `{ result: null, parseError }`; the engine turns that into `no_verdict` with the
validator message as reason and NO `raw_log` (the shell's envelope carried it in the discarded
JSON). The operator cannot find the reviewer's text (cuda: "no_verdict result omits raw_log").
Fix shape: on parseError, attempt a lenient `JSON.parse(stdout)` and carry `raw_log` (and
`runner`/`model`) as `salvaged` fields on the dispatch result; the engine's no_verdict outcome and the
final-panel seat receipt include `raw_log` when present. No change to authority: `result` stays null.
Question C: agree? Any consumer that treats the presence of `raw_log` as evidence of a verdict?

## Split
Question D: one deliverable (A1 + B + C, all pre-spend/observability, ~4 files) or two (A1 alone;
B + C together)? Both B and C touch `src/runners/review.js`; A1 touches `campaign-intake.js` and
`resolve-review-loop`. Name the verification suites you would expect (hooks/tests/
implementation-campaign-routing.test.sh, review-runner*.test.sh, dispatch-review.test.sh,
resolve-review-loop.test.sh) and the red-first assertions that discriminate each fix from a
message-only patch.
Answer with a recommendation and precise assertions; do not emit a ship/no-ship verdict.
