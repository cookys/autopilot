# cost-fuse dispatch exemption prefix and session-id collisions

`hooks/cost-fuse.js`: the dispatch-rail exemption prefix check admits an env assignment whose value is the
rail path, and any path prefix of the rail. It only applies in warn mode and is advisory, so this is not a
bypass of a block. Separately, `safe()` (session id sanitiser) may map distinct session ids to the same
string, merging their spend; and with no resolvable session id the warning prints `this session $0.00`
instead of "unknown" (v2.36.113 review 🔵).

Next touch: anchor the exemption to the exact command word, and make `safe()` injective or hash-suffixed.
