'use strict';
// slugify("v2 Release!") should give "v2-release".
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z]+/g, '-') // BUG: drops digits — should be /[^a-z0-9]+/
    .replace(/^-+|-+$/g, '');
}
module.exports = { slugify };
