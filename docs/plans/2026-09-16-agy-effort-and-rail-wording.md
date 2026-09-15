# agy effort follows the resolved model tier, and three rail refusals name their remedy

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `agy-effort-rail-wording-2026-09-16`). Four small items from four BACKLOG rows, all measured on this
> host 2026-09-16; each is a one-file mechanism or wording change, so they ship as one campaign.
> Source rows (`docs/BACKLOG.md`): "PEER-REPORTED (308-8f): agy flash-medium hand without `--effort
> medium` only edits" (Fix); "/l5 wording: verification-author seat error lacks the remedy; CLI `status
> readiness --probe` is always probe-needed" (S); "Intake dirty-tree precondition on a shared main
> checkout: the refusal does not name the clean-worktree remedy" (S).

## 0. What is actually broken (measured 2026-09-16, agy 1.2.3 on this host)

### 0.1 agy: the alias tier and `--effort` can disagree, and agy 1.2.3 refuses the pair

`scripts/lib/agy-model-alias.sh` resolves `gemini-flash-<tier>` to a live id that ENCODES the tier
(`gemini-3.8-flash-medium`); the three rails then pass `--effort "$(agy_effort_clamp "$EFFORT")"` where
`EFFORT` defaults to `xhigh` → `high`. Live probe:

- `--model gemini-3.8-flash-medium` with no `--effort` → `SUCCESS` (agy takes the tier from the id).
- `--model gemini-3.8-flash-medium --effort high` → `ERROR: --model gemini-3.8-flash-medium conflicts
  with --effort=high` (exit non-zero, no turn).
- `--model gemini-3.8-flash` (bare) with no `--effort` → `ERROR: requires --effort (available: low,
  medium, high)` — the case the 2026-09-05 fix (`18f46faf`) handled.

So every agy dispatch whose alias tier ≠ clamped effort (e.g. `gemini-flash-medium` under the default
`xhigh`, or `gemini-flash-low` under `--effort high`) dies at the vendor on agy ≥ 1.2.x. 308-8f's report
("flash-medium hand … only edits") is the same pair seen through an older agy that did not refuse; the
rail as shipped never omits `--effort`, so "missing effort" is not the defect — the CONFLICT is.
`dispatch-explore.sh` passes no `--effort` at all (read-only rail); it is OUT of scope here — it
never resolves aliases through the shared helper today, and a bare-id failure there is a separate
row if it ever fires.

### 0.2 strict /l5 roster: the verification-author refusal names the seat, not the fix

`src/readiness/provider-bootstrap.js:351`: `strict /l5 requires the verification-author seat`. The
operator who hits it (cuda, 2026-09-16) does not learn that the remedy is
`verification_author_present: true` + the four `verification_author_*` keys in
`.claude/review-loop-config.md` (or running at l4, where the seat is optional).

### 0.3 `status readiness`: the bootstrap fallback is silent

`src/status/cli.js:472-506` derives the strict bootstrap; when `createStrictL5ProviderBootstrap` throws
(roster unresolvable, seat not first-class, etc.) it falls back to the provider-less view and the
qualification axis reads `unknown` → `probe-needed` even with `--probe`. Nothing tells the operator the
bootstrap failed or why. On this host the bootstrap builds and `--probe` reports `usable` for all six
seats (2026-09-16), so cuda's "always probe-needed" is the fallback path with its reason swallowed.

### 0.4 intake dirty-tree refusal has no remedy

`src/engine/repo-preconditions.js:57`: `dirty: repository has uncommitted changes`. Expected usage
since v2.36.48 is a clean checkout — a shared main checkout with another line's files is refused by
design; the message should say what to do.

## 1. Ruling and shape

1. **Effort follows the resolved model.** New helper `agy_effort_for_model <resolved-model> <effort>`
   in `scripts/lib/agy-model-alias.sh`: if the resolved id ends in `-low|-medium|-high`, print that
   tier; otherwise print `agy_effort_clamp <effort>`. All three rails (`dispatch-hetero.sh:3441`,
   `dispatch-review.sh:1412`, `dispatch-author.sh:1140`) call it with the RESOLVED `$MODEL`.
   `agy_effort_clamp` stays (other callers, tests). When the alias suffix and `--effort` disagree, the
   suffix wins — the same precedence `agy_resolve_model_alias` already states — and the rail emits one
   stderr note `agy effort <effort> folded to <tier> (model id encodes the tier)` so the fold is visible.
2. **VA refusal names the remedy**: message becomes
   `strict /l5 requires the verification-author seat: set verification_author_present: true and
   verification_author_engine/runner/effort/endpoint in .claude/review-loop-config.md (l4 does not
   require it)`. Code `strict_l5_provider_roster_incomplete` unchanged.
3. **Readiness fallback is loud**: when the bootstrap throws, `status readiness` writes one stderr line
   `readiness: strict bootstrap unavailable (<code or message>) — qualification axis reads unknown;
   the engine path would refuse with the same reason` and continues exactly as today. The JSON gains
   nothing; `--probe` semantics unchanged. `bin/autopilot.js` usage line for `status` documents
   `--probe` with this exact semantic content: "bounded live spend: runs per-seat transport and
   live probes" (`quota --probe` stays a no-spend safe probe, said in the same line).
4. **Dirty-tree refusal names the remedy**: `dirty: repository has uncommitted changes (commit them, or
   pass a clean checkout/worktree as --cwd)`. The `campaign_repo_precondition_failed` code and the
   `dirty:` prefix are unchanged (the state suite matches on the prefix).

## 2. Changes by file

- `scripts/lib/agy-model-alias.sh` (+ codex mirror): `agy_effort_for_model`; header comment gains the
  1.2.3 conflict rule with the probe lines above.
- `scripts/dispatch-hetero.sh`, `scripts/dispatch-review.sh`, `scripts/dispatch-author.sh` (+ mirrors):
  replace `$(agy_effort_clamp "$EFFORT")` with `$(agy_effort_for_model "$MODEL" "$EFFORT")` at the agy
  exec sites only; add the stderr note where the fold changes the value.
- `src/readiness/provider-bootstrap.js` (+ mirror): message text only.
- `src/status/cli.js` (+ mirror): catch block writes the stderr note; keep the fallback.
- `bin/autopilot.js` (+ mirror): usage text for `status … [--probe]`.
- `src/engine/repo-preconditions.js` (+ mirror): message text only.
- `docs/BACKLOG.md`: three rows' Context corrected (308-8f row: the conflict, not a missing flag);
  Status is stamped by depth-0 at release.
- Tests (every change-pinning assertion carries `# RED at base <sha>: <observed>` in its block header
  with the base sha of the sealed contract; every preservation guard is labelled `(preservation,
  green at base)`; all suites drive STUBS only — agy/codex/grok/cc-shim binaries and endpoints are
  fixtures, the single live probe is the §5 dogfood outside the suites):
  - `hooks/tests/dispatch-hetero.test.sh`, `hooks/tests/dispatch-review.test.sh`,
    `hooks/tests/dispatch-author.test.sh` — in EACH: (i) alias `gemini-flash-medium` under the default
    effort → the agy stub receives `--effort medium` (RED at base: `high`); (ii) `gemini-flash-high` with
    `--effort low` → `--effort high` AND exactly one stderr line naming `low`, `high`, and "model id
    encodes the tier" (RED at base: `high` with no note — the value coincides, the note is the
    discriminator); (iii) `gemini-flash-high` with `--effort high` → `--effort high` and ZERO such lines
    (preservation); (iv) non-suffixed agy id (`AGY_STUB_MODELS` inventory with a bare id) under `xhigh`
    → `--effort high` (preservation); (v) grok, codex, cc-shim: the complete argv the stub records is
    byte-identical to a literal expected string (preservation, labelled; add the argv capture to the
    stub where the suite lacks it).
  - `hooks/tests/status-cli.test.sh`: bootstrap failure (unresolvable roster fixture) → stdout JSON
    deep-equals the provider-less receipt the base emits for the same fixture (captured as the
    expected object in the test, digest fields normalized), exactly one stderr line matching
    `^readiness: strict bootstrap unavailable \(.+\)`, exit 0 (RED at base: zero stderr lines);
    successful bootstrap → no such stderr line (preservation).
  - `hooks/tests/autopilot-cli.test.sh`: usage text contains `--probe` and the phrases "bounded live
    spend" and "per-seat transport and live probes" (RED at base).
  - `hooks/tests/implementation-campaign-state.test.sh:5160` region: the dirty reason matches
    `^dirty: repository has uncommitted changes \(commit them, or pass a clean checkout/worktree as --cwd\)$`
    (RED at base) and `rejection.code === 'campaign_repo_precondition_failed'` (preservation).
  - `hooks/tests/provider-readiness-consumer.test.sh` (+ `autopilot-cli.test.sh` where it asserts the
    text): the missing-VA refusal message contains `verification_author_present: true` and
    `.claude/review-loop-config.md` (RED at base); code unchanged (preservation).
- Sealed `output_paths` (exact; anything else is a boundary rejection):
  `scripts/lib/agy-model-alias.sh`, `scripts/dispatch-hetero.sh`, `scripts/dispatch-review.sh`,
  `scripts/dispatch-author.sh`, `src/readiness/provider-bootstrap.js`, `src/status/cli.js`,
  `src/engine/repo-preconditions.js`, `bin/autopilot.js`, their codex mirrors
  `platforms/codex/plugin/scripts/lib/agy-model-alias.sh`, `platforms/codex/plugin/scripts/dispatch-hetero.sh`,
  `platforms/codex/plugin/scripts/dispatch-review.sh`, `platforms/codex/plugin/scripts/dispatch-author.sh`,
  `platforms/codex/plugin/src/readiness/provider-bootstrap.js`, `platforms/codex/plugin/src/status/cli.js`,
  `platforms/codex/plugin/src/engine/repo-preconditions.js`, `platforms/codex/plugin/bin/autopilot.js`,
  the six test files above, and `docs/BACKLOG.md`. `CHANGELOG.md` is a depth-0 release action, not
  sealed. Version pinned **v2.36.54** (after campaign A's v2.36.53; resealed if the numbering moves).

## 3. Out of scope

- Per-seat default efforts in `resolve-dispatch.sh` (the BACKLOG row's speculative remedy) — not
  needed once the model id governs.
- Any change to `--probe` behaviour, the qualification provider, or readiness receipt schema.
- `dispatch-explore.sh` entirely (no alias resolution, no `--effort` today).

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `agy-effort-follows-id` | for a resolved id with a tier suffix the agy exec receives `--effort <suffix>` on all three rails regardless of `--effort`; without a suffix it receives the clamped effort | dispatch-hetero/review/author suites |
| `fold-visible` | on all three rails: exactly one stderr note (requested effort, folded tier, model-id reason) when the fold changes the value, zero when it does not | hetero/review/author suites |
| `va-remedy` | the VA refusal text contains `verification_author_present: true` | bootstrap suite |
| `readiness-fallback-loud` | a failing bootstrap prints exactly one stderr note with the thrown code/message, exits 0, and the stdout receipt deep-equals the base's provider-less receipt; a successful bootstrap prints none | status CLI suite |
| `dirty-remedy` | the dirty refusal text contains `--cwd` remedy; prefix `dirty: repository has uncommitted changes` preserved | state suite |
| `no-regression` | `dispatch-hetero.test.sh`, `dispatch-review.test.sh`, `dispatch-author.test.sh`, `implementation-campaign-state.test.sh`, `provider-readiness.test.sh`, `provider-readiness-consumer.test.sh`, `autopilot-cli.test.sh`, `status-cli.test.sh` green; `check-js-syntax.js`; `sync-codex-plugin-skills.sh --check`; `check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0 after the three Context edits | suite output |

## 5. Dogfood proof (depth-0, after merge)

One real `dispatch-review.sh --runner agy --model gemini-flash-medium` (any small diff) on this host
returns a verdict instead of the vendor conflict error; recorded at the BACKLOG row pointer.

## Review log

- G1 (GLM-5.2 CONDITIONAL 2 minor, gpt-5.6-sol STOP 6 blockers; all 8 accepted and folded): RED-at-base
  sha headers + labelled preservation guards + stub-only rule stated; note assertions (one/zero) on all
  three rails; byte-identical argv guards for grok/codex/cc-shim in all three suites; readiness receipt
  deep-equal; `--probe` usage semantic pinned + CLI assertion; `dispatch-explore.sh` ruled out; exact
  sealed `output_paths` enumerated; `check-backlog-entries.js` in acceptance; version pinned v2.36.54.
