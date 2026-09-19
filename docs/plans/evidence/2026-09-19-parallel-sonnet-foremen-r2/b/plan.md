# Plan B — table migration stops inventing and dropping
1. RED case (p): unmapped status → open; unmapped column cells vanish; preserved:true; bytes do not reconcile.
2. Unmapped status → sidecar verbatim + manifest error; --apply refuses unless --allow-unmapped-to-sidecar. Unmapped column → plan-time error naming the ## Columns line.
3. preserved computed from byte accounting (output + sidecars + dropped==∅); bytes_before === bytes_after + moved_bytes.
4. --apply gates on runCheck (exported) and restores the file on a red gate; doc sentence; mirrors; ONE commit.
Acceptance: revival.3d's shape (unmapped statuses + a foreign column) yields errors and sidecars, never `open` rows or silent loss; a fully mapped table migrates byte-identically to base.
