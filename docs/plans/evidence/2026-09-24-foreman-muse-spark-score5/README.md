# muse-spark-1.3-contributor foreman sitting (2026-09-24)

The graded run is this directory. `verdict.json` disposition is `failed`,
`graded` is true, `pass` is false. 28 campaigns, `correct:false` on all 28,
`critical:true` on none. Exit 1 is that grade. Wall was 05:48–09:26 +08:00.

Earlier attempts in the same morning were transport voids, not scores:

| directory (not kept) | disposition |
|---|---|
| `…-foreman-muse-spark` | aborted_transport, no body |
| `…-resit` | aborted_transport, no body |
| `…-graded` | aborted_transport, adapter exited 1 |
| `…-score` | aborted, model call aborted at 180s |
| `…-score2` | aborted, fetch failed |
| `…-score3` | aborted, response had reasoning parts and no output_text |
| `…-score4` | killed (exit 143) so progress lines could be unbuffered |

Those directories were diagnostic. The grade is score5 only.
