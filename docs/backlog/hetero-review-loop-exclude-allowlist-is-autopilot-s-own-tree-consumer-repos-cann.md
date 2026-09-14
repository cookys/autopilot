# `hetero-review-loop --exclude` allowlist is autopilot's own tree — consumer repos cannot shrink a review payload

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next consumer-repo report of `Exclude pathspec '…' is not permitted by allowlist` for a data/generated directory, or the next agy-seat payload overflow where `--exclude` was the only lever.
- **Context**: `EXCLUDE_ALLOWLIST` (hetero-review-loop.js:29-47) hardcodes `platforms/**`, `docs/projects/**`, lockfiles… llm-playground plan 066 needed to exclude `benchmarks/matrix` (139 regenerated shard JSONs, most of the diff) to get the agy prompt under `MAX_ARG_STRLEN` and could not — generation 7 never started. Fix shape: a consumer-declared allowlist via project DI (`.claude/review-loop-config.md` `exclude_allowlist:` rows), constrained to non-code paths (no source extensions, must be a directory or data glob) and recorded in `range.json.excluded` + `full_range_sha256` as today so the exclusion stays visible to the checker. Never a free-form pathspec.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066, 2026-09-06

