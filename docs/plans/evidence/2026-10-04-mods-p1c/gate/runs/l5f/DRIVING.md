# l5f driving notes (2026-10-05, gate-sandbox2)
- Launch 13:46Z, trust dialog Down+Enter. No marker named gate-sandbox2 before launch. Goal sent 13:47:04Z.
- Driven /l5 ran step 6 unaided (session-mode set --level l5 no env -u: READY; resolve-review-loop override_admitted_seats = qc_panel[0..3], unverified operator pins), then mission prepare with the sandbox2 repo.
- mission prepare REJECTED, rc=1: `mission: [MISSION_AUTHORITY_BINDING_MISMATCH] TaskAuthority Mission lineage/policy/graph binding does not match prepare inputs`. Depth-0's inference (not verified): the envelope task-authority.json binds repo identity git-common-dir:/home/cookys/projects/gate-sandbox/.git, while sandbox2 is .../gate-sandbox2/.git (the session marker's repo_identity is the sandbox2 one). Per brief: BLOCKED, stopped; no grant, no brief, no engine call.
- Ghost prompt "用 env.js 重建 gate-sandbox2 的 authority" never accepted. Approvals matched on dialog-box text (Reads of REPORT.md and hetero-impl-loop.md; session-mode set + resolve-review-loop + git status; mission prepare). No unexpected dialog.
- Sandbox2 untouched (git status clean, origin develop e1316d0). Only new marker: the session's own.
