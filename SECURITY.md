# Security

Draft. Report a vulnerability privately to the maintainers rather than in a public issue.

## What the repository scan can and cannot see

Before publication the full history was scanned for credentials: no confirmed real credential was found within what the scan covers. The scan does not cover:

- custom tokens shorter than 32 characters;
- blobs of 3 MB or more;
- binary blobs.

Those three classes are unverified, not clean. A pre-publication review of the large and binary blobs, and a manual review of short values in `key=value` and `"token":` contexts, is still owed.

From now on `scripts/leak-guard.js` blocks personal paths, host names, private IPs, credential shapes and `.env` files in added lines (see `references/leak-guard.md`). It shares the same blind spots above.

## Frozen objects

- Historical evidence is not edited. It stays as published. Because the guard reads only added lines, it needs no exemption unless someone later edits it, and then only an exact per-file registry entry applies.
- Sealed non-evidence files that carry personal data (seven files in the inventory, class B) are not edited in place. After the sealed-closure work lands, a cleaned successor object is produced and sealed in their place; the old versions remain only in history.
