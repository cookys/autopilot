# seal-baseline.json notes

- Recorded at 2902ac939 (lane base of hands/sealbase/1). The values in seal-baseline.json are the baseline, not the ca97d97b3 values in seal-closure.md.
- rail-pin (`evals/skill-onoff/prereg/d0gate.json#runner_pin`): computed rail digest is `059cd6fd...`; seal-closure.md recorded `29dfe2ef...` at ca97d97b3. Cause: commit 76c534997 (BL-0364) changed `scripts/dispatch-hetero.sh`, an O9 rail file. Verified by recomputing the digest from the five rail files at ca97d97b3 (`29dfe2ef`) and at HEAD (`059cd6fd`). The preregistered value is still `57d04ce6...`, so the object stays red. Coordinator accepted this attribution.
