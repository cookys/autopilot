'use strict';

function isSafeSeatId(id) {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(id) && !id.includes('..');
}

module.exports = { isSafeSeatId };
