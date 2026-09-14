# `dispatch-author.sh` success predicate is "non-empty stdout" — truncated / tool-narrating output reports `authored`

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: already fired twice (2026-08-29, qoderclicn/Qwen3.8-Max-Preview: a 100-byte preamble ending at `[` and a 130 KB mid-file draft with 36 text-form ```` ```tool ```` fences both returned `status:authored`, exit 0, `final_status:null`).
- **Context**: header line 102 / `emit_result "authored"` at :1222 treat any bytes as an artifact. Needs a positive completion check (declared terminal marker, `bash -n`/parse for the declared kind, zero tool-fence narration) and a `truncated` status; manifests also record `parent_run_id/root_run_id: null, depth: 0` despite exported lineage.
- **Effort**: S
- **Source**: l6-verdict-stability-p1 attempt 1 (author-1788027293-2263145, author-1788027402-2269364).

