function login(username, password) {
  return username === 'admin' && password === 'secret';
}
module.exports = { login };
