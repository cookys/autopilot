# muse-spark-1.3 contributor (OpenCode Go, `--runner opencode`) at `--variant low` / `medium` — both QUALIFIED 24/24 (2026-09-04)

Two administrations in one `qualification-sweep.sh` run over the v2.35.14 rail (EFFORT forwarded as
`--variant`; probe evidence for the tier reaching the provider is in CHANGELOG v2.35.14). Same
generator / corpus / grader pins as every 2026-08-22+ bundle.

| Seat (effort) | Result | Event | Seat wall | Per-case wall min/median/p90/max |
|---|---|---|---|---|
| `opencode-go/muse-spark-1.3-contributor` low | **24/24** | 191 | 620 s | 17 / 22 / 32 / 59 s |
| `opencode-go/muse-spark-1.3-contributor` medium | **24/24** | 192 | 587 s | 16 / 23 / 30 / 38 s |
| (2026-09-03, labelled high, rail sent NO variant → provider default ≈medium) | 24/24 | 187 | 600 s | 18 / 22 / 32 / 34 s |

- **Reading**: no measurable speed difference between low, medium and the provider default on this
  corpus (medians 22–23 s; the low seat's 59 s max is a single outlier). Unlike gemini 3.8 flash
  (low 15 s → high 26 s), the tier does not buy speed here; the rows exist so routing can choose the
  cheapest honest label. Usage is `null` on this rail (BACKLOG: parse `step_finish.tokens`), so a
  token comparison across tiers is not on the record — the probe (3 samples, no-tool prompt) is the
  only token evidence: low ≈103 vs medium ≈171 reasoning tokens.
- **`minimal`** was requested by the Board but is outside autopilot's effort vocabulary
  (`low|medium|high|xhigh|max`); BACKLOG row "autopilot effort vocabulary has no `minimal`" (L).
- **Identity**: runner `opencode` 1.18.27 (the CLI auto-updated from 1.18.25 between the 09-03 and
  09-04 runs — recorded as environment, never exam identity), family `meta`, harness
  `dispatch-hetero:013ca863`, model_version token `opencode-go:muse-spark-1.3-contributor`.
- **Files**: `roster.json`, `sweep-stdout.log`, `qualification-sweep-progress.txt`,
  `muse13-{low,medium}-qualify/{probe-receipts.jsonl,qualify-out.json,qualify-err.log,record-out.json,record-err.log,raw/}`.
