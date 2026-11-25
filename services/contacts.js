// Contact numbers with consent. A number is visible to the other side ONLY if its owner turned sharing on (default OFF).
// Stored as 10 digits. Never logged, never in notifications, reports, CSV or anything a student or another family can read.
const db = require('../database/db');
const core = require('./core');
const { HttpError } = require('./auth');

const LANGS = ['', 'en', 'hi'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// "98765 43210", "+91 98765-43210", "09876543210", "(91) 9876543210" -> "9876543210". Empty -> '' (clears). Anything else -> 400 (the number is NOT echoed back).
function normalisePhone(raw) {
  if (raw == null) return '';
  let d = String(raw).replace(/[\s\-().]/g, '');
  if (d === '') return '';
  if (/^\+91\d{10}$/.test(d)) d = d.slice(3);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw new HttpError(400, 'Type a 10-digit mobile number (it may start with +91). Leave it empty to remove it.');
  return d;
}
const mask = (d) => `${d.slice(0, 2)}xxxxx${d.slice(-3)}`;
const row = (userId) => db.get('SELECT phone, share, preferred_time, language FROM contact_prefs WHERE user_id = ?', [userId]);
const SAFE = 'No number is shared. Use in-app messages: they always work.';

function checkRole(user) { if (!user || (user.role !== 'teacher' && user.role !== 'parent')) throw new HttpError(403, 'Contact details are for teachers and parents.'); }

// ---- my own settings (the owner always sees their own number) ----
function getMine(user) {
  checkRole(user);
  const r = row(user.id) || {};
  const who = user.role === 'teacher' ? 'parents of your classes' : "your child's teacher";
  return { role: user.role, phone: r.phone || '', share: Boolean(r.share), preferredTime: r.preferred_time || '', language: r.language || '',
    shareLabel: user.role === 'teacher' ? 'Show my number to parents of my classes' : "Share my number with my child's teacher",
    note: `Numbers are only visible to each other (you and ${who}), never to other families or students, and never on printed reports. ` + SAFE };
}
function putMine(user, body = {}) {
  checkRole(user);
  const old = row(user.id) || {};
  const phone = body.phone !== undefined ? normalisePhone(body.phone) : (old.phone || '');
  const share = body.share !== undefined ? body.share : Boolean(old.share);
  if (typeof share !== 'boolean') throw new HttpError(400, 'Sharing must be on or off.');
  const lang = body.language !== undefined ? String(body.language || '') : (old.language || '');
  if (!LANGS.includes(lang)) throw new HttpError(400, 'Language must be English or Hindi.');
  if (share && !phone) throw new HttpError(400, 'Add your number first, then you can share it.');
  const time = body.preferredTime !== undefined ? clean(body.preferredTime, 60) : (old.preferred_time || '');
  db.run(`INSERT INTO contact_prefs (user_id, phone, share, preferred_time, language, updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone, share = excluded.share, preferred_time = excluded.preferred_time, language = excluded.language, updated_at = CURRENT_TIMESTAMP`,
    [user.id, phone || null, share ? 1 : 0, time || null, lang || null]);
  return getMine(user);
}
// the teacher may type a parent's number when making the login. It stays hidden until the PARENT switches sharing on.
function setInitialPhone(userId, raw) {
  const phone = normalisePhone(raw);
  if (phone) db.run('INSERT INTO contact_prefs (user_id, phone, share) VALUES (?,?,0) ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone', [userId, phone]);
}

// what the OTHER side may see: the number only when sharing is on and a number exists
function visible(userId) {
  const r = row(userId);
  if (!r || !r.share || !r.phone) return { shared: false, text: SAFE };
  return { shared: true, phone: r.phone, masked: mask(r.phone), preferredTime: r.preferred_time || '', language: r.language || '' };
}

// parent -> the class teacher of ONE of their own children (404 for any other child)
function forParent(user, studentId) {
  if (user.role !== 'parent') throw new HttpError(403, 'This page is for parents.');
  const st = db.get(`SELECT s.id, c.teacher_id, u.name AS teacher_name FROM parent_links pl JOIN students s ON s.id = pl.student_id JOIN classes c ON c.id = s.class_id JOIN users u ON u.id = c.teacher_id
    WHERE pl.user_id = ? AND s.id = ?`, [user.id, studentId]);
  if (!st) throw new HttpError(404, 'Student not found.');
  return { teacherName: st.teacher_name, ...visible(st.teacher_id) };
}
// teacher -> the parents of one student they teach (only parents who agreed)
function parentsOf(studentId) {
  return db.all('SELECT u.id AS userId, u.name, pl.relation FROM parent_links pl JOIN users u ON u.id = pl.user_id WHERE pl.student_id = ? ORDER BY pl.id', [studentId])
    .map((p) => ({ userId: p.userId, name: p.name, relation: p.relation, ...visible(p.userId) }));
}
function forTeacherStudent(user, studentId) { core.ownStudent(user, studentId); return parentsOf(studentId); }
function forTeacherClass(user, classId) {
  core.ownClass(user, classId);
  return { students: db.all('SELECT id, name FROM students WHERE class_id = ? ORDER BY CAST(roll AS INTEGER), roll, name', [classId]).map((s) => ({ studentId: s.id, name: s.name, parents: parentsOf(s.id) })) };
}

module.exports = { normalisePhone, mask, getMine, putMine, setInitialPhone, visible, forParent, parentsOf, forTeacherStudent, forTeacherClass, SAFE };
