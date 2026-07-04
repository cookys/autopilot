function checkRole(user, role) {
  return !!(user && user.roles && user.roles.includes(role));
}
module.exports = { checkRole };
