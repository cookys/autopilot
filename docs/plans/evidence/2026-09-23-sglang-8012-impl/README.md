# mimo-nvfp4 on 127.0.0.1:8012, implementer via OpenCode (2026-09-23)

sglang at `http://127.0.0.1:8012/v1`, model `mimo-nvfp4`, runner OpenCode
provider `sglang`. Qualify output: `sglang-8012-qualify/qualify-out.json`.

| result | value |
|---|---|
| status | failed |
| corpus | 13/24 |
| contract violations | 10 |
| oracle misses | 1 |
| false-pass critical | 0 |
| wall | 557s |
| evidence event | 71 |

Trial case counts in that file are 4 and 9. The misses are no-op contract
violations: the client stored tool-call XML in text and committed nothing.
The later `warning:unparsed_tool_call` note was not on this row.
