Design consult (autopilot managed campaign rail; Node engine + bash dispatch scripts). The owner asks:
redesign the "blind review" mechanism so the pipeline runs SMOOTHLY and FAST while still achieving
the purpose. Recommend a concrete design; do not emit a ship/no-ship verdict.

## What exists today

The managed rail (`engine implement-review`) dispatches an implementer, then reviews the diff
twice: an in-rail full-diff review (one seat) and a terminal "final panel" (min 3 seats, ≥2 model
families, union-on-verified-critical). Every managed review dispatch runs in BLIND mode
(`src/runners/review.js` copies the diff+spec into a fresh 0700 scratch cwd and exports
`AUTOPILOT_BLIND_DISCOVERY=1`); `scripts/dispatch-review.sh` then refuses any runner outside
`qoderclicn|cc-shim|claude-native|anthropic-compatible` ("blind review requires an enforceable
no-tools runner profile") because those four are prompt-only transports, while codex / grok / cursor
/ kimi / opencode / agy CLIs can execute shells and read the real repository from the scratch cwd
(codex `--sandbox read-only` still reads the whole filesystem; opencode `--agent plan` was probed
running `hostname`).

Purpose of blinding (references/blind-dispatch.md, backed by real incidents): outcome-blinding —
a reviewer must not see prior verdicts, other seats' outputs, evidence directories, or the
implementer's self-attestations, otherwise seats collapse into one opinion and "I already tested
it" claims get trusted. ADR-0001 (verification over attestation) says a reviewer's verdict is a
claim until depth-0 re-derives it; the rail already re-runs the sealed verify command itself.

Measured costs of the current design (2026-09-16):
- The operator's standing final-panel pin is [gpt-5.6-sol/codex, GLM-5.2/cc-shim, MiniMax-M3/cc-shim];
  codex is not blind-capable, so every managed campaign on that host either died at the final panel
  after a full hour (before today) or is now refused at intake (v2.36.58) until the pin changes.
- Manually dispatched non-blind reviews (codex reading the repo, running tests) are what actually
  catch the deep defects — today codex found two tautological tests by reading the repo, which a
  diff-only blind seat cannot do. Blind mode disables the strongest review mode.
- Blinding is enforced on the RUNNER (tool-capable vs prompt-only), which is a much coarser knob than
  the goal (don't see other conclusions); the diff itself still carries commit messages, comments,
  test names — the biggest leakage surface is not blocked anyway.
- Half the operator's model inventory (codex, grok, cursor, kimi, opencode, agy) is excluded from
  the final panel; the remaining prompt-only seats (MiniMax, GLM) are the ones with the worst
  format-fault and false-positive rates measured this week (REVOKED-duplicate ids, tautology parser
  false positives, transport timeouts).
- Wall clock: a campaign spends ~40 min implementing, ~40 min running the verification suites twice
  (verify + full_suite), then review + 3-seat panel; a late panel refusal wastes all of it.

## Options on the table (from earlier consults)
A2: contain codex in bwrap with only the scratch inputs, runtime, TLS/DNS and a sanitized ~/.codex
    view mounted; prove no repo/home//tmp//proc reach, no shell/git/curl/MCP re-acquisition, nested
    sandbox behaviour, timeout/raw_log parity; only then allow codex in blind mode. Big spike.
A3: per-seat operator knob `blind: advisory` — seat runs non-blind, receipt carries
    blind_discovery:false, panel still counts it. Rejected by one consult as weakening the panel's
    meaning; a variant: advisory seats never count toward min_panel_size.
Drop blinding for the final panel: rely on ADR-0001 re-derivation; accept self-attestation leakage.

## Questions
1. What is the smallest redesign that keeps the PURPOSE (no cross-seat contamination, no trusting
   self-attestations) but stops enforcing it via "prompt-only runners"? Consider: blinding the
   INPUT instead of the runner (a clean detached checkout of the candidate commit with evidence
   dirs, prior receipts, .git/autopilot and other seats' outputs removed or unreadable; the reviewer
   gets tools but nothing to copy from); redaction of the diff/spec packet (strip implementer
   self-attestations, prior-round text); ordering (seats run in parallel from the same packet so
   none can see another's output); a "no-tools" tier vs "tools-in-clean-checkout" tier both
   counting as independent seats.
2. Where should the gate live so a bad panel configuration fails in seconds, not after an hour
   (intake? resolver? both?) — and should min_panel_size / family rules be satisfiable by mixing
   tiers?
3. What would you cut to make the whole managed loop faster without losing the property that
   verification is re-derived by depth-0 (e.g. run the verification suites once, not twice; run the
   three panel seats in parallel; skip the in-rail single-seat review when the final panel runs
   anyway)?
4. Give the migration path from today's code: the exact modules to change
   (`src/runners/review.js` blind cwd; `dispatch-review.sh` runner gate; `campaign-intake.js` seat
   admission; `autopilot-engine.js` performFinalPanel), what the operator-facing knobs are, and the
   red-first tests that prove contamination is impossible under the new design (e.g. plant a fake
   "prior verdict" file in the repo and assert no seat's output references it).
Answer with a concrete recommendation and trade-offs; keep it under ~1500 words.
