# ICC Phase 0 Gate

> Verdict: READY
>
> Baseline: `8bc961c`
>
> Phase commits: `0e2e4e2..b6fc192`
>
> Final aggregate diff SHA-256:
> `00d8d540853f214efdc3b5a6bee232542606f33d63637b384dd69bed215bba10`

## Deterministic Evidence

- `bash hooks/tests/implementation-campaign.test.sh`: PASS, 73 assertions.
- `node --check` passed for the checker and executable RED probe.
- `scripts/validate.sh`: 28/28 skills passed.
- `scripts/check-canonical-invariants.sh`: passed.
- `node scripts/sync-version.js --check`: passed.
- `scripts/sync-agent-bodies.sh --check`: passed.
- `git diff --check`: passed.

The RED replay archives pinned `develop` commit
`db65c54255d502bdbbe903fe90412335e935c147`, verifies tree
`7593c2b3f18fb89f3057c6cb7ae339824be0a6cf`, loads that runtime, and executes
all five exploit shapes. The final oracles exercise a third POC repair, a real
cross-instance `resume`, an out-of-scope repair diff without scope/adjudication
gates, and a candidate tree mutation during green verification.

## Review Trail

| Pass | Seat | Result | Depth-0 disposition |
|---|---|---|---|
| Initial | GLM / MiniMax | FIX | Admitted schema drift, unbounded ceilings, and non-executable RED cases; fixed. |
| Repair | GLM / MiniMax | FIX | Admitted verify-command, object-format, Mission-null, and RED-runtime gaps; fixed. |
| Full | GLM | SHIP-AS-IS | Counted. |
| Full | Sol | FIX | Admitted weak repair/resume/verification oracles; fixed. |
| Full | GLM | SHIP-AS-IS | Counted. |
| Full | Sol | FIX | Admitted seal clobber, fabricated grant acceptance, scope oracle, and nested `.git`; fixed. |
| Full | GLM | SHIP-AS-IS | Counted. |
| Full | Sol | FIX | Admitted caller-selected Mission downgrade and Win32 metadata aliases; fixed. |
| Fix verification | GLM | FIX | Rejected: claimed the pinned baseline engine was unavailable; the 73-assertion runtime archive replay proves otherwise. |
| Fix verification | Sol | FIX | Admitted Win32 reserved device aliases; fixed. |
| Terminal verification | GLM (`review-1785083499-556323-af26`) | SHIP-AS-IS | Counted. |
| Terminal verification | Sol (`review-1785083505-556549-5a26`) | SHIP-AS-IS | Counted. |

MiniMax, Grok, and Qwen responses that failed the strict output envelope were
advisory only and did not count as verdicts. Reproduced in-scope findings from
their raw output were still repaired. The terminal gate is the two-family
GLM/Sol `SHIP-AS-IS` pair over the final Windows-device fix, backed by the
passing aggregate phase suite.

## Frozen Decisions

- Seal publication is atomic and no-clobber; resealing requires a new path.
- Mission mode is derived from repository governance. The CLI value is only an
  equality assertion and cannot downgrade project policy.
- Mission `enforce` remains fail-closed until the Mission integration phase can
  validate a real claimed grant; P0 does not invent an unowned grant format.
- Allowed path prefixes reject POSIX escape, Windows drive/ADS/trailing-dot
  aliases, Git metadata at any depth, and Windows reserved device basenames.

