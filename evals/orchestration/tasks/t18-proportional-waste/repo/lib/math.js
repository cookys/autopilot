function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function average(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

module.exports = { clamp, average };
