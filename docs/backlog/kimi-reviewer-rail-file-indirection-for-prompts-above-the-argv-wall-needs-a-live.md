# kimi reviewer rail: file-indirection for prompts above the argv wall (needs a live kimi credential to probe)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a host with a working `kimi login` (this host's managed:kimi-code OAuth has no credential as of 2026-09-07, so the probe could not run), or Kimi Code CLI shipping `--prompt-file` / stdin prompt input (0.39.1 has neither: `-p ''` is rejected, `-p -` is taken literally).
- **Context**: v2.36.14 fails closed pre-spend when the kimi prompt exceeds ~120 KB (Linux MAX_ARG_STRLEN, 308 hit rc=126 on a 145 KB prompt). The unblocking alternative is file indirection: write the prompt into the scratch cwd and pass a short `-p "read ./autopilot-review-prompt.md and follow it"`; kimi is an agent with a read tool, so it should work, but it is UNVERIFIED and changes the trust shape (the model must choose to read the file; a summarising model silently reviews less). Spike: live probe with a nonce inside the file, then a 140 KB real diff; ship only behind the size threshold with the raw log recording the indirection.
- **Effort**: S (probe) + Fix
- **Source**: 308 report 2026-09-07, run review-1788751167-2077044-2d7b.

