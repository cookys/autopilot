# Relayout C2 export: exclude .hippo/ and register it in top_dirs (BL-0403)

- The C2 public-export tool must explicitly exclude `.hippo/` (the dev repo's local hippo data), with a negative control: a tree containing `.hippo/` must export without it, and the control must go red when the exclusion is removed.
- The repo-layout `top_dirs` list registers `.hippo` (dev repo only, not part of the public layout).

Context: relayout plan amendment E1 sets the top-level allowlist and the export whitelist (see project/plans/2026-11-05-rolekit-direction.md).
