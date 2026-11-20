# GLM-5.3-Flash-NVFP4 requalification (2026-11-20)

Deployment (gpu-lead 01M7VX5R, 2026-11-20): endpoint `glm_local` = `http://<private-ip>:8000`; served id `GLM-5.3-Flash-NVFP4` (186 GB), vLLM local-inference-lab image, TP4, MTP draft 3, KV nvfp4_ds_mla, max_num_seqs 32, max_model_len 1048576, proxy concurrency cap 18, gmu 0.96, block 256, prefix caching on. `/v1/models` captured 2026-11-20T07:19:20Z: `v1-models.json`.
Scripts are copies of `2026-11-08-local-models-qualify` (cell-local-rf-formal.sh, cell-local-think.sh, cell-local.sh); only change: implementer harness version recomputed per 2026-11-09 B8. Reviewer provider at develop 046f7fcde, VA provider at b3a62e643 (as 11-08).

| cell (out/) | role | result | wall s | scorecard event |
|---|---|---|---|---|
| glm-reviewer-think-rf-formal | reviewer | qualified 42/42, fpc 0, spec 0/38 | 467.5 | 40 (evidence 48) |
| glm-verification_author-think | verification_author | qualified 24/24, fpc 0, spec 0/24 | 91.8 | 41 (evidence 49) |
| glm-implementer | implementer | infra_abort, no verdict: blocked by cn-model gate, NOT a model result; not recorded | 2 | none |

Gate reason: `cn_model_dispatch_barred zhipu core-unset (01M7E2A1, d-1dfcf757)`. Gate fix is tracked in 01M7VSVS; retake after it lands.
Mechanical implementer and judge (判讀): no recipe found in the 11-08/11-09 bundles or the scorecard roles (roles: owner, implementer, reviewer, verification_author, explorer), so not sat.
