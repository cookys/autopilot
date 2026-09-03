# Qualification feed: adopt `--from <url|path>`, effort in the seat, environment ≠ exam identity

Status: **shipped — v2.35.9** (merge `28bc2c78`; project README archived under `docs/projects/_archive/2026-09-02-qualification-feed-adopt/`). Original handoff framing kept below for the record. Owner: the autopilot session on aimax395. Board decisions and
the feed contract are fixed (llm-playground plan 065, private repo); this doc carries everything
needed here. Report back over the fleet relay to the llm-playground session on cookys-7840hs with
the commit sha.

## Background (why)

Every autopilot user who enables a hetero role pays 24 dispatches per seat to qualify it. The
"adopt someone else's administration" path already exists (`references/qualification-defaults.md`,
`scripts/adopt-qualification-defaults.js`) but the artifact is baked into the plugin release: static,
17 rows, invisible, and it cannot carry the board score or later strikes. The maintainer's
administrations are now a committed ledger in llm-playground (plan 064) and will be published as a
public feed from model-dyno. This side makes autopilot able to **opt in** to that feed.

Board decisions (2026-09-02, verbatim intent):
1. Feed carries the maintainer's (cookys) administrations only; schema keeps an `owner` field.
2. **A licence does not expire by calendar.** Revocation comes from strikes ("caught being
   unreliable → re-exam"), a model_version change, or a new corpus/prompt contract. This matches
   `engine-scorecard.js` today (calendar advisory, `expiry_warning`) — do not add a calendar gate.
3. Board priors ride along in the same feed.
4. Evidence bundles link to this public repo (`docs/plans/evidence/...`).

Board correction that changes this repo's contract: **"the exam tests the model, it should not be
pinned to the autopilot version."** Verified facts behind it:
- `scripts/engine-scorecard.js:108` `CONFIGURED_IDENTITY_FIELDS` = engine, runner, role,
  corpus_version, **harness_version, runner_version**, prompt_config_hash. An adopted row matches a
  consumer only when the consumer's `dispatch-hetero:<sha>` and CLI version are byte-equal to the
  maintainer's. Today's shipped defaults are all `dispatch-hetero:003d7975`; a consumer on any
  later plugin silently never matches them (no error — the row just never applies).
- **`effort` is not in the seat identity.** Real data: grok-4.6 @high FAILED (23/24,
  `integrity_violations: 1`, 2026-08-21) and grok-4.6 @low QUALIFIED (24/24, 2026-08-24) are, to
  `seat-status --engine grok-4.6 --runner grok --role implementer`, one seat with latest-wins.
  `engine-capability-state.js current --effort` already partitions by effort; the scorecard side
  does not.
- `src/engine/capability-evidence.js:323` `grantIdentityProjection` is the full identity (no
  relaxation exists anywhere yet).

## Spec (what, not how)

1. **Seat identity gains `effort`** everywhere a seat is keyed (scorecard identity fields, seat-hash,
   seat-status, ladder/report projections, strike seat identity). Legacy rows without effort keep
   matching as their own partition (`current --effort` already has the "omit only for legacy rows"
   rule — extend that semantics, do not invent a second one).
2. **Split identity into exam identity vs environment.** Exam identity = engine, runner, role,
   effort, corpus_version, prompt_config_hash — must match. Environment = harness_version,
   runner_version — recorded, projected, shown as a warning on mismatch (`environment_warning` next
   to `expiry_warning`), **never gating**. Update `skills/engine-onboarding/SKILL.md` Stage 4 (line
   ~235 currently says harness/runner mismatch ⇒ inapplicable) and `references/strike-decay.md` /
   `qualification-defaults.md` wherever they restate the old rule.
3. **`adopt-qualification-defaults.js list|adopt --from <https-url|path>`.** Pattern to copy:
   `scripts/import-aa-capabilities.js` (bounded fetch, content-addressed cache under
   `~/.autopilot/qualification-feeds/<digest>/`, `current` manifest, TTL for refresh). Behaviour:
   - `list --from` prints the feed's disclosure block verbatim, then per entry: seat (with effort),
     status, corpus, exam identity match vs the caller's live identity, environment match
     (warn-only), board block if present, evidence_url.
   - `adopt --from` copies rows + capability-evidence wrappers exactly as `adopt` does today
     (producer/transcript_hash preserved, dedupe-idempotent), and stamps the scorecard row with
     `adopted_from: {url, digest, fetched_at}`. Never auto-adopts; never on a timer.
   - refresh (`list --from` on a newer digest) reports the diff for already-adopted seats: new
     administration, superseded by FAILED, strike present upstream. Reporting only — local
     revocation stays with seat-status / strikes.
   - `--priors`: feed `priors[]` are compile-ready `external_prior` records; append them through the
     existing `record-evidence` path (producer `operator-record-v1`), same TTL semantics as AA.
   - Optional `~/.autopilot/config.json` `qualification_feed.url` so `--from` can be omitted. Opt-in
     only; absence changes nothing.
4. Feed shape is **this repo's own artifact** (`references/official-qualification-defaults.json`,
   `schemas/official-qualification-defaults.schema.json`) plus additive fields:
   `seat.effort`, `feed{owner, origin_host, record_id, source_kind, legacy, evidence_url, board_cell,
   board_join}`, `board{…integers only…}`, top-level `strikes[]`, `priors[]`, `semantics`,
   `harness_versions[]`, `digest`. Sample: `docs/plans/evidence/2026-09-02-qualification-feed/sample-feed.json`
   (29 defaults, 1 strike, 53 priors, built from the real ledger). `legacy: true` entries have no
   `capability_evidence` — treat like today's legacy rows.

Out of scope here: signing/attestation (ADR-0001 forbids), changing `SOURCE_STATE_CEILINGS`, any
new evidence producer, auto-adoption.

## Traps (all observed, not hypothetical)

- **Tests writing into the real store.** `hooks/tests/engine-qualify.test.sh` appended 100
  `eng-review` reviewer rows to `~/.autopilot/engine-scorecard/scorecard.jsonl` between 2026-06-30
  and 2026-07-24 (the maintainer's real ledger; llm-playground now filters them). Every new test
  must isolate with `--store` / `ENGINE_CAPABILITY_DIR` / `ENGINE_SCORECARD_DIR`; add a guard that
  fails the suite if a test touches `~/.autopilot`. Fixing that existing test is in scope.
- `scripts/validate-json-schema.js` rejects non-integer JSON numbers (BACKLOG:143). The feed's
  `board` block is integers for that reason; `capability_score` floats already exist in the shipped
  artifact and are normalised to 0 before validation today — keep whatever rule the build uses.
- `check-claude-md-inventory.js` enforces the four-place wiring rule (CLAUDE.md "When adding a new
  script"): reference doc, SKILL table (`skills/engine-onboarding/SKILL.md` scripts table), 
  `docs/scripts-inventory.md`, CLAUDE.md grouped list. Changing a script's contract means updating
  its header + inventory row too.
- `build-qualification-defaults.js --check` byte-compares the shipped artifact against a
  re-derivation. Adding `seat.effort` to the shipped artifact changes its bytes — bump
  `recipe_version`, regenerate, keep `--check` green.
- Test runner is `bash hooks/tests/run.sh --parallel` (node:test); CI needs `shell: bash` pipefail
  (2026-07-16 green-over-red incident).
- Suite green is not proof a script runs (CLAUDE.md caution): prove `adopt --from` end to end
  against the sample feed into a throwaway store, and paste the command + output in the evidence
  dir.

## Tests / acceptance

- `adopt-qualification-defaults.js list --from docs/plans/evidence/2026-09-02-qualification-feed/sample-feed.json`
  prints disclosure + 29 entries with exam/environment applicability; `adopt --from … --role
  implementer --store <tmp>` writes rows with `adopted_from`; second run is a no-op.
- `engine-scorecard.js seat-status --engine grok-4.6 --runner grok --role implementer --effort low`
  and `--effort high` disagree (qualified vs failed); omitting `--effort` follows the legacy rule.
- An adopted row whose `harness_version` differs from the live one projects `qualified` with
  `environment_warning: true`, not `inapplicable`.
- `--priors` appends provisional `external_prior` rows via `record-evidence`; nothing in the feed can
  produce a `qualified` row that was not `internal_eval` upstream.
- No test touches `~/.autopilot` (guard in place; the offending existing test fixed).
- `bash hooks/tests/run.sh --parallel`, `node scripts/check-claude-md-inventory.js`,
  `node scripts/build-qualification-defaults.js --check` all green.

## Report back

`fleet send --instance 01M1G0G3C35PY9AQNC5HQDJ1MB "<commit sha> + what changed + anything in the
feed contract that had to change"` — the llm-playground side (producer, publish workflow, dyno page)
is being built in parallel against the same sample; a contract change needs both sides.
