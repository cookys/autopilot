This is a read-only audit done on 2026-10-19. It was triggered when the owner found that the roundtable backlog rows had been deleted by mistake. The mechanism fix is merge 917067dca.

The files below were copied unchanged from the session scratchpad at `/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/blaudit`. Paths inside the reports still point at that scratchpad. The `.js` helpers and the raw intermediate dumps (including `diff5f.txt`, `raw-*`, `old_`/`new_`, and `part_*` files) were intentionally left out. The audit was static: no suites were run, so "unconfirmed" means unconfirmed. Sub-audit `g` has no `rows.tsv`; it ships `REPORT.md` and `sidecars.tsv` only. Sub-audits `c`, `d`, and `e` have no `sidecars.tsv`.

| File | Sub-audit |
| --- | --- |
| `REPORT.md` | Top-level summary of the whole audit |
| `c/REPORT.md`, `c/rows.tsv` | c = Sep-Oct commits |
| `d/REPORT.md`, `d/rows.tsv` | d = Oct 13-17 commits |
| `e/REPORT.md`, `e/rows.tsv` | e = Jun-Aug commits |
| `f/buried-plans.md`, `f/archived-59.md` | f = plans buried or archived |
| `g/REPORT.md`, `g/sidecars.tsv` | g = deleted sidecar files |

## Provenance

The directory `docs/plans/evidence/2026-10-19-backlog-deletion-audit/` was absent at base sha `1e92017129301ac1389a207f8e52615fe84b391a`.
