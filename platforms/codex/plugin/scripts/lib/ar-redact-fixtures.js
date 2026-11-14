'use strict';
/*
 * ar-redact-fixtures.js — test-only: fake sensitive values BUILT AT RUN TIME from fragments, so no
 * secret-shaped literal sits in any committed file. Used by ar-redact-rules.test.js and
 * hooks/tests/ar-redact.test.sh.
 */
const rep = (c, n) => c.repeat(n);
const A36 = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC2dE4fG6';
function planted() {
  return {
    anthropic: ['sk-', 'ant-', 'api03-', 'Zq8Lm2Xv9Rt4Yw6Bn1Cd'].join(''),
    github: ['gh', 'p_', A36].join(''),
    aws: ['AK', 'IA', 'Q7WERTY2ZXCV4BNM'].join(''),
    jwt: ['ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'].join(''),
    pem: ['-----BEGIN ', 'PRIVATE KEY', '-----\n', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '\nKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj', '\n-----END ', 'PRIVATE KEY', '-----'].join(''),
    ip: [203, 0, 113, 7].join('.'),
    password: ['pass', 'word', '=', 'hunter2', 'xyzzy9'].join(''),
    sshAcct: ['al', 'ice', 'dev'].join(''),
    sshHost: ['build-', 'box.', 'corp.', 'example'].join(''),
    phone: ['+886 ', '912 ', '345 ', '678'].join(''),
  };
}
/** Text lines that carry each planted value once, in the order of planted(). */
function plantedLines(p) {
  return [
    `key one ${p.anthropic} end`,
    `export tok ${p.github} end`,
    `aws id ${p.aws} end`,
    `auth ${p.jwt} end`,
    `${p.pem}`,
    `server at ${p.ip} responds`,
    `run with ${p.password} now`,
    `then ssh ${p.sshAcct}@${p.sshHost} to check`,
    `call ${p.phone} please`,
  ];
}
/** Values whose leakage matters: the whole value and every 12-char window of it. */
function needles(p) {
  const vals = [p.anthropic, p.github, p.aws, p.jwt, p.ip, 'hunter2xyzzy9', p.sshAcct, p.sshHost, p.phone,
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'KcwggSjAgEAAoIBAQC7VJTUt9Us8cKj'];
  const out = [];
  for (const v of vals) {
    out.push(v);
    for (let i = 0; i + 12 <= v.length; i++) out.push(v.slice(i, i + 12));
  }
  return out;
}
module.exports = { planted, plantedLines, needles, rep };
