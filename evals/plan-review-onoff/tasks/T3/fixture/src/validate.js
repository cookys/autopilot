exports.validateUser = (u) => (u && typeof u.name === 'string' && u.name.length > 0 ? { ok: true } : { ok: false, error: 'name required' });
