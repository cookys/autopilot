# D4 (plan P3) — QC panel verdicts, 2026-09-11

Diff under review: 62a58071..07dc63ad. Brief: the panel was told what had already been
found so it would not re-report it. Three families, roster-resolved.

## gpt-5.6-sol (openai, codex, max)

- verdict: **FIX-THEN-SHIP**
- status: reviewed
- raw_log: /tmp/dispatch-review-log-cnlvlN

```
🟠 [unpinned-live-ordinary-bypass] MUST-FIX scripts/dispatch-contract.js:1458-1460 and platforms/codex/plugin/scripts/dispatch-contract.js:1458-1460 treat preferred-tuple equality as proof of a pin. A no-pin resolve-live document contains the same preferred tuple, so an unpinned seat with three ordinary strikes passed through --resolved-live satisfies pinAdmitsPreferred and returns GO with assurance operator-pin, violating KR3 and zero-pin compatibility. Carry and validate explicit pin presence/identity from readPinForRole and require it for pin admission. Mechanical check: unpin, regenerate resolve-live, pass it to contract check with --resolved-live, and assert exit 3 plus pre-change-equivalent refusal.
🟠 [byte-identity-oracle-normalized] MUST-FIX hooks/tests/pending-revocation-fold.test.sh:218-235,309-327,365-382 overwrites captured stdout with a reserialized final JSON line before cmp, so added whitespace or diagnostic output cannot fail the claimed byte-identity checks; the KR4 red case also never asserts its exit status. Preserve raw stdout separately from parsed payloads and assert exit 3 for both pre/current red cases. Mechanical check: adding a current-only stdout prefix or returning 0 only for an unpinned critical refusal must turn the test red.
```

## GLM-5.2 (zhipu, cc-shim, high)

- verdict: **FIX-THEN-SHIP**
- status: reviewed
- raw_log: /tmp/dispatch-review-log-6aN65E

```
🟠 [kr3-admit-no-pin-evidence] MUST-FIX — scripts/dispatch-contract.js:1457-1461 (mirror platforms/codex/plugin/scripts/dispatch-contract.js identical): the new KR3 branch admits a requalify_required seat on `resolvedLive && preferredTupleMatchesResolved(...)` alone — no pin evidence anywhere in the guard. The resolver provably emits a defined preferred_tuple when unpinned (the unguarded `preferred_tuple.engine` fold call at scripts/resolve-dispatch-topology.js:292-299 must not throw, and the zero-pin test passes), and nothing visible in preferredTupleMatchesResolved distinguishes a pinned doc from an unpinned ladder-derived one, so an unpinned host with ≥3 ordinary strikes running the normal resolve-live → `check --resolved-live` flow flips the pre-change REFUSE (old code pushed strikeReasonMessage unconditionally) into GO with a fabricated operator_pin and assurance operator-pin — a zero-pin decision change and a silent strike-enforcement bypass, exactly what the plan's hard constraint forbids. Note the asymmetry inside this same diff: KR4's branch is pin-gated transitively via `substitution_reason === 'critical_strike'` (resolver sets it only `if (pin && critical_trigger)`, resolve-dispatch-topology.js:308-310) while KR3's guard has no equivalent. Mechanical check: fresh store, seed 3 ordinary strikes, do NOT pin_seat, enforce; run resolver --resolve-live; run BOTH `PRE_CONTRACT` and current `dispatch-contract check ... --resolved-live live.json` — if current returns GO/operator-pin where pre-change exits 3 with REFUSAL_ORDINARY, the violation is confirmed (if pre-change also admits, the hole is pre-existing P2b and out of scope — but the KR3 path itself is new in this diff). Both red tests in the suite omit --resolved-live, so this regression is currently undetectable. Smallest remediation: surface the pin signal the resolver already computes (e.g. a pin-present field in the live doc, or pin-gating what admission consumes, mirroring substitution_reason) and require it in the KR3 guard; add the unpinned + --resolved-live + 3-strikes red case to the test.
🟡 [pending-row-key-drop] Minor — scripts/engine-scorecard.js:1760-1774 (and platform mirror): pendingRevocationRowFromStrike null-coalestes only predicate_id; cause_class (and engine/runner/role/seat_hash) are copied raw, and the countable filter per its own comment validates receipt/class/predicate/artifact-hash/window/dedup but not cause_class presence, so a store row with an allowlisted writer and no cause_class survives the fold and JSON.stringify drops the key — an eight-key pending_revocation row, violating the nine-key shape (the test asserts nine keys only for CLI-written rows, which always carry cause_class). Mechanical check: hand-append a `kind:"strike", writer:"fuse", class:"ordinary_strike"` row without cause_class to strikes.jsonl, run resolve-live, count Object.keys on the emitted row → 8. Smallest remediation: `cause_class: row.cause_class === undefined ? null : row.cause_class` (or reject missing cause_class in the countable filter). Minor: requires a forged/miss-written row the listed KR7 exclusions do not cover; downstream P5 consumes the shape.
🟡 [kr4-no-array-guard] Minor — scripts/dispatch-contract.js:1399 (mirror identical): the KR4 admit branch assigns `pendingRevocation = resolvedLive.pending_revocation` without the `Array.isArray` guard its sibling branches (substitution carry-through at ~1387 and P2b at ~1487) use, so a hand-crafted --resolved-live with substitution_reason 'critical_strike', matching tuples and a non-array pending_revocation reflects arbitrary JSON into the GO payload as pending_revocation. Smallest remediation: add the same Array.isArray check. Minor: the live doc is already operator-trusted input (operator_pin has the same exposure).
🔵 [byte-identity-normalized] CUT/FOLLOW-UP — hooks/tests/pending-revocation-fold.test.sh KR3/KR4 red: the "byte-identical" assertions compare run_check's JSON.parse→JSON.stringify-normalized output, so raw whitespace/key-spacing drift between pre-change and current stdout would pass; values and key order are still pinned, which is what the pipeline consumes. Excluded from this version because normalized equality is the semantic contract; hardening later = retain a .raw copy of each stdout and cmp that.
```

## MiniMax-M3 (minimax, cc-shim, high)

- verdict: **SHIP-AS-IS**
- status: reviewed
- raw_log: /tmp/dispatch-review-log-5lxmzV

_no findings reported_

## Depth-0 adjudication (re-derivation, not vote count)

Two seats named the same MUST-FIX; MiniMax cleared it with zero findings. Adjudicated
by running the check the seats proposed, not by counting.

**PROBE B — the finding is real.** Unpinned seat (`unpin_seat` ran), 3 ordinary strikes,
`AUTOPILOT_STRIKE_ENFORCEMENT=enforce`, the resolver's own payload with `endpoint`
normalised to `""` (the contract's documented `@none` wallet):

```
exit=0
{"verdict":"GO", ..., "assurance":"operator-pin",
 "operator_pin":{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer"}}
```

A fabricated `operator_pin` on a host with no pin: a zero-pin decision change and a
strike-enforcement bypass, which §2.5 forbids outright.

**PROBE C — the defect is older than this diff and is already shipped.** The same guard
shape sits in D3's P2b branch (`dispatch-contract.js:1482`). Running the SHIPPED v2.36.26
build (`git show 62a58071:scripts/dispatch-contract.js`) against an unpinned seat with NO
scorecard row and a resolve-live document:

```
exit=0
{"verdict":"GO", ..., "assurance":"operator-pin", "operator_pin":{...}}
```

D4 did not introduce the bypass; it copied a shipped one into a second branch.

**Why D3's tests missed it — a fifth vacuity pattern.** Every `--resolved-live` fixture in
`hooks/tests/dispatch-contract-pin.test.sh` is hand-built for a PINNED seat, and every
unpinned red case omits `--resolved-live` entirely. No test anywhere hands the contract an
unpinned resolver document. Not an assertion that cannot fail — a red case that never feeds
the input the GO path consumes.

**Found by depth-0, by neither seat**: the resolver emits `endpoint: null`; the contract's
`isCompleteTuple` (D3) rejects a non-string endpoint. The real
`--resolve-live` → `check --resolved-live` flow therefore cannot complete for any seat
without a named endpoint — which is the only reason the bypass is not reachable by accident
on such seats today. Also pre-existing from D3.

**Seat signal, recorded not acted on**: MiniMax-M3 returned SHIP-AS-IS with zero findings on
a defect two other families caught independently. Fourth deliverable running, fourth such
result from that seat. This belongs to the qualification machinery, not to a hand-made
roster edit.
