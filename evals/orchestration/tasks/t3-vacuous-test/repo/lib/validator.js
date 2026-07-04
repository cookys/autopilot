function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  // BUG: accepts domains without any dot (e.g. "user@domain")
  return true;
}

function validateAge(age) {
  const num = Number(age);
  return !isNaN(num) && num >= 0 && num <= 120;
}

module.exports = { validateEmail, validateAge };
