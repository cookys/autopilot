# fbatch v3 pilot confirmed the develop journal only indirectly

BL-0317. Found by self, 2026-10-27. Low priority.

The v3 pilot's instrument_checks could confirm the develop journal only through indirect evidence, because the cell repo is cleaned after scoring. Direct evidence needs the runner to keep the journal file before cleanup.

See hooks/tests/skill-onoff-findings-batch-v3.test.sh for the instrument.
