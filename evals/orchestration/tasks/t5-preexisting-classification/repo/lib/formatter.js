function formatCurrency(amount) {
  // Bug: recent change introduced a typo (tofixed instead of toFixed)
  return "$" + amount.tofixed(2);
}

module.exports = { formatCurrency };
