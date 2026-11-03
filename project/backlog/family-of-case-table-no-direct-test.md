# bash family_of case table has no direct test

BL-0292. `family_of` in `scripts/resolve-review-loop.sh` (~line 751) maps engine names to vendor families. The family-of-engine suite (`hooks/tests/family-of-engine.test.sh`, on lane/oqseat) only exercises the embedded JS `familyOf`; the bash table is only touched indirectly (e.g. a grok case in `resolve-review-loop-a.test.sh`). Add a per-family table test. Trigger-Type ready. Effort S.
