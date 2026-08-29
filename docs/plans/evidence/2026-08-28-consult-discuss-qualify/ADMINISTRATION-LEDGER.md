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

All 9 administered seats are now recorded. **5 QUALIFIED, 4 FAILED.**

| Seat | Engine / runner | Role | Score | Verdict | corpus_version | Scorecard event_id |
|---|---|---|---|---|---|---|
| seat1 | `gpt-5.6-sol` / `codex` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v4` (see flag below) | 158 |
| seat7 | `kimi-code/k3` / `kimi` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v6` | 157 |
| seat-fable | `claude-fable-5` / `claude-native` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v6` | 159 |
| seat-grok | `grok-4.6` / `grok` | consult | 20/20, 0 violations | **QUALIFIED** | `consult-v6` | 160 |
| seat3 | `MiniMax-M3` / `cc-shim` | consult | 20/20, 0 violations (re-run — see note) | **QUALIFIED** | `consult-v6` | 165 |
| seat6 | `gemini-3.7-flash-high` / `agy` | discuss | 15/16, 1 `zero_information` (re-run — see note) | **FAILED** | `discuss-v3` | 164 |
| seat5 | `Qwen3.8-Max` / `qoderclicn` | consult | 19/20, 1 `protocol_violation` | **FAILED** | `consult-v6` | 161 |
| seat4 | `GLM-5.3` / `cc-shim` | consult | 18/20, 1 `precedence_miss` + 1 `oracle_miss` | **FAILED** | `consult-v6` | 162 |
| seat2 | `gpt-5.6-sol` / `codex` | discuss | 9/16, 7 `zero_information` | **FAILED** | `discuss-v3` | 163 |

**Decorrelation finding**: `gpt-5.6-sol` is strong on `consult` (20/20 clean) but weak on `discuss`
(9/16, majority failure mode `zero_information` — restating the prompt without adding evidence).
The two roles measure genuinely different failure surfaces on the same engine family, not a shared
"is this engine good" axis. `gemini-3.7-flash-high`'s single `discuss` administration failed
(15/16) rather than confirming the earlier decorrelation story — see the re-run note below.

**Near-miss detail**:
- **Qwen3.8-Max** 19/20 — 1 `protocol_violation` (trial-0 dropped one case: 9/10 vs 10/10 on
  trial-1).
- **GLM-5.3** 18/20 — 1 `precedence_miss` + 1 `oracle_miss`, two distinct failure classes on two
  different cases.
- **gpt-5.6-sol discuss** 9/16 — not a near miss. 7 of 16 cases hit `zero_information`: a genuine
  weak-role result, not instrument noise (its own `consult` run on the same round's instrument
  cleared 20/20 clean).
- **gemini-3.7-flash-high discuss** 15/16 — 1 `zero_information` on trial-2 (7/8 vs 8/8 on
  trial-1). A near-miss, not a clean fail, but a fail.

### Instrument-version flag — seat1 (`gpt-5.6-sol` consult)

seat1's best/latest run (`execute3-out.json`) carries `corpus_version: consult-v4`, not the current
`consult-v6` — it predates the `consult-v5`/`consult-v6` aside-channel-coherence fixes. Per the
stability rule (a clean 20/20 with **zero** violations across every counter —
`false_confidence/precedence_misses/authority_violations/scope_drift/oracle_misses/protocol_violations`
all 0 — is stable across an aside-rule change; a near-miss would not be), this result is recorded as
authoritative. Flagged here rather than recorded silently, per the operator's instruction. Every
other recorded seat ran under the current final instrument (`consult-v6` / `discuss-v3`) directly.

### Effort-enum bug and re-run — seat6 (Gemini discuss) and seat3 (MiniMax consult)

The first administration of both seats produced genuine, real, paid results that could not be
turned into scorecard rows via `engine-scorecard.js record`: `run.sh` for both seats set `--effort`
to a receipt-only placeholder string (`baked-in-model-name` for agy, `default` for cc-shim/QRP —
both transports that, per each seat's own `run.sh` comment, do not expose an effort dimension to
QRP at all) instead of a value in the scorecard schema's closed enum
(`none|low|medium|high|xhigh|max`). Substituting a compliant value into the scorecard row alone
(without an evidence re-seal) fails a separate check — `record` requires
`row.effort === evidence.identity.effort` exactly for any `internal_eval` row, and the sealed
evidence's `identity.effort` still carries the original placeholder. Filed as a backlog entry
(`docs/BACKLOG.md`, "qualification run.sh templates baked an invalid effort enum").

**Fix applied**: both `run.sh` scripts were corrected to `EFFORT="high"` — a receipt-only
classification identical in kind to kimi's/grok's convention for the same transport class; neither
transport takes `--effort` as a real CLI flag (confirmed: no `QRP_CLI_EFFORT` export in either
script), so this changes only the recorded label, never the exam transport. Both seats were then
**re-administered for real** (Board-authorized, 2026-08-29) rather than having their original,
mislabeled evidence force-recorded.

**The re-run results are materially different from the first (mislabeled) administration — reported
here rather than assumed to reproduce:**

- **seat6 Gemini discuss**: first administration scored 16/16 clean (would have been QUALIFIED).
  The re-run scored **15/16, FAILED** — 1 `zero_information` miss on trial-2. Recorded honestly as
  **FAILED** (authoritative file `execute4-out.json`; scorecard event_id 164, capability evidence event_id 282). `seat-status` confirms
  `admission_status: no_record`.
- **seat3 MiniMax consult**: first administration scored 19/20 (would have been the FAILED
  near-miss). The re-run scored **20/20, QUALIFIED**, zero violations across every counter.
  Recorded honestly as **QUALIFIED** (authoritative file `execute5-out.json`; scorecard event_id 165, capability evidence event_id 283).
  `seat-status` confirms `admission_status: qualified`, `baseline_event_id: 165`.

Both flips land within the two-role batch's existing "borderline near-miss / near-clean" band (19/20
and 16/16 are both one failing case away from the other outcome), consistent with normal
administration-to-administration LLM variance rather than a sign either transport or exam is broken.
The overall QUALIFIED/FAILED split for the 9-seat batch is unchanged at 5/4 — only which two seats
occupy which side of it changed. The mislabeled-effort evidence from the first administration of
both seats remains genuinely anchored (unreferenced by any scorecard row) at capability evidence
event_id 277 (seat6, first run) and 278 (seat3, first run) — real evidence, simply superseded by the
corrected re-run as the seat's authoritative record.

## (c) Did not participate

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
