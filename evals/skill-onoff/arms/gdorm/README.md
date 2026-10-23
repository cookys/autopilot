# gdorm arms

`base.json` freezes ceo-agent, quality-pipeline, hetero-review, distill, and retro at develop `778f39dee`, plus the references those skills load (`gdorm-files-base778`) and `fixture-scripts-gdorm`.

`change.json` freezes the same set at `gtext-final` (`06e94ffd3`). The two arms differ only in the gtext file list recorded in `prereg/gdorm.json` `allowed_arm_difference.files`. Both arms keep `fixture-scripts-gdorm`.
