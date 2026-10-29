'use strict';
// Older helpers kept for a migration that never finished. slug() already does most of what a new slugify needs.
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
module.exports = { slug };
// touched by the hand
