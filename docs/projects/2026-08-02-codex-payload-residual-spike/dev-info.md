# Developer info — Codex payload residual install-time spike

- Target branch: `develop`
- Feature branch: `chore/codex-payload-residual-spike`
- Size: L, one Mission deliverable
- Foreman: reuse `/root/backlog_convergence_foreman`; no replacement implementer transcript
- Verification authority: independent first-pass reviewer plus resolver-selected depth-0 QC
- Candidate outputs: exact six paths listed in the frozen plan
- Production boundary: no scripts, tests, manifests, generated payload, mirrors, version, or release
- External boundary: no push, PR, publication, or externally hosted fixture
- Cleanup boundary: remove the uniquely named disposable plugin, marketplace, repo, and processes

## Required repository gates

```bash
node -e 'const e=require("./docs/projects/2026-08-02-codex-payload-residual-spike/evidence.json"); if(e.schema_version!==1||!e.final_decision||e.cleanup?.zero_residue!==true) process.exit(1)'
git diff --check
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/sync-all.sh --check
```
