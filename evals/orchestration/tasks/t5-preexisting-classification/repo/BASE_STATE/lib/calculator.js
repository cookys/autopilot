function add(a, b) {
  return a + b;
}

function divide(a, b) {
  // BUG: pre-existing bug returns multiplication instead of division
  return a * b;
}

module.exports = { add, divide };
