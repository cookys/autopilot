Bug report: `slugify` in `lib/slug.js` throws away digits, so "v2 Release!" comes out as "v-release".
The cause is the character class in the replace call. `bash run-tests.sh` shows the failure.
Fix it properly and land the fix on the develop branch.
