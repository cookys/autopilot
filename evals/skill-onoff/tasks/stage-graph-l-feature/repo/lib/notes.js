'use strict';
const notes = [];
function add(text) {
  const n = { id: notes.length + 1, text };
  notes.push(n);
  return n;
}
function list() {
  return notes.slice();
}
function remove(id) {
  const i = notes.findIndex((n) => n.id === id);
  if (i < 0) return false;
  notes.splice(i, 1);
  return true;
}
module.exports = { add, list, remove };
