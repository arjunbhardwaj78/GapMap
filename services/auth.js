const crypto = require('crypto');
const db = require('../database/db');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ----- brute-force protection: 8 wrong tries on one username locks it for 15 minutes (a 4-digit PIN has only 10,000 combinations) -----
const MAX_FAILS = 8, LOCK_MS = 15 * 60 * 1000;
const fails = new Map();   // username -> { n, first, until }
let clock = Date.now;
const keyOf = (u) => String(u || '').trim().toLowerCase().slice(0, 60);
function throttleCheck(key) {
  const f = fails.get(key);
  if (f && f.until > clock()) throw new HttpError(429, `Too many wrong tries. Please wait ${Math.ceil((f.until - clock()) / 60000)} minute(s), then try again.`);
}
function throttleFail(key) {
  const t = clock();
  if (fails.size > 5000) for (const [k, f] of fails) if (t - f.first > LOCK_MS) fails.delete(k);
  let f = fails.get(key);
  if (!f || t - f.first > LOCK_MS) f = { n: 0, first: t, until: 0 };
  f.n++; if (f.n >= MAX_FAILS) f.until = t + LOCK_MS;
  fails.set(key, f);
}
const SESSION_DAYS = 14;   // a sign-in lasts 14 days, then the person signs in again

const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');

function createUser({ username, password, name, role, studentId = null }) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new HttpError(400, 'Username: 3-30 letters, numbers, dot, dash or underscore.');
  if (String(password || '').length < 4) throw new HttpError(400, 'Password must be at least 4 characters.');
  if (!String(name || '').trim()) throw new HttpError(400, 'Name is required.');
  if (db.get('SELECT id FROM users WHERE username = ?', [u])) throw new HttpError(409, 'That username is already taken.');
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.run('INSERT INTO users (username, name, role, salt, hash, student_id) VALUES (?,?,?,?,?,?)',
    [u, String(name).trim(), role, salt, hashPw(password, salt), studentId]);
  return Number(r.lastInsertRowid);
}

function login(username, password, role) {
  const key = keyOf(username);
  throttleCheck(key);
  const u = db.get('SELECT * FROM users WHERE username = ?', [String(username || '').trim().toLowerCase()]);
  let ok = false;
  try { ok = Boolean(u) && crypto.timingSafeEqual(Buffer.from(hashPw(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex')); } catch (e) { ok = false; }
  if (!ok || (role && u.role !== role)) { throttleFail(key); throw new HttpError(401, 'Wrong username or password.'); }
  fails.delete(key);
  db.run(`DELETE FROM sessions WHERE created_at < datetime('now', '-${SESSION_DAYS} days')`);
  const token = crypto.randomBytes(32).toString('hex');
  db.run('INSERT INTO sessions (token, user_id) VALUES (?,?)', [token, u.id]);
  return { token, user: publicUser(u) };
}

const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, studentId: u.student_id });

function userFromToken(token) {
  if (!token) return null;
  return db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.created_at > datetime('now', '-${SESSION_DAYS} days')`, [token]) || null;
}

// Express middleware: requireRole('teacher') or requireRole('student')
function requireRole(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const u = userFromToken(token);
    if (!u) return res.status(401).json({ error: 'Please sign in.' });
    if (role && u.role !== role) return res.status(403).json({ error: 'This page is for ' + role + 's.' });
    req.user = u; req.token = token; next();
  };
}

function setPassword(userId, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.run('UPDATE users SET salt = ?, hash = ? WHERE id = ?', [salt, hashPw(password, salt), userId]);
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
function checkPassword(userRow, password) {
  try { return crypto.timingSafeEqual(Buffer.from(hashPw(password, userRow.salt), 'hex'), Buffer.from(userRow.hash, 'hex')); } catch (e) { return false; }
}
// Parents and guardians use a password (at least 6 characters) instead of a PIN.
function changePassword(user, oldPassword, newPassword) {
  if (!checkPassword(user, String(oldPassword || ''))) throw new HttpError(400, 'The current password is not right.');
  if (String(newPassword || '').length < 6) throw new HttpError(400, 'The new password must be at least 6 characters.');
  setPassword(user.id, String(newPassword));
  return { ok: true };
}
const _throttle = { reset: () => fails.clear(), setClock: (fn) => { clock = fn || Date.now; }, MAX_FAILS };
const logout = (token) => db.run('DELETE FROM sessions WHERE token = ?', [token]);
module.exports = { changePassword, _throttle, setPassword, checkPassword, HttpError, createUser, login, logout, userFromToken, requireRole, publicUser };
