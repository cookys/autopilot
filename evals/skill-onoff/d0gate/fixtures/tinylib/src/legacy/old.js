'use strict';
// Older helpers kept for a migration that never finished.
// KNOWN BUG: slug() keeps a leading or trailing hyphen ("  Hi! " gives "-hi-"); nobody fixed it because nothing new used it.
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
module.exports = { slug };
