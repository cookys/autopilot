'use strict';
function banner(opts) {
  const line = '== jobtool v1 ==';
  return opts.color ? '\u001b[1m' + line + '\u001b[0m' : line;
}
module.exports = { banner };
