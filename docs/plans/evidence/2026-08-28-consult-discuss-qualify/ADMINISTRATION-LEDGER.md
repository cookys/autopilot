# Administration ledger — consult / discuss qualification (2026-08-28 → 2026-08-29)

Board authorization: `PROPOSAL.md` § "Board decision — 2026-08-28 (authorization)". This ledger
records what actually happened when that authorization was spent — how it was tested, who passed,
who failed, and who never sat the exam. Every verdict below is read directly from the frozen
`execute*-out.json` receipts under `administration/<seat>/`, cross-checked against the corpus_version
byte-identical to the current `evals/consult-capability-evidence-corpus.json` (`consult-v6`) and
`evals/discuss-capability-evidence-corpus.json` (`discuss-v3`).

## (a) How it was tested

**Instrument lineage.** `consult` went through 5 real-money-surfaced fixes before reaching its final
form, `consult-v6`:

1. `consult-v1` (wave-1 baseline, commit `95bf81bf`) — every real engine scored **0/20**, all
   `protocol_violations`. The instrument, not the engines, was broken.
2. `consult-v2` → envelope disclosure fix (commit `d4f9fba1`) — closed-vocab disclosure, dropped a
   fabricated-id requirement, envelope-only stub guard.
3. `consult-v3` → agy containment repair (commit `c400988c`) — hetero-review findings on the agy
   transport fix.
4. `consult-v4` → C4/C5 relax (commit `02ab8fe8`) — the instrument was overstrict on two case
   families, not the engines under test; `gpt-5.6-sol` cleared 20/20 zero-violation here.
5. `consult-v5` → aside-prompt contract honored (commit `9c6baea0`) — the grader was contradicting
   its own aside-channel prompt.
6. `consult-v6` → aside-channel coherence, second pass (commit `acbd8ba0`) — closed two remaining
   hetero-review holes in the same fix.

`discuss` went through its own fix to `discuss-v3` (round_id type coercion + prompt disclosure
clarity, commit `7a90d9f9`), after an initial `discuss-v1` baseline that also scored 0/16 on real
engines for instrument reasons.

**End-to-end validation before real spend.** Before any paid administration, the corrected
instrument was solved by an honest-candidate solver: 20/20 on consult, 16/16 on discuss, zero
protocol/aside violations — proving the instrument itself was passable by a compliant answer before
real money was spent finding out whether real engines were.

**It took 3 paid rounds** (2026-08-28 through 2026-08-29) because real engines surfaced instrument
bugs that the cheating-stub tests never could: `consult-v1` and `discuss-v1` both scored every real
engine at 0/N, all `protocol_violations` — a result that only makes sense as "the grader is broken,"
which is exactly what it was. Each subsequent round fixed what the previous round's real failures
exposed.

**Transport per engine**, all containment-verified before administration:

| Engine | Runner | Transport |
|---|---|---|
| `gpt-5.6-sol` | `codex` | codex-cli, QRP CLI transport |
| `MiniMax-M3` | `cc-shim` | cc-shim QRP transport |
| `GLM-5.3` | `cc-shim` | cc-shim QRP transport |
| `kimi-code/k3` | `kimi` | kimi QRP transport |
| `claude-fable-5` | `claude-native` | claude-native QRP transport |
| `grok-4.6` | `grok` | grok QRP transport |
| `Qwen3.8-Max` | `qoderclicn` | qoderclicn QRP transport |
| `gemini-3.7-flash-high` | `agy` | agy QRP transport |
| `cursor-grok-4.6-high-fast` | `cursor` | **refused — see (c)** |

**Dates**: administration ran 2026-08-28 (rounds 1-2, instrument still broken) through 2026-08-29
(round 3, final instrument).

## (b) Results

9 seats administered. **5 recorded QUALIFIED, 2 recorded FAILED, 2 genuine results BLOCKED from the
scorecard by a validator gap (evidence intact, not lost — see below).**

| Seat | Engine / runner | Role | Score | Verdict | corpus_version | Scorecard |
|---|---|---|---|---|---|---|
| seat1 | `gpt-5.6-sol` / `codex` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v4` (see flag below) | event_id 158 |
| seat7 | `kimi-code/k3` / `kimi` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v6` | event_id 157 |
| seat-fable | `claude-fable-5` / `claude-native` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v6` | event_id 159 |
| seat-grok | `grok-4.6` / `grok` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v6` | event_id 160 |
| seat6 | `gemini-3.7-flash-high` / `agy` | discuss | 16/16, 0 violations | **QUALIFIED** (evidence only) | `discuss-v3` | **not recorded — see note** |
| seat3 | `MiniMax-M3` / `cc-shim` | consult | 19/20, 1 `oracle_miss` | **FAILED** (evidence only) | `consult-v6` | **not recorded — see note** |
| seat5 | `Qwen3.8-Max` / `qoderclicn` | consult | 19/20, 1 `protocol_violation` | **FAILED** | `consult-v6` | event_id 161 |
| seat4 | `GLM-5.3` / `cc-shim` | consult | 18/20, 1 `precedence_miss` + 1 `oracle_miss` | **FAILED** | `consult-v6` | event_id 162 |
| seat2 | `gpt-5.6-sol` / `codex` | discuss | 9/16, 7 `zero_information` | **FAILED** | `discuss-v3` | event_id 163 |

**Decorrelation finding**: `gpt-5.6-sol` is strong on `consult` (20/20 clean) but weak on `discuss`
(9/16, majority failure mode `zero_information` — restating the prompt without adding evidence).
`gemini-3.7-flash-high` shows the inverse shape: strong on `discuss` (16/16 clean) with no `consult`
administration to compare against. The two roles measure genuinely different failure surfaces on the
same engine family, not a shared "is this engine good" axis.

**Near-miss detail** (the 3 recorded fails, plus seat3's evidence-only fail):
- **MiniMax-M3** 19/20 — 1 `oracle_miss` (a single case where the independent owner-host oracle
  rejected its artifact). Genuinely near a pass; not a pattern.
- **Qwen3.8-Max** 19/20 — 1 `protocol_violation` (trial-0 dropped one case: 9/10 vs 10/10 on
  trial-1).
- **GLM-5.3** 18/20 — 1 `precedence_miss` + 1 `oracle_miss`, two distinct failure classes on two
  different cases.
- **gpt-5.6-sol discuss** 9/16 — not a near miss. 7 of 16 cases hit `zero_information`: a genuine
  weak-role result, not instrument noise (its own `consult` run on the same round's instrument
  cleared 20/20 clean).

### Instrument-version flag — seat1 (`gpt-5.6-sol` consult)

seat1's best/latest run (`execute3-out.json`) carries `corpus_version: consult-v4`, not the current
`consult-v6` — it predates the `consult-v5`/`consult-v6` aside-channel-coherence fixes. Per the
stability rule (a clean 20/20 with **zero** violations across every counter —
`false_confidence/precedence_misses/authority_violations/scope_drift/oracle_misses/protocol_violations`
all 0 — is stable across an aside-rule change; a near-miss would not be), this result is recorded as
authoritative. Flagged here rather than recorded silently, per the operator's instruction. Every
other recorded seat ran under the current final instrument (`consult-v6` / `discuss-v3`) directly.

### Scorecard-recording gap — seat6 (Gemini discuss) and seat3 (MiniMax consult)

Both administrations are **genuine, real, paid results** — the evidence receipts are honest and are
anchored in the canonical `~/.autopilot/engine-capability/qualification-evidence.jsonl`
(event_id 277 for seat6, event_id 278 for seat3), produced by the same `engine-qualify-v2` production
path as every other seat. They could **not** be turned into scorecard rows via
`engine-scorecard.js record`, because `run.sh` for both seats set `--effort` to a receipt-only
placeholder string (`baked-in-model-name` for agy, `default` for cc-shim/QRP — both transports that,
per each seat's own `run.sh` comment, do not expose an effort dimension to QRP at all) rather than the
scorecard schema's `none|low|medium|high|xhigh|max` enum. `engine-scorecard.js record`'s row-level
enum check rejects the literal string; substituting `none` in the *scorecard* row instead fails a
separate, stricter check (`record` requires `row.effort === evidence.identity.effort` exactly for any
`internal_eval` row) — because the sealed evidence itself (hash-bound, cannot be edited without
invalidating it) carries the original placeholder string. Neither engine's real exam result, engine
identity, or verdict is in question; this is a schema/tooling gap between `engine-qualify.js` (accepts
free-text `--effort`) and `engine-scorecard.js record` (enforces a closed enum), surfaced for the
first time by these two transports. Recommend either (a) extending the `record` effort enum to accept
a documented "no-effort-dimension" placeholder distinct from `none`, or (b) re-running these two
seats' `run.sh` with `--effort none` (the documented convention for exactly this transport class,
per `engine-scorecard.js`'s own code comment) to produce evidence that anchors cleanly — both require
an owner decision, not something this recording pass should force through.

## (c) Did not participate

- **`cursor-grok-4.6-high-fast` / `cursor`** — **not-containable**. `docs/plans/evidence/2026-08-29-cursor-containment-probe/`
  holds 19 probe receipts (18 `probe*.out` files + README) showing `cursor-agent` cannot be
  contained as a QRP exam-transport child: no enumerated deny covers all tool surfaces (TodoWrite
  and WebSearch ran uncontained under full deny + `--force`), the wildcard deny silently no-ops, and
  `--sandbox` is host-dependent (AppArmor-gated, unavailable here) while `--force`/`--trust` is
  mandatory for headless operation and defeats every other surface. The cursor QRP adapter's
  unconditional refusal (seat8's `run.sh` never reached `execute` — only the free `plan` dry-run
  exists, no `execute-out.json`) is correct and is not lifted by this ledger. **No scorecard row —
  this engine never sat either exam.**
- **discuss role for consult-only engines** — `kimi-code/k3`, `claude-fable-5`, `grok-4.6`,
  `MiniMax-M3`, `GLM-5.3`, `Qwen3.8-Max` — **not administered** for `discuss`. Stated plainly: these
  are untested for `discuss`, not failing at it.
- **consult role for `gemini-3.7-flash-high` / `agy`** — **not administered** for `consult`. Untested,
  not failing.

No row exists in the scorecard for any of the above combinations, and none should be inferred from
this ledger — a missing row means "not tested," never "tested and failed."
