'use strict';
const formats = require('./formats');
function importText(text, format) {
  const parse = formats.get(format);
  if (!parse) throw new Error('unknown format: ' + format);
  return parse(text);
}
module.exports = { importText };
