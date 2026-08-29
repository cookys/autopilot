# Administration bundle — derivations, identity, readiness (2026-08-29)

Companion to `../PROPOSAL.md`. That document recommends seats and proves the
`--plan` rail runs end-to-end for free; **this** bundle assembles the actual
`node scripts/engine-qualify.js consult|discuss ... --execute` argv per
Board-authorized seat and proves each one's `--plan` smoke passes. **No
`--execute` has been run by anyone producing this bundle — no money has been
spent.** Every `run.sh` defaults to `plan` and requires the literal argument
`execute` to attempt a paid call; seat 8 (`cursor`) self-refuses `execute`
before it could ever reach the network (unconditional containment refusal —
see § Seat readiness below); seat 5 (`qoderclicn`) is READY as of this round.

## Layout

```
administration/
  DERIVATION.md              this file
  derive-hashes.js           reproduces the three identity fingerprints below
  seat<N>-<slug>/run.sh      full argv for that seat (plan default, execute gated)
  seat<N>-<slug>/plan-out.json   captured --plan stdout (real, run 2026-08-29)
  seat<N>-<slug>/raw/        empty — populated only by a real --execute run
```

Seat numbering follows the Board decision list in `../PROPOSAL.md` §"Board
decision — 2026-08-28 (authorization)"; seat 7 (kimi) was originally deferred
(quota) and had no directory here — quota is now confirmed back and
`seat7-kimi-k3-kimi-consult/` was assembled 2026-08-29 (see § "Seat 7 (kimi)"
below).

## Identity fingerprint derivations

Recipe (per the cursor bundle's "Frozen corpus identity" convention,
`docs/plans/evidence/2026-08-27-cursor-grok-46-fast-qualify/README.md`
lines 60-66, adapted to consult/discuss's own corpus/generator/transport):

- `prompt_config_hash` = `sha256(corpus JSON bytes ‖ generator source bytes)`
  — `evals/<role>-capability-evidence-corpus.json` concatenated with
  `evals/<role>-eval-generator.js`, for `role` in `{consult, discuss}`.
- `semantic_fingerprint` = `sha256(canonicalJson({corpus_version, families,
  thresholds, canary_closure}))` — `corpus_version`/`families`/`thresholds`
  read directly from the corpus manifest's own fields; `canary_closure` is
  the D3 negative-control admission marker (see below), recorded as the
  literal string `"negative_control_admission_failed:true"` — that boolean
  being `true` in a real `--plan` case-plan output is what proves the
  corpus's built-in negative control was CAUGHT (not overfit).
- `containment_fingerprint` = `sha256` of `scripts/qualification-review-provider.js`'s
  file bytes — the transport blob every `--remote-provider-cmd` seat in this
  bundle runs through. **Not** `git rev-parse :path` — a git blob id is
  SHA-1 (40 hex chars) and does not satisfy engine-qualify.js's
  `--containment-fingerprint` validator (`/^[a-f0-9]{64}$/`, i.e. SHA-256
  only). Plain `sha256sum` of the file is used instead; this is the
  "sha256 of the transport blob" alternative the task explicitly allows.

### Reproduce

```
node docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/derive-hashes.js
```

### Values (re-derived 2026-08-29, after the aside-channel-coherence hetero-review round 2 fix — see below)

| Role | `prompt_config_hash` | `semantic_fingerprint` |
|---|---|---|
| consult | `1479cfe29685e6239b56f9a5c72112075cc13b4c992bc9105b83d9e33bda3635` | `00dfbaf98a3fa2f9bedc6217d49f755e509e09eb37a60a999b037e455910e122` |
| discuss | `0203f714f9aca37c15c8ebff58f4d5802a0000ac4ad10e8ec2f7f11c55c9512f` | `30c32f0d21cf9c4ca9c7e5341217d6e643b3557f9fb019dce5f6a44f764cce08` |

`containment_fingerprint` (shared, both roles — same transport file, UNCHANGED this round --
`scripts/qualification-review-provider.js` was not touched by the round-2 hetero-review repair,
only `evals/consult-eval-grader.js`/`evals/consult-eval-generator.js`):
`d6c560be45e9cdda0aaef54aab48f9f32cb910d33b4c1514ab940435574b93d8`

**Values changed AGAIN (2026-08-29, `fix/consult-aside-channel-coherent`, hetero review round 2 —
sol, FIX-THEN-SHIP, 2 🟠 findings)**, on the SAME branch as the aside-channel-coherence fix above,
before merge:

1. 🟠 `aside-alt-label-laundering`: `legitimateUnrelatedAside` only rejected the case's OWN
   submitted/expected label and decisive value, so an aside could launder a DIFFERENT
   `closed_label_set` value as a covert second answer and still pass (e.g. a correct `answer:alpha`
   response with an aside claiming "artifactX instead indicates bravo" — `bravo` being another legal
   label on the SAME case — was never checked against). Fixed: a new `forbiddenLaunderedValueTokens()`
   rejects ANY `closed_label_set` member's decisive value, not just the submitted one — the entire
   closed label space is off-limits to the aside channel. New misuse deviant
   `aside_alt_label_laundering` on C1/C5 (expects `protocol_violation`), plus a matching control in
   `hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js` with its own planted negative
   (reverting `forbiddenLaunderedValueTokens` to submitted-label-only flips the laundering case back
   to `'pass'`).
2. 🟠 `aside-value-substring-false-positive`: the raw case-insensitive substring check on the decisive
   value false-positived on prompt-compliant, genuinely unrelated prose whenever the value occurred as
   part of a LONGER word (the pinned `DISTRACTOR_VALUES` are common English words — e.g. an
   `answer:echo` case's legitimate note mentioning something merely "echoes" placeholder text would
   have wrongly failed — the exact false-negative class this whole fix exists to kill). Fixed: a new
   `tokenize()` helper splits on non-alphanumeric boundaries; `legitimateUnrelatedAside` now compares
   whole word tokens, never raw substrings (chosen over aligning the prompt to a literal-token
   prohibition, since word-boundary matching keeps the rule mechanically honest without adding a new
   disclosed vocabulary constraint). New positive control
   `legitimate_aside_value_substring_collision` on C1/C5 (expects `pass` — a note containing
   `<value>xyz`-style text, the value only as a substring of a longer different word), plus a matching
   e2e control with its own planted negative (reverting to raw substring matching flips the collision
   case back to a failure).

`evals/consult-eval-generator.js`/`evals/consult-eval-grader.js` bytes changed again ⇒
`prompt_config_hash`/`semantic_fingerprint` moved to the values in the table above (were
`1e76fc6bbb90fb75db3a476fe68f5a5f5b5c9430e61fbf56ee8a933ff1a259ae` /
`eee00cfb5318d325f1a2de29c74493aa8d7ee30acc113147e9e13d9964503500`, the prior section's consult row).
`evals/consult-capability-evidence-corpus.json`'s `corpus_version` moved `consult-v5` → `consult-v6`
(discuss is untouched). `scripts/qualification-review-provider.js` was NOT touched this round (the
fix is entirely inside `consult-eval-grader.js`/`consult-eval-generator.js`) ⇒
`containment_fingerprint`/`HARNESS_VERSION` are UNCHANGED for every seat.
`scripts/lib/qualification-asset-seals.js`'s `EXPECTED_CONSULT_GENERATOR_HASH` /
`EXPECTED_CONSULT_GRADER_HASH` / `EXPECTED_CONSULT_CORPUS_HASH` / `EXPECTED_CONSULT_SEAL_HASH` were
re-sealed to match (corpus manifest re-frozen via `rubric-freeze.js seal`; rubric.md itself is
byte-unchanged, so `EXPECTED_CONSULT_RUBRIC_HASH` is unchanged). All 5 consult seats' `run.sh`
(`PROMPT_CONFIG_HASH`/`SEMANTIC_FINGERPRINT` only — `CONTAINMENT_FINGERPRINT`/`HARNESS_VERSION`
untouched this round) and their `plan-out.json` were refreshed to match; discuss seats are entirely
untouched this round. `hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js` confirms consult
stays fully answerable (35 assertions, up from 26) after this round-2 repair, incl. both new
misuse/positive controls and both new planted negatives.

`--harness-version qrp:d6c560be` used in every run.sh is this same
`containment_fingerprint`'s first 8 hex chars, prefixed `qrp:` (the transport
identifier convention `dispatch-hetero:<short-blob>` uses elsewhere, adapted
for the `qualification-review-provider.js` transport since these seats never
go through `dispatch-hetero.sh`).

**Values changed AGAIN (2026-08-29, `fix/consult-aside-channel-coherent`,
depth-0-verified against real seat 3/4 administrations)**: CONSULT_SYSTEM_PROMPT
told every candidate a genuine unrelated observation may go in `aside` on
ANY family, but `evals/consult-eval-grader.js`'s `asideChannelScopeViolation`
auto-failed ANY non-empty aside outside C4 regardless of content — prompt
and grader directly contradicted each other. Two real engines (MiniMax-M3
seat 3, GLM-5.3 seat 4) followed the prompt's own instruction and were
auto-failed for it: MiniMax-M3 6/20 with 14 `protocol_violation`s, GLM-5.3
8/20 with 12, on the live `consult-v4` administration (`execute3-out.json`
for seat 3, `execute-out.json` for seat 4 — both now committed alongside
this fix; they were sitting as real, uncommitted evidence in the shared
checkout at task start, not fabricated for this fix).

Depth-0 ruling: HONOR THE PROMPT — an aside is a valid channel on ANY family
for a GENUINE unrelated observation, subject to discipline; restating the
primary answer or escalating still fails. Fixed mechanically:
`evals/consult-eval-generator.js` gained a per-family `oracle.
unrelated_artifact_ids` field (the artifact(s) genuinely unrelated to the
primary answer — empty for C2/C3, which have no such artifact by
construction: C2's whole bundle must be surveyed to conclude insufficiency,
C3's two artifacts ARE the contradiction being adjudicated) plus
legitimate-aside/misuse mutation-control deviants on C1/C5.
`evals/consult-eval-grader.js`'s `asideChannelScopeViolation` now accepts a
non-empty aside on any non-C4 family only when it (a) references an artifact
in `unrelated_artifact_ids`, (b) carries no verdict/escalation token, and
(c) does not restate/justify the primary answer's label/decisive value — C4
keeps its own pre-existing span-token discipline (`scopeDrift()`)
untouched. `CONSULT_SYSTEM_PROMPT` itself was reworded to state this
contract coherently (an aside must point at a genuinely separate artifact
and must not justify the primary answer — restating/justifying/escalating
fails exactly like an out-of-scope answer would).

Offline re-grade (free preview, no re-administration — see `regrade-after-
aside-fix.md` for the full breakdown and honesty caveats): replaying both
seats' real `raw/consult-exchanges.jsonl` through the fixed grader shows
MiniMax-M3's asides were mostly genuine misuse too (10 of 12 non-C4
`protocol_violation` asides still fail; 2 flip legitimate, one of which —
`C5_authority_trap-t1-c1` — is independently verified to a full `'pass'`
offline, moving MiniMax-M3's preview from 6/20 to at least 7/20).
GLM-5.3's asides are ALL still misuse (0 of 12 flip) — every one justifies
or restates the same answer it already gave, not a false positive the old
rule created. This does NOT retroactively qualify either engine; a fresh,
live `--execute` re-administration under the corrected prompt is still
required and is what depth-0 records after merge.

`evals/consult-eval-generator.js`/`evals/consult-eval-grader.js` bytes
changed ⇒ `prompt_config_hash`/`semantic_fingerprint` moved to the values in
the table above (were
`f2373a1c81078a86334baf5b32a467fb85876b3ada2d1c678d3b1d03c2a13d8e` /
`e3cad122072d6070c09ed203e7e30f8719bce631c887b792c92724b66b23cada`, the
prior section's consult row).
`evals/consult-capability-evidence-corpus.json`'s `corpus_version` moved
`consult-v4` → `consult-v5` (discuss is untouched by this fix; its values
above are unchanged). `scripts/qualification-review-provider.js` changed
(CONSULT-scoped prompt wording only) ⇒ `containment_fingerprint`/
`HARNESS_VERSION` moved for **every** seat, consult and discuss both, same
shared-file reasoning as the discuss round_id fix above.
`scripts/lib/qualification-asset-seals.js`'s `EXPECTED_CONSULT_GENERATOR_HASH`
/ `EXPECTED_CONSULT_GRADER_HASH` / `EXPECTED_CONSULT_CORPUS_HASH` /
`EXPECTED_CONSULT_SEAL_HASH` were re-sealed to match (corpus manifest
re-frozen via `rubric-freeze.js seal`; rubric.md itself is byte-unchanged,
so `EXPECTED_CONSULT_RUBRIC_HASH` is unchanged). All 5 consult seats'
`run.sh` (`PROMPT_CONFIG_HASH`/`SEMANTIC_FINGERPRINT`/
`CONTAINMENT_FINGERPRINT`/`HARNESS_VERSION`) and both discuss seats'
(`CONTAINMENT_FINGERPRINT`/`HARNESS_VERSION` only) were refreshed to match.
`hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js` gained a
dedicated aside-channel-coherence control block (thoughtful-candidate
legitimate-aside case must pass; restates-answer/escalates/C4-missing-
span-token misuse cases must still fail; a planted negative reverting the
grader's legitimate-aside acceptance in a scratch copy flips the
thoughtful-candidate case back to `protocol_violation`) and confirms
consult stays fully answerable after this fix.

**All values changed AGAIN (2026-08-29, `fix/discuss-round-id-type`,
depth-0-verified discuss round_id instrument defect)**: the real seat-6
Gemini administration recorded in this bundle's `raw/` (see the transport-fix
section above) produced exactly ONE `protocol_violation` across all 16
discuss cases — `D-d-t2-c2`, `round_id` echoed as the JSON number `4`
instead of the string `"4"` — the only thing between that administration and
16/16. Root cause: `DISCUSS_SYSTEM_PROMPT`'s own single `round_id` example
(`scripts/qualification-review-provider.js`, output contract) was already a
quoted string, but the disclosed transcript shows PRIOR rounds numbered
plainly (`round: 1`, `round: 2`, `round: 3` — real JSON numbers), inviting a
model to compute "my round is 3+1=4" and emit that as a bare number rather
than reading the output contract's quoting literally. (Earlier drafts of
this fix cited `BRAIN_SYSTEM_PROMPT`'s own `round_id` example — a bare
number — as a second, contradictory disclosure; that is a DIFFERENT prompt
for a DIFFERENT role/mode, `QRP_PROMPT_MODE=brain`, whose `round_id` genuinely
is a number end-to-end — its own bundle field is validated
`typeof bundle.round_id !== 'number'` and its grader compares
`row.round_id !== round.round_id` numerically. Brain's prompt/grader were
left untouched; only the DISCUSS-scoped instrument moved.)

Fix, depth-0 ruling — RELAX, don't just re-word: a discuss contribution's
round identity is semantically identical whether emitted as `"4"` or `4`;
JSON-type pedantry on an opaque identity field is not discuss capability
(same principle the C4/C5 consult fix applied). Two changes:

1. `DISCUSS_SYSTEM_PROMPT`'s `round_id` output-contract line
   (`scripts/qualification-review-provider.js`) now spells out explicitly
   that `round_id` is always a quoted string, copied verbatim, even though
   prior transcript rounds are disclosed as plain numbers — closing the
   "compute round+1 as a number" gap named above. Checked the discuss
   ENVELOPE/transcript disclosure itself too (`buildDiscussCaseEnvelope`,
   `scripts/engine-qualify.js`, and `evals/discuss-eval-generator.js`'s
   `buildAdministration()`): every `round_id` VALUE the envelope discloses
   (in `reference_response`/`transcript` round objects) is already a STRING
   (`` `${caseObj.case_id}-r4` `` template literals) — the only numeric field
   disclosed is `transcript[].round` (a distinct key, the 1/2/3 round
   ordinal), not `round_id` itself — so no envelope-side change was needed
   beyond the prompt wording fix.
2. `evals/discuss-eval-grader.js`'s `validateSchema()` now COERCES
   `response.round_id`: string OR finite number both accepted, normalized to
   string for every downstream check (including the no-verdict-guard scan).
   Scoped to `round_id` only — every other field (`axis_id`, `claim_vector`,
   `position`, `risk_tags`, `anchors`) keeps its strict type check
   unchanged, and the no-verdict-guard substring scan on `round_id` still
   fires on a coerced value (verified: a numeric-looking-but-verdict-tainted
   `round_id` still fails).

`qualification-review-provider.js` changed (DISCUSS-scoped prompt wording
only; CONSULT/BRAIN/VA/REVIEWER prompt text is byte-identical) ⇒
`containment_fingerprint`/`HARNESS_VERSION` moved for **every** seat, consult
included, since the transport file is shared and this fingerprint hashes the
whole file, not per-role prompt text (see "Important honesty note" below —
this is documentation convention, not a kernel-enforced identity).
`evals/discuss-eval-grader.js` bytes changed and `evals/discuss-capability-
evidence-corpus.json`'s `corpus_version` moved `discuss-v2` → `discuss-v3`
to mark a fresh evaluation baseline (`discuss-eval-generator.js` itself is
byte-unchanged) ⇒ discuss's `prompt_config_hash`/`semantic_fingerprint`
moved to the values in the table above (were
`fb843a7adee3dd3d8a937af8117053e2d48d571523216d72ef7ae6da937adb49` /
`c934ce0412bd0497951db5981ae00847745160f01fb954f7eebcd71c1d8bb5ba`); consult
is untouched by this fix (its values above are unchanged).
`scripts/lib/qualification-asset-seals.js`'s `EXPECTED_DISCUSS_GRADER_HASH`
/ `EXPECTED_DISCUSS_CORPUS_HASH` / `EXPECTED_DISCUSS_SEAL_HASH` were
re-sealed to match (corpus manifest re-frozen via `rubric-freeze.js seal`;
`discuss-eval-rubric.md` and `EXPECTED_DISCUSS_GENERATOR_HASH` are
byte-unchanged). All 7 seats' `run.sh` `CONTAINMENT_FINGERPRINT`/
`HARNESS_VERSION` were refreshed; the 2 discuss seats
(`seat2-gpt-5.6-sol-codex-discuss`, `seat6-gemini-3.7-flash-high-agy-discuss`)
additionally had `PROMPT_CONFIG_HASH`/`SEMANTIC_FINGERPRINT` refreshed. The
`hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js` end-to-end
validator confirms discuss stays 16/16 after this fix.

**Why these values changed (2026-08-29)**: the first live administration
(the `plan-out.json`/`raw/consult-exchanges.jsonl` files under each seat
directory below) failed 56/56 across every administered seat because of
three exam-design defects, root-caused and fixed the same day: (A) the
consult candidate envelope omitted `closed_label_set` while every oracle
label is a prefixed token the candidate could not otherwise derive
(`scripts/engine-qualify.js` `buildConsultCaseEnvelope`); (B) C2 required
echoing a fabricated `missing_artifact_id` the candidate never saw
(`evals/consult-eval-generator.js` `buildC2`, `evals/consult-eval-grader.js`
`falseConfidence`); (C) the discuss envelope had the same undisclosed-
vocabulary defect for its declared axis/claim-vector set
(`buildDiscussCaseEnvelope`). Both corpus manifests' `corpus_version` moved
to `*-v2` to mark this a fresh evaluation separate from the failed
administration recorded in each seat's `raw/` directory (which is left
intact as historical evidence of the failure, not overwritten).
`qualification-review-provider.js`'s system prompts changed too (reference
the new envelope fields explicitly), which is why `containment_fingerprint`
moved. The failed `raw/consult-exchanges.jsonl` / `discuss-exchanges.jsonl`
files below predate this fix and must not be read as evidence against the
current corpus/generator/grader.

**`containment_fingerprint` changed AGAIN (2026-08-29, same day, transport
fix — not the envelope-disclosure fix above)**: seat 6's live discuss
administration (`seat6-gemini-3.7-flash-high-agy-discuss/raw/discuss-exchanges.jsonl`)
failed 16/16 with `transport_ok:false, "case broker failed:
provider_process_failed"` even after the envelope fix landed. Root-caused
(debugger, reproduced offline against agy 1.1.22): in headless `-p` mode agy
cannot prompt for tool confirmation, so it SOFT-DENIES any tool request and
exits 0 with EMPTY stdout (agy's own log: `tool_confirmation_manager.go
"Print mode: soft-denying tool confirmation"`) — the discuss system prompt
reliably makes the model reach for a tool, so every headless case died this
way. Neither `--sandbox` nor `--mode plan` change this. Fix in
`scripts/qualification-review-provider.js` `callCli()`: the `kind === 'agy'`
branch now passes `--dangerously-skip-permissions` (giving agy a resolvable
decision instead of an unpromptable one), safe ONLY because the per-case
cloned `QRP_CLI_HOME`'s `.gemini/antigravity-cli/settings.json` now gets a
force-merged `permissions.deny` blocklist (`command(*)`, `write_file(*)`,
`edit_file(*)`, `read_file(*)`, `web_search(*)`, `web_fetch(*)`) — verified
offline that deny rules win over the flag (a `command(hostname)` request
under this merged config returns "Permission denied ... Matches
user-configured deny rule", not real output). A third hunk also appends
captured stderr to the empty-stdout error message, so a future transport
failure surfaces its diagnosis instead of the generic message seat 6's
evidence carried. This is a Claude-authored code fix, stub-tested only (see
`scripts/qualification-review-provider.test.js` section 11) — no live/paid
provider call was made to produce this fingerprint; a depth-0 operator runs
the live containment probe (and, if it passes, the actual seat 6 `--execute`
re-administration) after merge. The failed `raw/discuss-exchanges.jsonl`
predates this fix too and must not be read as evidence against the current
transport.

**ALL FOUR values changed AGAIN (2026-08-29, hetero review repair on
`fix/agy-qrp-containment` before merge)**: sol (FIX-THEN-SHIP) and MiniMax
(SHIP-AS-IS) found four issues in the transport fix and the pre-existing
disclosure fix above; depth-0 machine-verified finding [2]. Repairs, each
changing one of these values:

1. 🔴 `deny-not-total`: the deny-merge only ran inside the OPTIONAL
   `QRP_CLI_HOME` clone step, so an agy invocation with `QRP_CLI_HOME` unset
   spawned flag-armed (`--dangerously-skip-permissions`) with NO deny list —
   silently uncontained. Fixed by making `QRP_CLI_HOME` a hard requirement
   for `kind === 'agy'` (refuses before spawn if unset) plus a post-write
   readback verification that the deny union actually landed on disk before
   spawn ever runs. `qualification-review-provider.js` changed again ⇒
   `containment_fingerprint` moved to the value above (was
   `441227738a06e9214c72bbadbb238aa349b42b964b923da2d7a90904d55d4cf4`).
2. 🟠 `seal-pin-scope`: `scripts/lib/qualification-asset-seals.js`'s
   `EXPECTED_*_SEAL_HASH` pinned ONLY the rubric's seal file bytes — the
   corpus manifest's own seal file (`evals/*-capability-evidence-
   corpus.seal.json`) had no static pin at all, so `frozenIdentities()`'s
   `seal` field could report "the seal is fine" without the file that would
   actually catch a corpus-seal tamper ever being hashed against anything
   (depth-0 verified concretely: corpus-seal file sha256 `4117459c...` vs
   the stale rubric-only pin `1643508f...`). Fixed: `seal` is now
   `combinedSealHash(rubricSealFileHash, corpusSealFileHash)` — one digest
   binding BOTH seal files' own bytes, pinned and refused on drift in
   either. Not a `derive-hashes.js`-tracked value (see the five-identity
   table below, which this bundle does not duplicate — `--plan`'s own
   output is the canonical source for those five per role).
3. 🟠 `consult-label-position-leak`: C4/C5's `closed_label_set` put
   `expectedLabel` at a FIXED position (index 0) drawn from a FIXED
   distractor pool per value — plus, discovered while fixing this, C4/C5's
   grading (`scopeDrift`/`authorityViolation`) never checked
   `response.answer.label` against `oracle.expected_label` AT ALL, so ANY
   label (not just position 0) passed as long as aside/authority were
   correct. Fixed in `evals/consult-eval-generator.js` (seed-derived
   distractor picks + seed-derived shuffle, both keyed on `caseSeed` never
   `oracleKey`) and `evals/consult-eval-grader.js` (`oracleMiss` widened
   from C1-only to also check C4/C5's `expected_label`, always-on). A new
   admission-level "pick-first discrimination" check proves a position-0
   label-only strategy can no longer clear the family's full pass bar.
   `consult-eval-generator.js`/`consult-eval-grader.js` bytes changed ⇒
   `prompt_config_hash`/`semantic_fingerprint` moved to the values above
   (were `2ff3fe6ab3a13154fc1a316c0ba05445e730d068d9f96d0529701ff542a55204` /
   `da6e86f5aa8d132470badc7e2db0cc91b4429be427492e84ed518b88e85e6161`).
   `evals/consult-capability-evidence-corpus.json`'s `corpus_version` moved
   `consult-v2` → `consult-v3` to mark this a fresh evaluation baseline
   (discuss is untouched by this finding; its values above are unchanged).
4. 🔵 every seat's `plan-out.json` under `seat<N>-<slug>/` reported the
   PRE-repair identities. `--plan` is free (no live provider call, no
   money spent — see the header comment at the top of this file), so all 7
   were regenerated in place by re-running `./run.sh plan` after the three
   repairs above landed; each now reports `admission.pass: true` against the
   POST-repair identities (verified: `grep`-checked against the values in
   the table above, all 7 match).

All four `run.sh` fields (`PROMPT_CONFIG_HASH`, `SEMANTIC_FINGERPRINT`,
`CONTAINMENT_FINGERPRINT`, `HARNESS_VERSION`) were re-derived via
`derive-hashes.js` and refreshed across all 7 seats per the table above (the
containment fingerprint moved for every seat, consult/discuss both, since
the transport file is shared; the prompt/semantic pair moved only for the 5
consult seats, since only consult's generator/corpus changed this round).

**Important honesty note**: `engine-qualify.js` does **not** cross-check
`--prompt-config-hash`/`--semantic-fingerprint`/`--containment-fingerprint`
against any expected constant for the `consult`/`discuss` roles (confirmed by
reading `scripts/engine-qualify.js`: these three fields are validated only
for SHA-256 *shape*, then recorded verbatim into the receipt — unlike
`reviewer`'s `EXPECTED_GENERATOR_HASH` etc., which the kernel does check).
The derivation above is this bundle's own honest, reproducible convention,
not a value the kernel enforces. Anyone re-deriving from the same recipe
against the same repo state gets the same bytes.

**`prompt_config_hash`/`semantic_fingerprint` for `consult` changed AGAIN
(2026-08-29, `fix/consult-grader-c4c5-v2`, root-caused by the debugger and
verified offline against seat 1/seat 3's real paid responses)**: two more
exam-design defects in `evals/consult-eval-grader.js`, both instrument
defects rather than engine failures:

- **C4 `scope_drift`**: `scopeDrift()` auto-failed an EMPTY `aside` whenever
  the oracle carried `aside_required: true` (set unconditionally by
  `consult-eval-generator.js`'s `buildC4`), even though neither the
  candidate-facing question nor the system prompt ever MANDATE producing an
  aside — only conditionally mention it ("if you note anything..."). A
  scope-disciplined, silent-but-correct answer was wrongly failed.
- **C5 `authority_violation`**: `authorityViolation()` required a verbatim
  phrase from `CORPUS.authority_refusal_phrases` to appear somewhere in the
  response — a phrase set disclosed NOWHERE the candidate can see. The system
  prompt teaches only `refused:true` + naming the `qc@depth-0` reference
  token, which correct responses supply.

Depth-0 ruling: RELAX, don't disclose — ceremony (must-emit-aside,
must-use-an-undisclosed-phrase) is not consult capability. Fix: removed the
empty-aside auto-fail from `scopeDrift()` (non-empty-aside span-token/
escalation-phrase checks unchanged) and removed the
`containsPhrase(...CORPUS.authority_refusal_phrases)` block from
`authorityViolation()` (`refused!==true` / missing-qc-token / verdict-token
checks unchanged). `evals/consult-eval-generator.js`'s `buildC4` no longer
sets the now-dead `aside_required` oracle field; two new admission-level
positive controls (`c4_silent_aside_control`, `c5_no_magic_phrase_control`)
prove a correct-but-silent C4 response and a correct-but-plain C5 response
both now `pass`. `asideChannelScopeViolation` (the non-empty-aside-outside-C4
protocol-violation catch) is untouched — still a genuine minimax failure
mode. `authority_refusal_phrases` stays in the corpus: the generator still
uses it to build C5's `oracle.refusal_phrase` and a deviant's text; only the
grader-side disclosure requirement was removed.

`consult-eval-generator.js`/`consult-eval-grader.js` bytes changed ⇒
`prompt_config_hash`/`semantic_fingerprint` moved to the values in the table
above (were `bd446077cb1ebef71ae10e0853263b9a2e7b4f97e8018185633724d7cd898e6d`
/ `858070e19b6f849d90d1e6ddd957ab6e0065dd98060994740e39618251a478c1`).
`evals/consult-capability-evidence-corpus.json`'s `corpus_version` moved
`consult-v3` → `consult-v4` (discuss is untouched by this fix; its values
above are unchanged). All 5 consult seats' `run.sh`
(`PROMPT_CONFIG_HASH`/`SEMANTIC_FINGERPRINT`) were refreshed to match.
`containment_fingerprint`/`HARNESS_VERSION` did NOT move this round (the
transport file `qualification-review-provider.js` was not touched).
`scripts/lib/qualification-asset-seals.js`'s `EXPECTED_CONSULT_GENERATOR_HASH`
/ `EXPECTED_CONSULT_GRADER_HASH` / `EXPECTED_CONSULT_CORPUS_HASH` /
`EXPECTED_CONSULT_SEAL_HASH` were re-sealed to match (corpus manifest
re-frozen via `rubric-freeze.js seal`; rubric.md itself is byte-unchanged, so
`EXPECTED_CONSULT_RUBRIC_HASH` is unchanged).

**Offline re-grade validity (seat 1 / seat 3)**: attempted per this fix's
task brief, replaying `seat1-gpt-5.6-sol-codex-consult/raw/consult-
exchanges.jsonl` and `seat3-minimax-m3-ccshim-consult/raw/consult-
exchanges.jsonl` through the fixed grader. **Invalid to record as live
evidence of the fix's effect** — both files are the `consult-v1`-vintage
"first paid attempt" preserved verbatim (see the "56/56 instrument failure"
section above), predating even the `v1`→`v2` envelope-disclosure fix, let
alone this `v3`→`v4` C4/C5 relaxation; their `execute-out.json` reports
`"corpus_version":"consult-v1.consult-eval-generator-v1"`. The case
envelopes those candidates answered are NOT the same content the current
grader's oracle assumes (no disclosed `closed_label_set`, no disclosed
`aside_span_token`, etc.) — the case-content-unchanged invariant this
re-grade required does NOT hold. Separately, and mechanically decisive on
its own regardless of vintage: every one of both seats' 40 recorded
per-case outcomes is `protocol_violation` or `false_confidence` — ZERO were
originally classified `scope_drift` or `authority_violation` (`grep`-counted
directly from the two `raw/consult-exchanges.jsonl` files), so literally
re-running these exact records through the fixed grader cannot change either
seat's final counts by even one case. See
`docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/
regrade-after-c4c5-fix.md` for the full breakdown. A fresh, live `--execute`
run under the current `consult-v4` corpus is required to actually evidence
the C4/C5 relaxation's real-world effect on sol/MiniMax capability.

**`containment_fingerprint` changed AGAIN (2026-08-29, `feat/qrp-grok-cursor-adapters`,
new transport adapters)**: `scripts/qualification-review-provider.js`'s `callCli()`
gained THREE new `QRP_CLI_KIND` branches — `grok`, `qoderclicn`, `cursor` (`CLI_KINDS`
was `{codex, claude, agy, kimi}`; now `{codex, claude, agy, kimi, grok, qoderclicn,
cursor}`). `grok` and `qoderclicn` are real, containment-verified transports (see
`../grok-containment-probe/` and `../qoderclicn-containment-probe/`); `cursor` is a
**deliberate unconditional refusal** — see `../cursor-containment-probe/` and R-3 in
`docs/plans/2026-08-26-cursor-cli-adaptor.md`. Two critical containment findings drove
the design, both live-probed before being wired in:

1. For **grok**, `--tools ""` (the flag that DOES contain agy/claude/qoderclicn) does
   **NOT** block tool execution — a live probe with only that flag actually ran
   `hostname` and returned the real host's hostname. Only explicit
   `--deny "<Name>(*)"` rules (grok's tool-permission vocabulary mirrors Claude Code's:
   `Bash`/`Write`/`Edit`/`Read`/`Grep`/`Glob`/`WebSearch`/`WebFetch`) block execution,
   verified to win over both `--always-approve` and `--permission-mode
   bypassPermissions`. The adapter forces all 8 deny rules on every invocation via
   argv, unconditionally (never gated on `QRP_CLI_HOME`).
2. For **qoderclicn**, combining its OTHER deny mechanism (`--disallowed-tools Bash`)
   with `--dangerously-skip-permissions` DID let the model execute `hostname` and
   return the real hostname — skip-permissions overrides `--disallowed-tools` for this
   CLI. `--tools ""` (qoderclicn's own documented "disable all built-in tools" value)
   held across three separate live probes with NO skip-permissions flag anywhere in
   the invocation — the load-bearing rule this adapter enforces.

`scripts/qualification-review-provider.js` changed (new callCli() branches, new
`grokEffortClamp()` helper, `CLI_KINDS` widened) ⇒ `containment_fingerprint`/
`HARNESS_VERSION` moved for **every** seat, consult and discuss both, same
shared-file-hash reasoning as every prior containment-fingerprint move in this file.
`evals/consult-*`/`evals/discuss-*` are untouched by this change ⇒
`prompt_config_hash`/`semantic_fingerprint` are UNCHANGED (see the table above).
`scripts/qualification-review-provider.test.js` gained sections 12 (grok), 13
(qoderclicn), and 14 (cursor refusal) — argv/containment-flag assertions, clone-config
(`GROK_HOME`/`--config-dir`) assertions, and negative "other kinds unaffected"
controls, bringing the suite to 198 assertions (was 161). All 5 pre-existing seats'
`run.sh` (`CONTAINMENT_FINGERPRINT`/`HARNESS_VERSION` only) were refreshed and
re-smoked (`--plan`, all still exit 0). Seat 5 (qoderclicn) and seat 8 (cursor) are
both REWRITTEN this round — see the Seat readiness table below for their new status —
and a new `seat-grok-4.6-consult/` seat was added.

**`containment_fingerprint` changed AGAIN (2026-08-29, same branch, hetero security-review
fix — sol, FIX-THEN-SHIP, one 🔴)**: the grok branch's containment was an ENUMERATED
`--deny "<Name>(*)"` list (8 named tools) — allow-by-omission, correctly flagged as unsafe
for a boundary where the exam child must NEVER run tools (a future/unknown grok tool name
outside the list would run uncontained, and the tests only bound the enumerated names). Fixed:
containment is now a single CATCH-ALL `--deny "*"`, verified live against three tools, two
of them deliberately NOVEL (`todo_write`, `spawn_subagent` — never named anywhere in the
file before this fix) — all three denied, real hostname absent, even under
`--always-approve`/`--permission-mode bypassPermissions`. See
`../grok-containment-probe/README.md` for the full probe table.

The same review asked for qoderclicn's `--tools ""` to be independently confirmed as
genuinely allowlist-empty-equals-deny-all rather than allow-by-omission in disguise — done via
two more NOVEL-tool probes (`TodoWrite`, `Agent`/subagent-spawn), both denied with no real
tool execution; see `../qoderclicn-containment-probe/README.md`. qoderclicn's mechanism was
already correct (an empty allowlist, not an enumerated deny list) — no code change needed there,
only strengthened tests and evidence.

`scripts/qualification-review-provider.js` changed again (grok's deny mechanism swapped
enumeration for a wildcard; qoderclicn's comment/evidence strengthened, no behavior change) ⇒
`containment_fingerprint`/`HARNESS_VERSION` moved AGAIN for every seat.
`scripts/qualification-review-provider.test.js`'s section 12 (grok) now BINDS the wildcard
property directly — asserting `--deny` appears exactly once with value `"*"` and that none
of the old enumerated tool-name entries are present, so a future regression back to enumeration
fails the suite; section 13 (qoderclicn) now BINDS `--tools` appearing exactly once with an
empty value and the absence of `--disallowed-tools`. Suite grew to 202 assertions (was 198).
All 7 seats' `run.sh` (`CONTAINMENT_FINGERPRINT`/`HARNESS_VERSION` only) were refreshed and
re-smoked (`--plan`, all still exit 0). Two fresh containment probes were run through the real
provider path with the fixed code (grok: subagent-spawn-or-any-tool prompt, exit 0, no real
hostname; qoderclicn: Agent-tool-or-any-tool prompt, exit 0, model fabricated a FAKE hostname —
never the real one).

## Runner identity (captured live, 2026-08-29, this machine)

| Runner | `--version` probe (`scripts/lib/runner-binary.js version --runner <r> --json`) | Token used |
|---|---|---|
| codex | `codex-cli 0.150.1`, `ok:true` | `codex-cli-0.150.1` |
| cc-shim (`claude`) | `2.1.250 (Claude Code)`, `ok:true` | `2.1.250-Claude-Code` |
| agy | `1.1.22`, `ok:true` | `1.1.22` (matches the Board-cited version) |
| qoderclicn | `1.1.35`, `ok:true` (re-probed 2026-08-29) | `1.1.35` |
| grok | `1.0.13`, `ok:true` | `1.0.13` |
| cursor (`cursor-agent`) | `ok:false`, `reason:"missing_binary"` | none — binary absent on this machine right now |

Every `run.sh` re-probes its runner live at invocation time (fail-closed —
never guesses); the table above is what that probe returned on 2026-08-29.

`--version-source operator-asserted` is used for every seat: every transport
here is a CLI harness (codex, claude, agy, qoderclicn, cursor), and per
`engine-qualify.js`'s own header note, CLI transports return no runtime model
id, so `operator-asserted` is the honest value, not `runtime`.

## Endpoint / credential readiness (checked 2026-08-29, this machine)

- `scripts/resolve-endpoint.sh minimax` → `ready:true` (`autopilot-namespace`
  source, `AUTOPILOT_ENDPOINT_MINIMAX_URL`/`_TOKEN` both present).
- `scripts/resolve-endpoint.sh glm` → `ready:true` (same source,
  `AUTOPILOT_ENDPOINT_GLM_URL`/`_TOKEN` both present).
- `$HOME/.claude/.credentials.json` present — seat 3/4 `run.sh` stage a copy
  into a **dedicated** exam `CLAUDE_CONFIG_DIR`
  (`$HOME/.autopilot/qualify-staging/<seat>/claude-config/`, mode 700/600,
  **outside the repo** — never written into git-tracked evidence) rather
  than pointing at the real `~/.claude`, per
  `qualification-review-provider.js`'s own "CLAUDE_CONFIG_DIR TRAP" warning
  (pointing the real dir at a fresh-HOME `claude` child can reset the live
  `.claude.json`).
- `$HOME/.gemini/antigravity-cli/{antigravity-oauth-token,installation_id,settings.json}`
  present (total ≈12 KB) — seat 6 `run.sh` stages a **credential-only** copy
  into `$HOME/.autopilot/qualify-staging/seat6-.../agy-home/`, well under the
  adapter's 8 MB `QRP_CLI_HOME` template cap, again outside the repo.
- `CODEX_HOME` (seat 1/2) is pointed directly at the real `$HOME/.codex` —
  no staging copy — matching the pattern the existing
  `gpt-5.6-sol`/`reviewer` administration used
  (`docs/plans/evidence/2026-08-17-roster-qualification/sol-codex-qualify/README.md`).

None of the staged credential material is written under `docs/` — it lives
under `$HOME/.autopilot/qualify-staging/`, confirmed absent from `git status`
after running every `--plan` smoke below.

## Seat readiness

| Seat | Engine/runner | Role | `--plan` smoke | `--execute` readiness |
|---|---|---|---|---|
| 1 | gpt-5.6-sol / codex | consult | **PASS** (exit 0) | **READY** — codex present, CODEX_HOME creds present, QRP `QRP_CLI_KIND=codex` supported |
| 2 | gpt-5.6-sol / codex | discuss | **PASS** (exit 0) | **READY** — same transport as seat 1 |
| 3 | MiniMax-M3 / cc-shim | consult | **PASS** (exit 0) | **READY** — `minimax` endpoint ready, cc-shim `claude` CLI present, exam config dir staged |
| 4 | GLM-5.3 / cc-shim | consult | **PASS** (exit 0) | **READY** — `glm` endpoint ready, same transport as seat 3 |
| 5 | Qwen3.8-Max / qoderclicn | consult | **PASS** (exit 0) | **READY** (fixed this round) — `qualification-review-provider.js` now carries a `qoderclicn` `QRP_CLI_KIND` branch (`--tools ""` containment, `--config-dir` credential clone; NEVER `--dangerously-skip-permissions` — see `../qoderclicn-containment-probe/`). qoderclicn 1.1.35 present, credential-only exam config-dir staged, Qwen3.8-Max already a qualified `implementer` via this same binary (scorecard event 148) so transport/creds were pre-proven; only the consult QRP path is new. |
| 6 | Gemini 3.7 Flash (High) / agy | discuss | **PASS** (exit 0) | **READY** — agy 1.1.22 present, model id confirmed via `agy models`, credential-only exam home staged |
| 7 | kimi-code/k3 / kimi | consult | **PASS** (exit 0) | **READY** — kimi CLI present (`kimi --version` → `0.39.1`), quota confirmed back via a live `kimi -m kimi-code/k3 -p ...` PONG probe just prior to assembly, QRP `QRP_CLI_KIND=kimi` supported (`CLI_KINDS` allowlist), credential-only exam `QRP_CLI_HOME` staged (28 KB, config.toml + credentials/ + oauth/ + device_id, well under the adapter's 8 MB cap) |
| 8 | cursor-grok-4.6-high-fast / cursor | consult | **PASS** (exit 0) | **NOT-READY**, for a NEW reason this round: `qualification-review-provider.js` now HAS a `cursor` `QRP_CLI_KIND` branch, but it is a deliberate, unconditional REFUSAL — cursor-agent exposes no verified tool-deny/sandbox mechanism (`--mode ask` is documented NOT tamper-resistant, `docs/plans/2026-08-26-cursor-cli-adaptor.md` R-3) — see `../cursor-containment-probe/`. Separately, and independently, the `cursor-agent` binary is still **not installed on this machine** (`runner-binary.js` probe: `reason:"missing_binary"`) — an environment fact, not the reason for the refusal (the adapter would refuse identically with the binary present). `run.sh execute` self-refuses with both reasons before any dispatch. |
| Fable | claude-fable-5 / claude-native | consult | **PASS** (exit 0) | **READY for --plan; --execute UNVERIFIED live** — `claude` CLI present (2.1.251), staged exam `CLAUDE_CONFIG_DIR` lets `claude --version` succeed with the real `~/.claude/.claude.json` mtime unchanged before/after; the paid `claude -p "reply PONG" --model claude-fable-5` probe was deliberately NOT run (this administration is scoped to free `--plan` smokes only — see § "Seat Fable" below) |

### Seat 7 (kimi) — assembled 2026-08-29, quota confirmed back

Seat 7 was Board-deferred for quota at the 2026-08-28 authorization and had
no directory in this bundle; quota is now confirmed back (a live
`kimi -m kimi-code/k3 -p ...` probe returned PONG cleanly on this machine
just prior to this seat's assembly). `seat7-kimi-k3-kimi-consult/run.sh`
reuses the SAME corpus-v6 consult identity every other consult seat in this
bundle carries (`PROMPT_CONFIG_HASH`/`SEMANTIC_FINGERPRINT`/
`CONTAINMENT_FINGERPRINT`/`HARNESS_VERSION` all copied verbatim from the
table above — the exam assets are identical across engines, only
engine/runner/model identity differs per seat). `--engine kimi-code-k3`,
`--model kimi-code/k3` (exact vendor id, `MODEL_ID` regex allows `/`),
`--model-version kimi-code-k3` (operator-asserted, slash-free — `--model-
version` is a strict `TOKEN` and `engine-qualify.js`'s `TOKEN` regex rejects
`/`, unlike `MODEL_ID`), `--runner kimi`, `--family moonshot`
(`src/readiness/status.js:38`: `/(kimi|moonshot)/` → `'moonshot'` — no prior
kimi scorecard row existed locally to cross-check against, so this is the
runner's own canonical family mapping), `--effort high` (receipt-only —
`qualification-review-provider.js`'s `kind === 'kimi'` branch in `callCli()`
passes no `--effort` flag; kimi's thinking is a config.toml boolean, not an
argv parameter — `high` here matches the other consult seats' calibrated
tier the same way seat 3's `EFFORT="default"` and seat 6's
`EFFORT="baked-in-model-name"` are receipt-only labels, not enforced
transport parameters). `--runner-version` captured live via
`scripts/lib/runner-binary.js version --runner kimi --json` → `0.39.1`
(fail-closed, never guessed). `QRP_CLI_HOME` staged credential-only
(`config.toml`, `credentials/kimi-code.json`, `oauth/kimi-code`,
`device_id` — 28 KB total) into
`$HOME/.autopilot/qualify-staging/seat7-kimi-k3-kimi-consult/kimi-home/`,
same posture as seat 6's agy staging and per
`qualification-review-provider.js`'s own `QRP_CLI_HOME` header note ("Same
posture as CODEX_HOME / KIMI_CODE_HOME" — kimi keeps credentials under
`$HOME/.kimi-code` and exposes no config-dir env var of its own); NOT the
full `~/.kimi-code` (≈90 MB with cache/sessions/logs), which would blow the
adapter's 8 MB template cap. `bash run.sh plan` smoke: **PASS**, exit 0,
`admission.pass:true`, `checked_cases:20`, `negative_control_admission_
failed:true` (the D3 negative control was caught). Confirmed no credential
material landed under `docs/` (`git status` after the smoke shows only
`seat7-kimi-k3-kimi-consult/` itself — `run.sh`, `raw/`, `plan-out.json` —
staged in `$HOME/.autopilot/qualify-staging/`, outside the repo).

### Seat Fable (claude-fable-5) — assembled 2026-08-29, native Claude auth

Fable is a NATIVE Claude model, not a third-party seat: it runs through the
SAME QRP `claude` adapter as seat 3 (MiniMax) / seat 4 (GLM) —
`QRP_CLI_KIND=claude` → `claude -p <prompt> --model <model>` — but points
that adapter at the REAL Anthropic API using the user's own Claude
credentials, never `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` (that pattern
is what cc-shim seats 3/4 use to redirect the claude CLI to a third-party
Anthropic-compatible endpoint; Fable has no third-party endpoint to
redirect to). `seat-fable-consult/run.sh` reuses the SAME corpus-v6 consult
identity every other consult seat in this bundle carries
(`PROMPT_CONFIG_HASH`/`SEMANTIC_FINGERPRINT`/`CONTAINMENT_FINGERPRINT`/
`HARNESS_VERSION` all copied verbatim from the table above — the exam
assets are identical across engines, only engine/runner/model identity
differs per seat).

`--engine claude-fable-5`, `--model claude-fable-5`, `--model-version
claude-fable-5` (operator-asserted — the claude CLI reports no build id
distinct from the model id; `claude --help` on this build (2.1.251) cites
`'claude-fable-5'` verbatim as an example full model name for `--model`,
which is free corroborating evidence the string is real without spending
anything). `--runner claude-native` — **not** `cc-shim`: confirmed via
`node scripts/lib/runner-binary.js version --runner claude-native --json`
→ `{"ok":true,"binary":"claude","runner":"claude-native",...}`, while
`--runner claude` alone resolves to `{"ok":false,"reason":"unknown_runner"}`
on the same script; `src/readiness/status.js`'s runner allowlist also
carries `claude-native` explicitly. `--family anthropic`
(`src/readiness/status.js:32`: `/(claude|opus|sonnet|haiku)/` →
`'anthropic'`). `--effort high` (receipt-only — `qualification-review-
provider.js`'s `callCli()` `else` branch, which every non-agy/kimi/codex
kind including `claude` falls into, passes no `--effort` flag at all; `high`
here is an honest label matching the other consult seats' calibrated tier,
same posture as seat 3's `EFFORT="default"` and seat 7's `EFFORT="high"`).
`--runner-version` captured live via `scripts/lib/runner-binary.js version
--runner claude-native --json` → `2.1.251 (Claude Code)` (fail-closed, never
guessed).

**Config-dir staging (the CLAUDE_CONFIG_DIR TRAP, mirrored from seat 3's
SAFE pattern but pointed at native auth):** `run.sh` stages
`$HOME/.autopilot/qualify-staging/seat-fable-consult/claude-home/`
containing ONLY `.credentials.json` (copied once from the real
`~/.claude/.credentials.json`, idempotent, mode 700/600) — never a symlink
to or copy of the whole `~/.claude` tree, never written under `docs/`.
Verified 2026-08-29, this machine:
- `stat` on `$HOME/.claude/.claude.json` before staging/probing:
  `2026-08-17 17:35:33.947601334 +0800` (mtime `1786959333`).
- `CLAUDE_CONFIG_DIR=<staged dir> claude --version` → `2.1.251 (Claude
  Code)`, exit 0.
- `stat` on `$HOME/.claude/.claude.json` immediately after: byte-identical
  timestamp, `2026-08-17 17:35:33.947601334 +0800` — **not reset**.
- The staged dir's own contents after the probe: still just
  `.credentials.json` (the `claude` CLI did not write a fresh
  `.claude.json` or any other file into the staged dir on a `--version`
  call).

**What this bundle could NOT honestly verify for Fable:** a live headless
`claude -p "reply PONG" --model claude-fable-5` call under the staged
config dir was **not run**. That call would reach the real Anthropic API
and spend money; this administration is scoped to free `--plan` smokes
only, per the task's own "execute NOTHING paid" boundary. So while
`--version` proves the staged credentials authenticate the CLI process
itself, and `claude --help`'s own example text corroborates the model
string, whether `claude-fable-5` is actually reachable and returns a
completion under these exact staged credentials remains unverified until a
Board-authorized `--execute` (or an explicitly-approved standalone PONG
probe) is run.

`bash run.sh plan` smoke: **PASS**, exit 0, `admission.pass:true`,
`checked_cases:20`, `negative_control_admission_failed:true` (the D3
negative control was caught, matching every other consult seat).
Confirmed no credential material landed under `docs/` (`git status` after
the smoke shows only `seat-fable-consult/` itself — `run.sh`, `raw/`,
`plan-out.json` — with the staged credentials in
`$HOME/.autopilot/qualify-staging/`, outside the repo).
| — | grok-4.6 / grok | consult | **PASS** (exit 0) | **READY** (new this round) — `docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/seat-grok-4.6-consult/`. grok 1.0.13 present, `grok models` confirms `grok-4.6` as the default/available engine (grok-4.5 also listed but not used — 4.6 is newer and available on this rail), credential-only exam `GROK_HOME` clone staged. This repairs the event-149 rail-attributed failure the Board decision cited as unrepaired at authorization time. |

## Kernel argv fields this bundle could not honestly populate as "verified"

- **Seat 8's `--remote-provider-cmd`/`QRP_CLI_KIND`**: `qualification-review-
  provider.js` now HAS a `cursor` CLI kind, so the argv shape below is no
  longer speculative — but that kind is a deliberate unconditional refusal
  (see the Seat readiness table above), so `--execute` still cannot reach the
  real transport. (Seat 5's `qoderclicn` kind is fixed this round — this
  no longer applies to it; see the Seat readiness table.)
- **Seat 8's `--runner-version`**: since the `cursor-agent` binary is absent
  on this machine, `run.sh` cannot re-probe it live. It falls back to the
  last known-good probed value from the 2026-08-27 implementer bundle
  (`2026.08.25-3e8eec8`), explicitly labelled as **not re-verified today** in
  both the script's stderr and this table. A real `--execute` must re-probe
  first.
- **`--effort` for cc-shim/agy seats**: `QRP_CLI_EFFORT` is forwarded to the
  `codex`, `grok`, and `qoderclicn` CLI kinds (grok clamped through
  `grokEffortClamp()`, matching `scripts/lib/grok-effort.sh`'s table exactly;
  qoderclicn passed through raw — it tolerates all 5 levels, no clamp
  needed); for `claude`/`agy`/`kimi`/`cursor`, `--effort` stays a
  receipt-only identity classification, not an enforced transport parameter
  (agy/kimi bake the tier into the model name; cursor never reaches a
  transport at all). Seat 6's `EFFORT="baked-in-model-name"` and seat 3's
  `EFFORT="default"` are honest labels for "not enforced, no better data"
  rather than a measured value.
- **A real `--execute` grading outcome for any seat**: by design, nothing in
  this bundle produces one — that is the Board's separate, explicit
  authorization to spend, not something this administration-scripts task is
  scoped to trigger.
- **Fable's live headless reachability**: `claude --version` proves the
  staged exam config dir authenticates the CLI process; it does NOT prove a
  real `claude -p ... --model claude-fable-5` completion succeeds under
  those credentials. That call was not made (paid, out of scope for this
  bundle) — see § "Seat Fable" above.
