# gpt-6.1-terra (codex / low) six-role qualification (2026-10-27)

One seat sat all six roles on llm-playground@cookys-7840hs. This bundle carries every row
(6 qualified, 0 failed) so aimax395 can import them into its single scorecard and rebuild
`official-qualification-defaults` there. Nothing here was written into a scorecard or capability
store on 7840hs: the exams ran through `intake-qualify.py` with a scratch store and `--emit-record`.

**All six rows are proposed for the official defaults.**

## Seat

| lane | engine | runner | runner_version | effort | family |
|---|---|---|---|---|---|
| terra | `gpt-6.1-terra` | codex | codex-cli-0.164.0 | low | openai |

`version_source` is `operator-asserted` on every row.

## Results

| bundle dir | role | date | status | corpus_pass | corpus_version | harness_version | prompt_config_hash |
|---|---|---|---|---|---|---|---|
| `terra-implementer` | implementer | 10-27 | **qualified** | 24/24 | impl-live-rail-v1.impl-live-rail-v1 | dispatch-hetero:7481ead3 | 16b45e1a0ed1… |
| `terra-reviewer` | reviewer | 10-27 | **qualified** | 42/42 | reviewer-known-bad-clean-v2.reviewer-metamorphic-v6 | engine-qualify-6babfefb | 3cbe203c5958… |
| `terra-verification_author` | verification_author | 10-27 | **qualified** | 24/24 | va-declared-plan-v1.va-declared-plan-v1 | engine-qualify-6babfefb | 99d8c8386b23… |
| `terra-owner` | owner | 10-27 | **qualified** | 12/12 | owner-intent-control-v1.owner-intent-control-metamorphic-v1 | engine-qualify-6babfefb | 72a9552a6549… |
| `terra-consult` | consult | 10-27 | **qualified** | 60/60 | consult-v6.consult-eval-generator-v1 | engine-qualify-6babfefb | 1479cfe29685… |
| `terra-discuss` | discuss | 10-27 | **qualified** | 48/48 | discuss-v4.discuss-v1 | engine-qualify-6babfefb | 977f546946ba… |

Full hashes and every other field are in each dir's `qualify-out.json`; `manifest.json` is the
same table in machine form. The implementer `prompt_config_hash` equals the gpt-6.1-sol codex
implementer's.

## How the exams were run

- autopilot checkout during every exam: develop `c9366c79a` (the 7840hs working tree's reflog shows
  it fast-forwarded to `c9366c79a` at 14:26 and not moved again until 21:13; the implementer exam finished 16:56 and the last role exam 17:23).
- Implementer (finished 16:56): `intake-qualify.py` → dispatch-hetero `impl-live-rail-v1`, seat effort
  `low` → `engine-qualify --effort low` → dispatch-hetero passes `-c model_reasoning_effort=low` to codex.
- Other roles (17:0x–17:23): `drivers/chain.sh terra:reviewer terra:verification_author terra:owner
  terra:consult terra:discuss` → `drivers/sit.sh terra <role>` → `intake-qualify.py`; identity and flags
  from `drivers/derive.js` (it derives `prompt_config_hash` from the autopilot checkout). Log:
  `drivers/terra-chain.log`. `sit.sh` / `derive.js` are the k31imp drivers plus the `terra` lane:
  a `CODEX_HOME` seeded with `auth.json` only (never the live `~/.codex`), deleted after the run.
- **Effort evidence is not equally strong across rows.** While the reviewer exam ran, the operator read its
  codex rollout and saw `model=gpt-6.1-terra`, `effort=low` at the request level; that rollout lived in the
  per-exam `CODEX_HOME` and was deleted with it, so it is not in this bundle. For the implementer and the
  other four roles the evidence is the code path above plus the seat (`effort: "low"` in each
  `seat-<role>.json` and intake log). No row's `raw/` carries effort (the usage jsonl has no effort field).
- `drivers/assemble-bundle.py` — the script that built this bundle (k31imp's, with `SEATS` set to terra and
  one more source glob for the implementer scratch dir). Fails closed if a row has 0 or >1 sources, if
  `emitted.raw` differs from the ingested row, or if the anchor does not resolve.

No credentials are included.

## Directory layout (per `terra-<role>/`)

Same as `2026-10-26-k31-beam-longcat-qualify/`: `qualify-out.json` (scorecard row = `raw` of the
emitted record, equal on every recipe cross-check field to the record ingested in llm-playground
`benchmarks/qualification/cookys/`), `emitted-record.json`, `final-<role>.json`,
`capability-evidence.jsonl` (the one wrapper the `evidence_store` anchor resolves to),
`seat-<role>.json`, `raw/`.

**Anchor caveat:** `evidence_store.event_id` numbers the intake's *scratch* store (it is 1 on all 6 rows),
not aimax395's capability store. On import the wrapper has to be appended to the real capability store
and the row's anchor re-pointed to the event id it receives there.

**No `expires`:** the exams ran after autopilot noexpiry; no row, record or evidence wrapper in this
bundle carries `expires` / `expires_at`.

## Original locations on 7840hs

- roles: `~/.autopilot/qualify-drivers/roles/out/terra-<role>/scratch/<role>/`
- implementer: `/tmp/claude-1000/-home-cookys-projects-llm-playground/44b9af4a-6e4a-4328-bed5-f47d430fa1e7/scratchpad/terra-impl/implementer/`

The `/tmp` copy is not durable; this bundle is the copy of record.
