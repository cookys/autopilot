# Count a dispatch branch as integrated when its patch-id or diff matches

BL-0215. Residue sweep treats a branch as unintegrated unless the commit is an ancestor of the target. Adopted dispatch candidates often differ from the landed commit (diff was read, lockfiles dropped), so they stay unintegrated until the 14-day archive. cuda cleared twenty such branches in one day. The branch list piles up, and before archive you cannot tell a real miss from an already-adopted candidate.

Code: scripts/repo-residue-sweep.js (integrated is judged by ancestry only)

Proposal: treat a dispatch branch as integrated when its patch-id or its diff against the target is already present there.

Reported by cuda revival.3d, fleet msg 01M59TJ90DWG5XVE6JS78CZ6Z7, replied 01M59TMBZ32K3YSC7Q707QWV1Q.
