# status runs --json drops the reason when the runs directory is rejected (BL-0347)

When the runs directory is rejected, the reason is set as a `runs_dir_error` property on the array. JSON.stringify drops array properties, so the JSON output has no reason; stderr and text output show it (src/status/cli.js about L167-193). From the BL-0336 U1 second-generation review.

Fix direction: JSON mode emits an object, or the reason goes in a serializable place.
