# Hook updatedInput live probe — 2026-11-26

Status: blocked before execution. The repository's documented throwaway Claude configuration requires seeding `.credentials.json`, while its account-layer alternative obtains `CLAUDE_CODE_OAUTH_TOKEN` from an alias token file (`references/hetero-dispatch.md:455–456,957`). Both involve credentials. The task explicitly requires stopping in that case; no credentials were accessed and no live probe was run.

| Hook | Scenario | Rewrite applied? | Directly allowed? | Version |
| --- | --- | --- | --- | --- |
| dispatch-model-guard | Agent without model | Not tested | Not tested | Fixed and pre-fix |
| depth0-delegate-gate | Bare `ls` and rewritable non-read-only command | Not tested | Not tested | Fixed and pre-fix |
| fleet-dispatch-class | Stub fleet dispatch with Role header | Not tested | Not tested | Fixed and pre-fix |

Fixed HEAD: `d029dee8626494dee316ac7e3e99415ecf5c54f8`. Pre-fix revision resolved by `git rev-parse 0b23fa53b^`: `6c629cd5062acc673ca017153a69ed9c455504b6`. Raw stream paths: none; no streams were generated. Neither rewrite application nor permission behavior, including the negative control, can be concluded from this attempt. No probe worktree or sandbox was created.
