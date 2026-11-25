// GapMap business logic. Routes are thin wrappers around these functions.
// `ai` is injected so tests can run without Gemini: { configured(), readSheetTwice(file,mime,qs), describeRule(file,mime,q,final) }
const crypto = require('crypto');
const db = require('../database/db');
const v = require('../verify');
const engine = require('./engine');
const practice = require('./practice');
const tinyfish = require('./tinyfish');
const gemini = require('./gemini');
const notify = require('./notify');
const { HttpError, createUser } = require('./auth');

const PRESETS = [
  { key: 'fractions-basic', title: 'Fractions: add, subtract, multiply',
    expressions: ['1/2+1/3', '2/5+1/5', '3/4+1/6', '5/6-1/3', '7/8-1/4', '2/3*3/4', '1/2*4/5'] },
  { key: 'integers-basic', title: 'Integers: add and subtract',
    expressions: ['6-(-4)', '3-(-8)', '-8+5', '-10+4', '5-(-6)', '-9+3'] },
];

const fs = require('fs');
const forget = (p) => { try { if (p) fs.unlinkSync(p); } catch (e) { /* already gone */ } };
const J = (s) => (s ? JSON.parse(s) : null);
const must = (row, msg = 'Not found.') => { if (!row) throw new HttpError(404, msg); return row; };

// ---------- ownership checks ----------
function ownClass(user, classId) {
  const c = must(db.get('SELECT * FROM classes WHERE id = ?', [classId]), 'Class not found.');
  if (c.teacher_id !== user.id) throw new HttpError(403, 'Not your class.');
  return c;
}
function ownAssessment(user, id) {
  const a = must(db.get('SELECT * FROM assessments WHERE id = ?', [id]), 'Assessment not found.');
  ownClass(user, a.class_id);
  return { ...a, questions: J(a.questions_json) };
}
function ownStudent(user, id) {
  const s = must(db.get('SELECT * FROM students WHERE id = ?', [id]), 'Student not found.');
  ownClass(user, s.class_id);
  return s;
}

// ---------- classes and students ----------
const listClasses = (user) => db.all(
  `SELECT c.id, c.name, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS studentCount
   FROM classes c WHERE c.teacher_id = ? ORDER BY c.id DESC`, [user.id]);

function createClass(user, name) {
  if (!String(name || '').trim()) throw new HttpError(400, 'Class name is required.');
  return { id: Number(db.run('INSERT INTO classes (teacher_id, name) VALUES (?,?)', [user.id, String(name).trim()]).lastInsertRowid) };
}

const newPin = () => String(crypto.randomInt(1000, 10000));
function validPin(p) {
  const s = String(p == null ? '' : p).trim();
  if (!/^\d{4,8}$/.test(s)) throw new HttpError(400, 'A PIN must be 4 to 8 digits.');
  return s;
}

function makeUsername(name, roll) {
  const base = (String(name).trim().split(/\s+/)[0] + (roll || '')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || 'student';
  let u = base.length < 3 ? base + '123' : base;
  while (db.get('SELECT id FROM users WHERE username = ?', [u])) u = base + crypto.randomInt(10, 100);
  return u;
}

// The teacher types a display name or roll number. The PIN is shown once.
function addStudent(user, classId, { name, roll, pin: chosenPin }) {
  ownClass(user, classId);
  if (!String(name || '').trim()) throw new HttpError(400, 'Student name or roll number is required.');
  const pin = chosenPin ? validPin(chosenPin) : newPin();      // check the PIN BEFORE saving anything (a bad PIN used to leave a student with no login)
  const username = makeUsername(name, roll);
  const sid = Number(db.run('INSERT INTO students (class_id, name, roll) VALUES (?,?,?)', [classId, String(name).trim(), roll ? String(roll).trim() : null]).lastInsertRowid);
  try { createUser({ username, password: pin, name: String(name).trim(), role: 'student', studentId: sid }); }
  catch (e) { db.run('DELETE FROM students WHERE id = ?', [sid]); throw e; }
  return { id: sid, name: String(name).trim(), roll: roll || null, login: { username, pin } };
}

function resetPin(user, studentId) {
  ownStudent(user, studentId);
  const u = must(db.get('SELECT * FROM users WHERE student_id = ?', [studentId]), 'No login for this student.');
  const salt = crypto.randomBytes(16).toString('hex'), pin = newPin();
  db.run('UPDATE users SET salt = ?, hash = ? WHERE id = ?', [salt, crypto.scryptSync(pin, salt, 32).toString('hex'), u.id]);
  db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  return { username: u.username, pin };
}

// The teacher chooses the PIN for a student
function setPin(user, studentId, pin) {
  ownStudent(user, studentId);
  const u = must(db.get('SELECT * FROM users WHERE student_id = ?', [studentId]), 'No login for this student.');
  require('./auth').setPassword(u.id, validPin(pin));
  return { username: u.username, pin: String(pin).trim() };
}
// A student changes their own PIN (must know the old one)
function changeOwnPin(user, oldPin, newPin_) {
  const auth = require('./auth');
  if (!auth.checkPassword(user, String(oldPin || ''))) throw new HttpError(400, 'The current PIN is not right.');
  auth.setPassword(user.id, validPin(newPin_));
  return { ok: true };
}

const listStudents = (user, classId) => (ownClass(user, classId), db.all(
  `SELECT s.id, s.name, s.roll, u.username FROM students s LEFT JOIN users u ON u.student_id = s.id
   WHERE s.class_id = ? ORDER BY s.id`, [classId]));

// ---------- assessments ----------
function createAssessment(user, classId, { title, expressions, kind, due, subject }) {
  ownClass(user, classId);
  const k = kind === 'homework' ? 'homework' : 'test';
  const dueDate = due ? String(due).trim() : null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, 'Due date must look like 2026-10-20.');
  const list = (expressions || []).map((e) => String(e).trim()).filter(Boolean);
  if (!String(title || '').trim()) throw new HttpError(400, 'Title is required.');
  if (list.length < 1 || list.length > 20) throw new HttpError(400, 'Add 1 to 20 questions.');
  list.forEach((e, i) => { if (v.computeCorrect(e) === null) throw new HttpError(400, `Question ${i + 1} ("${e}") is not a plain number sum like 1/2+1/3.`); });
  const questions = list.map((expression, i) => ({ id: 'Q' + (i + 1), expression }));
  const subj = String(subject || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Maths';
  const id = Number(db.run('INSERT INTO assessments (class_id, title, questions_json, kind, due, subject) VALUES (?,?,?,?,?,?)', [classId, String(title).trim(), JSON.stringify(questions), k, dueDate, subj]).lastInsertRowid);
  const ttl = String(title).trim();
  const sent = notify.notifyClass(classId, k === 'homework'
    ? { type: 'homework_assigned', key: 'homework_assigned:' + id, title: 'New homework: ' + ttl, body: dueDate ? 'Please hand it in by ' + dueDate + '.' : 'Your teacher set new homework.', link: '#/s/homework/' + id, hi: require('./hindi').homeworkAssigned(ttl, dueDate) }
    : { type: 'test_assigned', key: 'test_assigned:' + id, title: 'New test: ' + ttl, body: 'Your teacher has set a new test.', link: '#/s', hi: require('./hindi').testAssigned(ttl) });
  return { id, notified: sent, notifiedText: notify.sentText(sent) };
}

const listAssessments = (user, classId) => (ownClass(user, classId), db.all(
  `SELECT a.id, a.title, a.kind, a.due, a.subject, a.created_at AS createdAt,
     (SELECT COUNT(*) FROM submissions s WHERE s.assessment_id = a.id AND s.status = 'final') AS sheetsDone
   FROM assessments a WHERE a.class_id = ? ORDER BY a.id DESC`, [classId]));

const getAssessment = (user, id) => { const a = ownAssessment(user, id); return { id: a.id, classId: a.class_id, title: a.title, kind: a.kind, due: a.due, subject: a.subject || 'Maths', questions: a.questions }; };

// ---------- upload -> read twice (draft) ----------
async function readSubmission(user, ai, assessmentId, studentId, file) {
  const a = ownAssessment(user, assessmentId);
  const s = ownStudent(user, studentId);
  if (s.class_id !== a.class_id) throw new HttpError(400, 'That student is not in this class.');
  if (!file) throw new HttpError(400, 'Please choose a photo, image or PDF.');
  if (!ai.configured()) { forget(file.path); throw new HttpError(503, 'Sheet reading is not set up (Gemini key or model missing). Use "Type the answers" instead.'); }
  let readA, readB;
  try { [readA, readB] = await ai.readSheetTwice(file.path, file.mimetype, a.questions); } catch (e) { forget(file.path); throw e; }   // no orphan photo of a child's work on the disk
  const oldSheet = db.get('SELECT file_path FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, s.id]);
  if (oldSheet) forget(oldSheet.file_path);
  db.run('DELETE FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, s.id]);
  const id = Number(db.run(
    'INSERT INTO submissions (assessment_id, student_id, file_path, mime_type, read_a_json, read_b_json, status) VALUES (?,?,?,?,?,?,?)',
    [a.id, s.id, file.path, file.mimetype, JSON.stringify(readA), JSON.stringify(readB), 'read']).lastInsertRowid);
  return draftView(id, a.questions);
}

function draftView(submissionId, questions) {
  const sub = db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  const A = J(sub.read_a_json), B = J(sub.read_b_json);
  return {
    submissionId, status: sub.status, hasFile: Boolean(sub.file_path),
    answers: questions.map((q) => {
      const a = A[q.id]?.final ?? 'UNCLEAR', b = B[q.id]?.final ?? 'UNCLEAR';
      const agree = engine.sameValue(a, b) && String(a).toUpperCase() !== 'UNCLEAR';
      return { id: q.id, expression: q.expression, readA: a, readB: b, value: a, agree };
    }),
  };
}

// ---------- confirm (teacher accepted or corrected) -> check, verify, save ----------
// answers: optional { Q1: "2/5", ... } typed or corrected by the teacher. Those count as agreed.
async function confirmSubmission(user, ai, submissionId, answers = {}) {
  const sub = must(db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]), 'Sheet not found.');
  const a = ownAssessment(user, sub.assessment_id);
  const out = await finalizeSubmission(sub, a, ai, answers);
  const sent = notify.notifyStudent(sub.student_id, { type: 'result_ready', key: 'result:' + a.id + ':' + sub.student_id, title: 'Result ready: ' + a.title,
    body: `Marks: ${out.result.marks} out of ${out.result.total}. Open it to see the details.`, link: a.kind === 'homework' ? '#/s/homework/' + a.id : '#/s/results', hi: require('./hindi').result(a.title, out.result.marks, out.result.total, true) });
  return { ...out, notified: sent, notifiedText: notify.sentText(sent) };
}
// Shared by the teacher flow and the student homework flow (ownership is checked by the caller).
async function finalizeSubmission(sub, a, ai, answers = {}) {
  const A = J(sub.read_a_json) || {}, B = J(sub.read_b_json) || {};
  const readA = {}, readB = {};
  for (const q of a.questions) {
    const typed = answers[q.id];
    if (typed !== undefined && String(typed).trim() !== '') { readA[q.id] = { final: String(typed).trim() }; readB[q.id] = { final: String(typed).trim() }; }
    else { readA[q.id] = A[q.id] || { final: 'UNCLEAR' }; readB[q.id] = B[q.id] || { final: 'UNCLEAR' }; }
  }
  // Known slips are tried FIRST by code (no AI call, so a named pattern even when the AI is over its limit).
  // The AI is asked only when no known slip fits; its rule still has to pass the code check to count.
  const describeRule = async (q, final) => {
    const lib = engine.findLibraryRule(q, final);
    if (lib) return lib;
    if (!(ai.configured() && sub.file_path)) return null;
    try { return await ai.describeRule(sub.file_path, sub.mime_type, q, final); }
    catch (e) { return { rule: '', aiFailed: e && e.reason ? gemini.messageFor(e.reason) : 'The AI could not suggest a pattern for this answer.' }; }
  };
  const result = await engine.analyzeStudent({ questions: a.questions, readA, readB, describeRule });
  db.run('UPDATE submissions SET read_a_json = ?, read_b_json = ?, status = ?, result_json = ? WHERE id = ?',
    [JSON.stringify(readA), JSON.stringify(readB), 'final', JSON.stringify(result), sub.id]);
  try { require('./alerts').afterChange([sub.student_id]); } catch (e) { console.error('[alerts]', e.message); }   // lazy require: alerts needs core
  return { submissionId: sub.id, studentId: sub.student_id, result };
}

// Typed answers with no sheet at all
async function manualSubmission(user, ai, assessmentId, studentId, answers) {
  const a = ownAssessment(user, assessmentId);
  const s = ownStudent(user, studentId);
  if (s.class_id !== a.class_id) throw new HttpError(400, 'That student is not in this class.');
  if (!a.questions.some((q) => String((answers || {})[q.id] ?? '').trim())) throw new HttpError(400, 'Type at least one answer. An empty sheet would be saved as fully "unclear".');
  const oldSheet = db.get('SELECT file_path FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, s.id]);
  if (oldSheet) forget(oldSheet.file_path);
  db.run('DELETE FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, s.id]);
  const id = Number(db.run('INSERT INTO submissions (assessment_id, student_id, status) VALUES (?,?,?)', [a.id, s.id, 'read']).lastInsertRowid);
  return confirmSubmission(user, ai, id, answers || {});
}

function submissionFile(user, submissionId) {
  const sub = must(db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]));
  ownAssessment(user, sub.assessment_id);
  if (!sub.file_path || !require('fs').existsSync(sub.file_path)) throw new HttpError(404, 'No sheet was uploaded for this student.');
  return { path: sub.file_path, mime: sub.mime_type };
}


// Draft (waiting for the teacher) or final result of one sheet
function getSheet(user, submissionId) {
  const sub = must(db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]), 'Sheet not found.');
  const a = ownAssessment(user, sub.assessment_id);
  const st = db.get('SELECT * FROM students WHERE id = ?', [sub.student_id]);
  const base = { submissionId: sub.id, assessmentId: a.id, assessment: a.title, studentId: st.id, studentName: st.name, hasFile: Boolean(sub.file_path), source: sub.source };
  if (sub.status !== 'final') return { ...base, status: 'read', draft: draftView(sub.id, a.questions) };
  const names = Object.fromEntries(db.all('SELECT signature, name FROM group_names WHERE assessment_id = ?', [a.id]).map((x) => [x.signature, x.name]));
  return { ...base, status: 'final', result: J(sub.result_json), names };
}

// ---------- class report: students, groups, review ----------
function reportData(user, assessmentId) {
  const a = ownAssessment(user, assessmentId);
  const students = db.all('SELECT id, name, roll FROM students WHERE class_id = ? ORDER BY id', [a.class_id]);
  const subs = db.all("SELECT * FROM submissions WHERE assessment_id = ? AND status = 'final'", [a.id]);
  const renames = Object.fromEntries(db.all('SELECT signature, name FROM group_names WHERE assessment_id = ?', [a.id]).map((r) => [r.signature, r.name]));
  const results = subs.map((s) => ({ student: s.student_id, submissionId: s.id, result: J(s.result_json) }));
  return { a, students, results, renames };
}

function explanationFor(results, signature) {
  for (const r of results) for (const it of r.result.items) {
    if (it.verified && v.signature(it.ruleExpression) === signature && it.explanation) return it.explanation;
  }
  return '';
}

function getReport(user, assessmentId) {
  const { a, students, results, renames } = reportData(user, assessmentId);
  const nameOf = Object.fromEntries(students.map((s) => [s.id, s.name]));
  const rep = engine.buildClassReport(results, renames);
  const byStudent = Object.fromEntries(results.map((r) => [r.student, r]));
  return {
    assessment: { id: a.id, title: a.title, total: a.questions.length },
    students: students.map((s) => {
      const r = byStudent[s.id];
      if (!r) return { id: s.id, name: s.name, roll: s.roll, done: false };
      const named = (f) => ({ signature: f.signature, name: renames[f.signature] || engine_name(results, f.signature), questions: f.questions, level: f.level });
      return { id: s.id, name: s.name, roll: s.roll, done: true, submissionId: r.submissionId, marks: r.result.marks, total: r.result.total,
        findings: r.result.findings.map(named), needsReview: r.result.needsReview };
    }),
    groups: rep.groups.map((g) => ({ signature: g.signature, name: g.name, count: g.count, explanation: explanationFor(results, g.signature),
      students: g.students.map((id) => ({ id, name: nameOf[id] })) })),
    suspected: rep.suspected.map((x) => ({ ...x, studentName: nameOf[x.student] })),
    review: rep.review.map((x) => ({ ...x, studentName: nameOf[x.student] })),
    submittedCount: results.length,
  };
}
function engine_name(results, signature) {
  for (const r of results) for (const it of r.result.items) if (it.verified && v.signature(it.ruleExpression) === signature && it.ruleName) return it.ruleName;
  return 'Unnamed pattern';
}

function renameGroup(user, assessmentId, signature, name) {
  ownAssessment(user, assessmentId);
  const n = engine.cleanName(name);
  if (!n) throw new HttpError(400, 'Use a plain-language name of 4-70 characters (no codes like M1).');
  db.run('INSERT INTO group_names (assessment_id, signature, name) VALUES (?,?,?) ON CONFLICT(assessment_id, signature) DO UPDATE SET name = excluded.name', [assessmentId, signature, n]);
  return { name: n };
}

// ---------- remedial kit ----------
async function getKit(user, assessmentId, signature) {
  const rep = getReport(user, assessmentId);
  const g = must(rep.groups.find((x) => x.signature === signature), 'Group not found.');
  const { results } = reportData(user, assessmentId);
  const sources = new Set();
  const examples = [];
  results.forEach((r) => r.result.items.forEach((it) => {
    if (it.verified && v.signature(it.ruleExpression) === signature) {
      sources.add(it.expression);
      if (examples.length < 3) examples.push({ question: it.expression, studentWrote: it.studentAnswer, correct: it.correct });
    }
  }));
  const sample = practice.generatePractice({ rule: signature, sourceExpressions: [...sources], count: 5 });
  const resources = await tinyfish.searchResources(g.name); // topic only
  const assigned = db.get('SELECT COUNT(*) AS n FROM practice_sets WHERE assessment_id = ? AND signature = ?', [assessmentId, signature]).n;
  return { name: g.name, explanation: g.explanation, students: g.students, examples, samplePractice: sample, resources, assignedCount: assigned };
}

// The questions a group got wrong (used to build practice and printable sheets)
function groupSources(user, assessmentId, signature) {
  const rep = getReport(user, assessmentId);
  const g = must(rep.groups.find((x) => x.signature === signature), 'Group not found.');
  const { results } = reportData(user, assessmentId);
  const sources = new Set();
  results.forEach((r) => r.result.items.forEach((it) => { if (it.verified && v.signature(it.ruleExpression) === signature) sources.add(it.expression); }));
  return { name: g.name, explanation: g.explanation, sources: [...sources] };
}

// One practice sheet per student in the group. Each student gets different random numbers.
function assignPractice(user, assessmentId, signature) {
  const rep = getReport(user, assessmentId);
  const g = must(rep.groups.find((x) => x.signature === signature), 'Group not found.');
  const { results } = reportData(user, assessmentId);
  const sources = new Set();
  results.forEach((r) => r.result.items.forEach((it) => { if (it.verified && v.signature(it.ruleExpression) === signature) sources.add(it.expression); }));
  let made = 0;
  for (const st of g.students) {
    if (db.get('SELECT id FROM practice_sets WHERE assessment_id = ? AND student_id = ? AND signature = ?', [assessmentId, st.id, signature])) continue;
    const qs = practice.generatePractice({ rule: signature, sourceExpressions: [...sources], count: 5, seed: crypto.randomInt(1, 2 ** 31) });
    if (!qs.length) continue;
    db.run('INSERT INTO practice_sets (assessment_id, student_id, signature, title, questions_json) VALUES (?,?,?,?,?)',
      [assessmentId, st.id, signature, 'Practice: ' + g.name, JSON.stringify(qs)]);
    made++;
  }
  return { assigned: made, groupSize: g.students.length };
}

// ---------- teacher: history ----------
function classHistory(user, classId) {
  ownClass(user, classId);
  const rows = db.all(
    `SELECT s.id AS studentId, s.name AS studentName, a.id AS assessmentId, a.title, sub.result_json, sub.created_at
     FROM submissions sub JOIN students s ON s.id = sub.student_id JOIN assessments a ON a.id = sub.assessment_id
     WHERE s.class_id = ? AND sub.status = 'final' ORDER BY sub.id DESC`, [classId]);
  return rows.map((r) => {
    const res = J(r.result_json);
    const names = Object.fromEntries(db.all('SELECT signature, name FROM group_names WHERE assessment_id = ?', [r.assessmentId]).map((x) => [x.signature, x.name]));
    const nm = (sig) => names[sig] || res.items.find((i) => i.verified && v.signature(i.ruleExpression) === sig)?.ruleName || 'Unnamed pattern';
    return { studentId: r.studentId, student: r.studentName, assessmentId: r.assessmentId, assessment: r.title, marks: res.marks, total: res.total,
      likely: res.findings.filter((f) => f.level === 'likely').map((f) => nm(f.signature)),
      suspected: res.findings.filter((f) => f.level === 'suspected').map((f) => nm(f.signature)),
      needsReview: res.needsReview.length };
  }).filter((r) => r.likely.length || r.suspected.length || r.needsReview || r.marks < r.total);
}

// ---------- student portal ----------
function studentHome(user) {
  if (!user.student_id) throw new HttpError(403, 'No student record for this login.');
  return studentHomeById(user.student_id);
}
function studentHomeById(studentId) {
  const st = must(db.get('SELECT * FROM students WHERE id = ?', [studentId]), 'Student not found.');
  const subs = db.all(
    `SELECT sub.*, a.title FROM submissions sub JOIN assessments a ON a.id = sub.assessment_id
     WHERE sub.student_id = ? AND sub.status = 'final' ORDER BY sub.id DESC`, [st.id]);
  const sets = db.all('SELECT * FROM practice_sets WHERE student_id = ? ORDER BY id DESC', [st.id]);
  return {
    name: st.name,
    results: subs.map((s) => {
      const res = J(s.result_json);
      const names = Object.fromEntries(db.all('SELECT signature, name FROM group_names WHERE assessment_id = ?', [s.assessment_id]).map((x) => [x.signature, x.name]));
      const nm = (sig) => names[sig] || res.items.find((i) => i.verified && v.signature(i.ruleExpression) === sig)?.ruleName || 'Unnamed pattern';
      const expl = (sig) => res.items.find((i) => i.verified && v.signature(i.ruleExpression) === sig && i.explanation)?.explanation || '';
      // What is the student's problem? Said plainly, never "nice work" when answers were wrong.
      const wrongQs = res.items.filter((i) => i.status === 'wrong').map((i) => i.q);
      const likelyF = res.findings.filter((f) => f.level === 'likely'), susF = res.findings.filter((f) => f.level === 'suspected');
      const problem = { kind: likelyF.length ? 'likely' : susF.length ? 'suspected' : wrongQs.length || res.needsReview.length ? 'unclear' : 'none', wrong: wrongQs, wrongCount: wrongQs.length };
      return { assessmentId: s.assessment_id, title: s.title, marks: res.marks, total: res.total, problem,
        items: res.items.map((i) => {
          const sig = i.verified && i.ruleExpression ? v.signature(i.ruleExpression) : null;   // only a code-verified pattern is shown as the reason
          return { q: i.q, expression: i.expression, yourAnswer: i.studentAnswer, correct: i.correct, status: i.status,
            pattern: sig ? nm(sig) : null, patternHow: sig ? expl(sig) : '' };
        }),
        likely: res.findings.filter((f) => f.level === 'likely').map((f) => ({ name: nm(f.signature), explanation: expl(f.signature), questions: f.questions })),
        suspected: res.findings.filter((f) => f.level === 'suspected').map((f) => ({ name: nm(f.signature), questions: f.questions })),
        reviewCount: res.needsReview.length };
    }),
    gaps: subs.slice(0, 3).flatMap((s) => {
      const res = J(s.result_json);
      const names = Object.fromEntries(db.all('SELECT signature, name FROM group_names WHERE assessment_id = ?', [s.assessment_id]).map((x) => [x.signature, x.name]));
      return res.findings.filter((f) => f.level === 'likely').map((f) => ({
        assessmentId: s.assessment_id, signature: f.signature,
        name: names[f.signature] || res.items.find((i) => i.verified && v.signature(i.ruleExpression) === f.signature)?.ruleName || 'Unnamed pattern',
        setsMade: sets.filter((p) => p.assessment_id === s.assessment_id && p.signature === f.signature).length, maxSets: MAX_SETS_PER_GAP }));
    }),
    practice: sets.map((p) => ({ id: p.id, title: p.title, total: JSON.parse(p.questions_json).length, score: p.score, done: p.score !== null })),
  };
}

function getPractice(user, id) {
  const p = must(db.get('SELECT * FROM practice_sets WHERE id = ? AND student_id = ?', [id, user.student_id]));
  const qs = J(p.questions_json), attempt = J(p.attempt_json);
  return { id: p.id, title: p.title, done: p.score !== null, score: p.score, total: qs.length,
    // The answer key is revealed only after the student has submitted.
    questions: qs.map((q) => ({ number: q.number, instruction: q.instruction, prompt: q.prompt, ...(attempt ? { answer: q.answer, yourAnswer: attempt.answers[q.number] ?? '', correct: v.checkAnswer(q.expression, attempt.answers[q.number] ?? '').status === 'correct' } : {}) })) };
}

function submitPractice(user, id, answers) {
  const p = must(db.get('SELECT * FROM practice_sets WHERE id = ? AND student_id = ?', [id, user.student_id]));
  const qs = J(p.questions_json);
  const marked = practice.markPractice(qs, answers || {});
  db.run('UPDATE practice_sets SET score = ?, total = ?, attempt_json = ?, done_at = CURRENT_TIMESTAMP WHERE id = ?', [marked.score, marked.total, JSON.stringify({ answers: answers || {} }), p.id]);
  return { score: marked.score, total: marked.total, results: marked.results };
}


// ---------- teacher: overview report (numbers for the charts) ----------
function getOverview(user, assessmentId) {
  const { a, students, results, renames } = reportData(user, assessmentId);
  const n = results.length, total = a.questions.length;
  const sigName = (sig) => renames[sig] || engine_name(results, sig);
  const marks = Array.from({ length: total + 1 }, (_, m) => ({ marks: m, students: results.filter((r) => r.result.marks === m).length }));
  const perQuestion = a.questions.map((q, i) => {
    const sts = results.map((r) => r.result.items[i]?.status);
    return { q: i + 1, expression: q.expression, correct: sts.filter((s) => s === 'correct').length, wrong: sts.filter((s) => s === 'wrong').length,
      review: sts.filter((s) => s === 'needs_review' || s === 'unsupported').length, total: n };
  });
  const pat = {};
  results.forEach((r) => r.result.findings.forEach((f) => {
    pat[f.signature] = pat[f.signature] || { signature: f.signature, name: sigName(f.signature), likely: 0, suspected: 0 };
    pat[f.signature][f.level === 'likely' ? 'likely' : 'suspected']++;
  }));
  const status = { noGap: 0, likely: 0, suspectedOnly: 0, review: 0 };
  results.forEach((r) => {
    const L = r.result.findings.some((f) => f.level === 'likely'), S = r.result.findings.length > 0;
    if (L) status.likely++; else if (S) status.suspectedOnly++; else if (r.result.needsReview.length) status.review++; else if (r.result.marks === r.result.total) status.noGap++; else status.review++;
  });
  // practice progress: each student's test score vs their practice score, per pattern
  const byStudent = Object.fromEntries(results.map((r) => [r.student, r.result]));
  const sets = db.all('SELECT * FROM practice_sets WHERE assessment_id = ?', [a.id]);
  const prog = {};
  sets.forEach((s) => {
    const g = prog[s.signature] = prog[s.signature] || { signature: s.signature, name: sigName(s.signature), assigned: 0, done: 0, before: [], after: [] };
    g.assigned++;
    if (s.score !== null && byStudent[s.student_id]) { g.done++; g.before.push(byStudent[s.student_id].marks / byStudent[s.student_id].total); g.after.push(s.score / s.total); }
  });
  const avg = (x) => (x.length ? Math.round((x.reduce((p, q) => p + q, 0) / x.length) * 100) : null);
  return {
    assessment: { id: a.id, title: a.title, total }, studentsInClass: students.length, sheetsChecked: n,
    averageMarks: n ? Math.round((results.reduce((p, r) => p + r.result.marks, 0) / n) * 10) / 10 : null,
    marks, perQuestion, patterns: Object.values(pat).sort((x, y) => y.likely - x.likely || y.suspected - x.suspected), status,
    practice: Object.values(prog).map((g) => ({ signature: g.signature, name: g.name, assigned: g.assigned, done: g.done, beforePct: avg(g.before), afterPct: avg(g.after) })),
  };
}

// ---------- AI teaching ideas for a group (text only; never student data) ----------
async function getTips(user, ai, assessmentId, signature) {
  const rep = getReport(user, assessmentId);
  const g = must(rep.groups.find((x) => x.signature === signature), 'Group not found.');
  const cached = db.get('SELECT tips_json FROM group_tips WHERE assessment_id = ? AND signature = ?', [assessmentId, signature]);
  if (cached) return { ...J(cached.tips_json), cached: true };
  if (!ai.tips || !ai.configured()) throw new HttpError(503, 'AI ideas are not set up (Gemini key or model missing).');
  const tips = await ai.tips(g.name, g.explanation || g.name);
  if (!tips.activities.length) throw new HttpError(502, 'The AI did not return usable ideas. Try again.');
  db.run('INSERT OR REPLACE INTO group_tips (assessment_id, signature, tips_json) VALUES (?,?,?)', [assessmentId, signature, JSON.stringify(tips)]);
  return { ...tips, cached: false };
}

// ---------- student: own PIN is above; new practice from their own diagnosis, and AI hints ----------
const MAX_SETS_PER_GAP = 6;
function newPractice(user, assessmentId, signature) {
  const sid = user.student_id;
  const sub = must(db.get("SELECT * FROM submissions WHERE assessment_id = ? AND student_id = ? AND status = 'final'", [assessmentId, sid]), 'No checked sheet for this test.');
  const res = J(sub.result_json);
  if (!res.findings.some((f) => f.level === 'likely' && f.signature === signature)) throw new HttpError(400, 'Practice is only made for a gap your teacher has seen in 2 or more questions.');
  const sources = [...new Set(res.items.filter((it) => it.verified && v.signature(it.ruleExpression) === signature).map((it) => it.expression))];
  const existing = db.all('SELECT questions_json FROM practice_sets WHERE assessment_id = ? AND student_id = ? AND signature = ?', [assessmentId, sid, signature]);
  if (existing.length >= MAX_SETS_PER_GAP) throw new HttpError(400, 'You have reached the practice limit for this gap. Ask your teacher for more.');
  const avoid = existing.flatMap((r) => J(r.questions_json).map((q) => q.expression));
  const qs = practice.generatePractice({ rule: signature, sourceExpressions: sources, count: 5, seed: crypto.randomInt(1, 2 ** 31), avoid });
  if (qs.length < 3) throw new HttpError(400, 'Could not make a new practice set for this gap.');
  const name = db.get('SELECT name FROM group_names WHERE assessment_id = ? AND signature = ?', [assessmentId, signature])?.name
    || res.items.find((i) => i.verified && v.signature(i.ruleExpression) === signature)?.ruleName || 'Practice';
  const id = Number(db.run('INSERT INTO practice_sets (assessment_id, student_id, signature, title, questions_json) VALUES (?,?,?,?,?)',
    [assessmentId, sid, signature, 'Practice: ' + name, JSON.stringify(qs)]).lastInsertRowid);
  return { id };
}

// Hint for a question the student got wrong, only after they submitted (the answer key is already visible then).
async function practiceHint(user, ai, practiceId, number) {
  const p = must(db.get('SELECT * FROM practice_sets WHERE id = ? AND student_id = ?', [practiceId, user.student_id]));
  if (p.score === null) throw new HttpError(400, 'Submit your answers first.');
  const q = J(p.questions_json).find((x) => x.number === Number(number));
  const attempt = J(p.attempt_json);
  if (!q) throw new HttpError(404, 'Question not found.');
  if (v.checkAnswer(q.expression, attempt.answers[q.number] ?? '').status === 'correct') throw new HttpError(400, 'You got that one right.');
  if (!ai.hint || !ai.configured()) throw new HttpError(503, 'AI hints are not set up (Gemini key or model missing).');
  const sub = db.get("SELECT result_json FROM submissions WHERE assessment_id = ? AND student_id = ? AND status = 'final'", [p.assessment_id, p.student_id]);
  const it = sub && J(sub.result_json).items.find((i) => i.verified && v.signature(i.ruleExpression) === p.signature);
  const hint = await ai.hint({ name: it?.ruleName || p.title, explanation: it?.explanation || '', expression: q.expression, correct: q.answer });
  if (!hint) throw new HttpError(502, 'The AI did not return a hint. Try again.');
  return { hint };
}

// ---------- labelled sample class (so the app can be shown without real sheets) ----------
async function createSampleClass(user, ai) {
  const cls = createClass(user, 'Sample class (demo data)');
  const names = ['Sample 1', 'Sample 2', 'Sample 3', 'Sample 4', 'Sample 5', 'Sample 6'];
  const studs = names.map((n, i) => addStudent(user, cls.id, { name: n, roll: String(i + 1) }));
  const asm = createAssessment(user, cls.id, { title: 'Fractions check (sample)', expressions: PRESETS[0].expressions });
  const sheets = [
    ['2/5', '3/10', '4/10', '1/2', '5/8', '1/2', '2/5'],
    ['2/5', '3/5', '2/5', '1/2', '5/8', '6', '4'],
    ['2/5', '3/5', '2/5', '4/3', '3/2', '16/9', '5/8'],
    ['5/6', '3/5', '11/12', '3/6', '5/8', '6/12', '4/10'],
    ['2/5', '3/10', '4/10', '1/2', '5/8', '1/2', '2/5'],
    ['5/6', '3/5', '2/5', '4/3', '3/2', '1/2', '2/5'],
  ];
  for (let i = 0; i < studs.length; i++) {
    await manualSubmission(user, { configured: () => false }, asm.id, studs[i].id, Object.fromEntries(sheets[i].map((x, k) => ['Q' + (k + 1), x])));
  }
  return { classId: cls.id, assessmentId: asm.id, students: studs.map((s) => ({ name: s.name, login: s.login })) };
}

module.exports = { forget, studentHomeById, J, must, db, ownClass, ownAssessment, ownStudent, finalizeSubmission, draftView, groupSources, MAX_SETS_PER_GAP, setPin, changeOwnPin, getOverview, getTips, newPractice, practiceHint, createSampleClass, PRESETS, listClasses, createClass, addStudent, resetPin, listStudents, createAssessment, listAssessments, getAssessment,
  readSubmission, getSheet, confirmSubmission, manualSubmission, submissionFile, getReport, renameGroup, getKit, assignPractice, classHistory,
  studentHome, getPractice, submitPractice };
