function formatCurrency(amount) {
  // Correct version in BASE_STATE
  return "$" + amount.toFixed(2);
}

module.exports = { formatCurrency };
