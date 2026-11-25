// Milestone 5 logic: quizzes, homework, interview coaching, study help, engagement, badges, CSV.
// Rules kept from before: the AI never marks. Number answers are computed by code (verify.js).
// The only AI-written answer keys are MCQ keys in TEACHER quizzes, which stay DRAFT until the teacher publishes.
const fs = require('fs');
const db = require('../database/db');
const v = require('../verify');
const core = require('./core');
const practice = require('./practice');
const tinyfish = require('./tinyfish');
const gemini = require('./gemini');
const bank = require('./quizbank');
const concept = require('./concept');
const notify = require('./notify');
const { HttpError } = require('./auth');

const { J, must } = core;
const clip = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);
const MAX_SELF_QUIZZES_PER_DAY = 10;
const MAX_FRAMES = 8;

// ---------- dates (India time) ----------
const toIst = (sqlTime) => new Date(Date.parse(String(sqlTime).replace(' ', 'T') + 'Z') + 19800000);
const istDate = (sqlTime) => toIst(sqlTime).toISOString().slice(0, 10);
const todayIst = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ---------- question validation ----------
// raw: what the AI (or teacher) proposed. Number questions keep ONLY the expression; the answer is computed here.
function cleanQuestions(raw, { allowMcq = false, max = 10 } = {}) {
  const out = [], seen = new Set();
  for (const q of Array.isArray(raw) ? raw : []) {
    if (out.length >= max || !q || typeof q !== 'object') continue;
    if (q.type === 'calc' || (q.expression && !q.options)) {
      const expr = String(q.expression || '').trim();
      if (expr.length > 40 || /[a-z]/i.test(expr) || seen.has(expr)) continue;
      const c = v.checkAnswer(expr, '0');
      if (!c.correct) continue;
      seen.add(expr);
      out.push({ number: out.length + 1, type: 'calc', expression: expr, prompt: practice.pretty(expr), answer: c.correct });
    } else if (allowMcq && q.type === 'mcq') {
      const text = clip(q.text, 200), options = (Array.isArray(q.options) ? q.options : []).map((o) => clip(o, 80));
      const correct = Number(q.correct);
      if (text.length < 5 || options.length !== 4 || options.some((o) => !o) || new Set(options).size !== 4) continue;
      if (!Number.isInteger(correct) || correct < 0 || correct > 3 || seen.has(text)) continue;
      seen.add(text);
      const tags = concept.cleanTags(q.tags || q.misconceptions, options, correct);
      out.push({ number: out.length + 1, type: 'mcq', text, options, correct, ...(tags ? { tags } : {}),
        ...(q.builtin === true ? { builtin: true } : {}), ...(q.typed === true ? { typed: true } : {}) });
    }
  }
  return out;
}

// Make questions: try the AI first; if it is off or fails, use the built-in bank. Returns { qs, source, note }.
// note explains WHY the AI was not used (shown to the user) so it never just says "not available".
async function makeQuestions(ai, { topic, count, allowMcq, subject, level }) {
  let qs = [], note = null;
  if (!ai.configured() || !ai.quiz) note = gemini.messageFor('no_key');
  else {
    try { qs = cleanQuestions(await ai.quiz({ topic, count, allowMcq, subject, level }), { allowMcq, max: count }); if (!qs.length) note = 'The AI did not return usable questions for that topic.'; }
    catch (e) { note = e && e.reason ? gemini.messageFor(e.reason) : 'The AI could not write the quiz.'; }
  }
  if (qs.length) return { qs, source: 'ai', note: null };
  qs = cleanQuestions(bank.build({ topic, count, allowMcq }), { allowMcq, max: count });
  if (qs.length) return { qs, source: 'builtin', note: note + ' These questions come from the built-in question bank instead (answers are still computed by the computer).' };
  throw new HttpError(422, `${note} The built-in bank only covers: ${bank.topicNames().join(', ')}. For any other subject, type your own multiple-choice questions (the box below works for every subject), or fix the AI problem above and try again.`);
}
const renumber = (qs) => qs.map((q, i) => ({ ...q, number: i + 1 }));
// A practice quiz can be meant for only some students (audience_json = list of student ids). null = the whole class.
const audienceOf = (q) => { const a = J(q.audience_json); return Array.isArray(a) ? a.map(Number) : null; };
const inAudience = (q, studentId) => { const a = audienceOf(q); return !a || a.includes(Number(studentId)); };

// What a student may see before attempting (no answers)
const publicQ = (q) => (q.type === 'mcq' ? { number: q.number, type: 'mcq', text: q.text, options: q.options } : { number: q.number, type: 'calc', prompt: q.prompt });
const revealQ = (q, given) => {
  const ok = isRight(q, given);
  return q.type === 'mcq'
    ? { ...publicQ(q), correctIndex: q.correct, yourIndex: given === undefined || given === '' ? null : Number(given), correct: ok,
        yourTag: !ok && q.tags && given !== undefined && given !== '' ? (q.tags[Number(given)] || null) : null }
    : { ...publicQ(q), answer: q.answer, yourAnswer: given == null ? '' : String(given), correct: ok };
};
function isRight(q, given) {
  if (given === undefined || given === null || String(given).trim() === '') return false;
  return q.type === 'mcq' ? Number(given) === q.correct && Number.isInteger(Number(given)) : v.checkAnswer(q.expression, String(given)).status === 'correct';
}
function markQuiz(qs, answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const results = qs.map((q) => isRight(q, a[q.number]));
  return { score: results.filter(Boolean).length, total: qs.length };
}
const cleanAnswers = (qs, answers) => {
  const out = {};
  for (const q of qs) { const x = (answers || {})[q.number]; if (x !== undefined && x !== null) out[q.number] = clip(x, 30); }
  return out;
};

// ================= TEACHER QUIZZES =================
function ownQuiz(user, id) {
  const q = must(db.get('SELECT * FROM quizzes WHERE id = ? AND student_id IS NULL', [id]), 'Quiz not found.');
  core.ownClass(user, q.class_id);
  return { ...q, questions: J(q.questions_json) };
}
const quizView = (q) => ({ id: q.id, classId: q.class_id, title: q.title, topic: q.topic, subject: q.subject || null, status: q.status, mode: q.mode || 'online', audienceCount: (audienceOf(q) || []).length || null, questions: q.questions,
  aiKeyCount: q.questions.filter((x) => x.type === 'mcq' && !x.builtin && !x.typed).length, tagList: concept.tagList(q.questions) });

// Typed number sums (no AI), typed multiple-choice (any subject, no AI), or a topic (AI proposes; number answers are still computed by code).
async function createQuiz(user, ai, classId, { title, topic, subject, level, count, expressions, typedMcq, mode }) {
  core.ownClass(user, classId);
  const paper = mode === 'paper';
  if (paper && Array.isArray(expressions) && expressions.some((e) => String(e).trim())) throw new HttpError(400, 'A paper test uses multiple-choice questions with 4 options (A to D).');
  const tp = clip(topic, 120), subj = clip(subject, 60) || null;
  let qs, source = 'typed', note = null;
  if (typeof typedMcq === 'string' && typedMcq.trim()) {
    const parsed = concept.parseTyped(typedMcq);
    qs = cleanQuestions(parsed.questions, { allowMcq: true, max: 20 });
    if (!qs.length) throw new HttpError(400, parsed.problems.length ? parsed.problems.slice(0, 3).join(' ') : 'No valid question found. Each question needs a line of text, then 4 different options, with * before the correct one.');
    if (parsed.problems.length) note = 'Some questions were skipped: ' + parsed.problems.slice(0, 3).join(' ');
  } else if (Array.isArray(expressions) && expressions.some((e) => String(e).trim())) {
    qs = cleanQuestions(expressions.map((e) => ({ type: 'calc', expression: String(e).trim() })), { max: 20 });
    if (!qs.length) throw new HttpError(400, 'None of those were plain number sums like 3/4+1/8.');
  } else {
    if (tp.length < 3) throw new HttpError(400, 'Type a topic (for example "photosynthesis" or "adding fractions") or type the questions.');
    const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 10);
    ({ qs, source, note } = await makeQuestions(ai, { topic: tp, count: n, allowMcq: true, subject: subj, level: clip(level, 40) }));
  }
  if (paper) {   // letters A-D only: keep multiple-choice questions
    const before = qs.length;
    qs = renumber(qs.filter((x) => x.type === 'mcq'));
    if (!qs.length) throw new HttpError(422, 'No multiple-choice questions could be made for a paper test. Type your own questions in the box (any subject).');
    if (qs.length < before) note = (note ? note + ' ' : '') + 'Number-sum questions were left out because a paper test uses options A to D.';
  }
  const ttl = clip(title, 80) || (tp ? (paper ? 'Paper test: ' : 'Quiz: ') + tp : paper ? 'Paper test' : 'Class quiz');
  const id = Number(db.run('INSERT INTO quizzes (class_id, student_id, title, topic, subject, status, questions_json, mode) VALUES (?,?,?,?,?,?,?,?)',
    [classId, null, ttl, tp || 'Typed questions', subj, 'draft', JSON.stringify(qs), paper ? 'paper' : 'online']).lastInsertRowid);
  return { ...quizView(ownQuiz(user, id)), source, note };
}
const getQuiz = (user, id) => {
  const q = ownQuiz(user, id), view = quizView(q), aud = audienceOf(q);
  if (aud && aud.length) view.audience = db.all(`SELECT id, name FROM students WHERE id IN (${aud.map(() => '?').join(',')}) ORDER BY id`, aud);
  return view;
};

function removeQuizQuestion(user, id, number) {
  const q = ownQuiz(user, id);
  if (q.status !== 'draft') throw new HttpError(400, 'Only a draft quiz can be changed.');
  const left = renumber(q.questions.filter((x) => x.number !== Number(number)));
  if (left.length === q.questions.length) throw new HttpError(404, 'Question not found.');
  db.run('UPDATE quizzes SET questions_json = ? WHERE id = ?', [JSON.stringify(left), id]);
  return quizView(ownQuiz(user, id));
}
function setQuizStatus(user, id, status) {
  const q = ownQuiz(user, id);
  if (status === 'published') {
    if (q.status !== 'draft') throw new HttpError(400, 'This quiz is already published.');
    if (!q.questions.length) throw new HttpError(400, 'Add at least one question first.');
  }
  if (status === 'closed' && q.status !== 'published') throw new HttpError(400, 'Only a published quiz can be closed.');
  db.run('UPDATE quizzes SET status = ? WHERE id = ?', [status, id]);
  const view = quizView(ownQuiz(user, id));
  if (status === 'published' && q.student_id === null) {   // tell every student in the audience and their parents, once
    const paper = q.mode === 'paper';
    const sent = notify.notifyClass(q.class_id, paper
      ? { type: 'test_assigned', key: 'quiz_pub:' + id, title: 'New paper test: ' + q.title, body: 'Your teacher will enter your marks after the test. Your result will appear here.', link: '#/s/quizzes', hi: require('./hindi').paperTest(q.title) }
      : { type: 'quiz_assigned', key: 'quiz_pub:' + id, title: 'New quiz: ' + q.title, body: 'Your teacher has published a quiz.', link: '#/s/quiz/' + id, hi: require('./hindi').quizAssigned(q.title) }, audienceOf(q));
    return { ...view, notified: sent, notifiedText: notify.sentText(sent) };
  }
  return view;
}
const publishQuiz = (user, id) => setQuizStatus(user, id, 'published');
const closeQuiz = (user, id) => setQuizStatus(user, id, 'closed');

const listQuizzes = (user, classId) => (core.ownClass(user, classId), db.all(
  `SELECT q.id, q.title, q.topic, q.status, q.mode, q.audience_json, q.created_at AS createdAt,
     (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id) AS attempted,
     (SELECT COUNT(*) FROM students s WHERE s.class_id = q.class_id) AS students
   FROM quizzes q WHERE q.class_id = ? AND q.student_id IS NULL ORDER BY q.id DESC`, [classId]).map(({ audience_json, ...r }) => {
  const aud = audienceOf({ audience_json });
  return { ...r, audienceCount: aud ? aud.length : null, students: aud ? aud.length : r.students };
}));

// Who attempted and who is absent, plus how each question went
function quizParticipation(user, id) {
  const q = ownQuiz(user, id);
  const aud = audienceOf(q);
  const students = db.all('SELECT id, name, roll FROM students WHERE class_id = ? ORDER BY id', [q.class_id]).filter((x) => !aud || aud.includes(x.id));
  const attempts = Object.fromEntries(db.all('SELECT * FROM quiz_attempts WHERE quiz_id = ?', [id]).map((a) => [a.student_id, a]));
  const rows = students.map((s) => { const a = attempts[s.id]; return { id: s.id, name: s.name, roll: s.roll, attempted: Boolean(a), score: a ? a.score : null, total: a ? a.total : q.questions.length }; });
  const att = Object.values(attempts);
  const perQuestion = q.questions.map((qq) => {
    let right = 0;
    att.forEach((a) => { if (isRight(qq, (J(a.answers_json) || {})[qq.number])) right++; });
    return { number: qq.number, label: qq.type === 'mcq' ? qq.text : qq.prompt, correct: right, attempted: att.length };
  });
  const named = Object.fromEntries(students.map((x) => [x.id, x.name]));
  const gaps = concept.classGaps(q.questions, att.map((a) => ({ student_id: a.student_id, name: named[a.student_id] || '', answers: J(a.answers_json) || {} })));
  return { quiz: quizView(q), gaps, attemptedCount: att.length, absentCount: rows.length - att.length, students: rows,
    averagePct: att.length ? Math.round((att.reduce((p, a) => p + a.score / a.total, 0) / att.length) * 100) : null, perQuestion };
}

// ================= STUDENT QUIZZES =================
function me(user) {
  if (!user.student_id) throw new HttpError(403, 'No student record for this login.');
  return must(db.get('SELECT * FROM students WHERE id = ?', [user.student_id]));
}
function studentQuizRow(user, id) {
  const st = me(user);
  const q = must(db.get('SELECT * FROM quizzes WHERE id = ?', [id]), 'Quiz not found.');
  const hasAttempt = Boolean(db.get('SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [id, st.id]));
  const mine = q.student_id === st.id;
  // A paper test is visible only after the teacher has entered this student's sheet. A group practice quiz only to its group.
  const shared = q.student_id === null && q.class_id === st.class_id && q.status !== 'draft' && inAudience(q, st.id) && (q.mode !== 'paper' || hasAttempt);
  if (!mine && !shared) throw new HttpError(404, 'Quiz not found.');
  return { ...q, questions: J(q.questions_json), self: mine };
}

function studentQuizzes(user) {
  const st = me(user);
  const attempts = Object.fromEntries(db.all('SELECT * FROM quiz_attempts WHERE student_id = ?', [st.id]).map((a) => [a.quiz_id, a]));
  const rows = db.all("SELECT * FROM quizzes WHERE (class_id = ? AND student_id IS NULL AND status != 'draft') OR student_id = ? ORDER BY id DESC", [st.class_id, st.id])
    .filter((q) => q.student_id === st.id || (inAudience(q, st.id) && (q.mode !== 'paper' || attempts[q.id])));
  return rows.map((q) => { const a = attempts[q.id]; const n = J(q.questions_json).length;
    return { id: q.id, title: q.title, topic: q.topic, self: q.student_id !== null, status: q.status, paper: q.mode === 'paper', forGroup: Boolean(audienceOf(q)), total: n, attempted: Boolean(a), score: a ? a.score : null,
      canAttempt: !a && q.status === 'published' && q.mode !== 'paper' }; });
}
function getQuizForStudent(user, id) {
  const q = studentQuizRow(user, id);
  const a = db.get('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [id, me(user).id]);
  const base = { id: q.id, title: q.title, topic: q.topic, self: q.self, status: q.status, paper: q.mode === 'paper', forGroup: Boolean(audienceOf(q)), total: q.questions.length };
  if (a) { const ans = J(a.answers_json) || {}; return { ...base, attempted: true, score: a.score, problem: concept.diagnose(q.questions, ans), questions: q.questions.map((x) => revealQ(x, ans[x.number])) }; }
  return { ...base, attempted: false, canAttempt: q.status === 'published', questions: q.questions.map(publicQ) };
}
function submitQuiz(user, id, answers) {
  const st = me(user), q = studentQuizRow(user, id);
  if (q.mode === 'paper') throw new HttpError(400, 'This was a paper test. Your teacher enters the answers from your sheet.');
  if (q.status !== 'published') throw new HttpError(400, 'This quiz is closed.');
  if (db.get('SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [id, st.id])) throw new HttpError(409, 'You have already done this quiz.');
  const clean = cleanAnswers(q.questions, answers), m = markQuiz(q.questions, clean);
  db.run('INSERT INTO quiz_attempts (quiz_id, student_id, answers_json, score, total) VALUES (?,?,?,?,?)', [id, st.id, JSON.stringify(clean), m.score, m.total]);
  try { require('./alerts').afterChange([st.id]); } catch (e) { console.error('[alerts]', e.message); }
  return getQuizForStudent(user, id);
}

// A student's own practice quiz. Number questions only, so CODE writes every answer key.
async function selfQuiz(user, ai, { topic }) {
  const st = me(user);
  const today = todayIst();
  const made = db.all('SELECT created_at FROM quizzes WHERE student_id = ?', [st.id]).filter((r) => istDate(r.created_at) === today).length;
  if (made >= MAX_SELF_QUIZZES_PER_DAY) throw new HttpError(429, `You can make ${MAX_SELF_QUIZZES_PER_DAY} practice quizzes a day. Come back tomorrow.`);
  let tp = clip(topic, 80);
  if (!tp) {
    const gap = (studentHome(user).gaps || [])[0];
    if (!gap) throw new HttpError(400, 'Type a topic, for example "subtracting fractions".');
    tp = gap.name;
  }
  const made2 = await makeQuestions(ai, { topic: tp, count: 5, allowMcq: false });
  const qs = made2.qs;
  if (qs.length < 2) throw new HttpError(422, 'Your own practice quizzes are number sums only (the computer writes every answer, so nothing unchecked reaches you). Try a maths topic like "adding fractions". For other subjects, ask your teacher for a class quiz.');
  const id = Number(db.run('INSERT INTO quizzes (class_id, student_id, title, topic, status, questions_json) VALUES (?,?,?,?,?,?)',
    [st.class_id, st.id, 'My practice: ' + tp, tp, 'published', JSON.stringify(qs)]).lastInsertRowid);
  return { id, source: made2.source, note: made2.note };
}
const studentHome = (user) => core.studentHome(user);

// ================= HOMEWORK =================
function hwFor(user, assessmentId) {
  const st = me(user);
  const a = must(db.get('SELECT * FROM assessments WHERE id = ?', [assessmentId]), 'Homework not found.');
  if (a.class_id !== st.class_id || a.kind !== 'homework') throw new HttpError(404, 'Homework not found.');
  return { st, a: { ...a, questions: J(a.questions_json) } };
}
function listHomework(user) {
  const st = me(user);
  const rows = db.all("SELECT * FROM assessments WHERE class_id = ? AND kind = 'homework' ORDER BY id DESC", [st.class_id]);
  const today = todayIst();
  return rows.map((a) => {
    const s = db.get('SELECT id, status, result_json FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
    const res = s && s.status === 'final' ? J(s.result_json) : null;
    return { id: a.id, title: a.title, due: a.due, overdue: Boolean(a.due && a.due < today && !res), total: J(a.questions_json).length,
      done: Boolean(res), marks: res ? res.marks : null, draftId: s && s.status === 'read' ? s.id : null };
  });
}
function homeworkDetail(user, assessmentId) {
  const { st, a } = hwFor(user, assessmentId);
  const s = db.get('SELECT * FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
  const res = s && s.status === 'final' ? J(s.result_json) : null;
  return { id: a.id, title: a.title, due: a.due, questions: a.questions.map((q) => ({ id: q.id, expression: q.expression, prompt: practice.pretty(q.expression) })),
    done: Boolean(res), result: res ? { marks: res.marks, total: res.total, items: res.items.map((i) => ({ q: i.q, expression: i.expression, yourAnswer: i.studentAnswer, correct: i.correct, status: i.status })), reviewCount: res.needsReview.length } : null };
}
function ensureNotFinal(a, st) {
  const s = db.get('SELECT * FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
  if (s && s.status === 'final') throw new HttpError(409, 'You have already handed this homework in.');
}
// Typed ("CBT") answers: checked straight away by code
async function homeworkTyped(user, ai, assessmentId, answers) {
  const { st, a } = hwFor(user, assessmentId);
  ensureNotFinal(a, st);
  const typed = {};
  for (const q of a.questions) { const x = (answers || {})[q.id]; if (x !== undefined && String(x).trim()) typed[q.id] = clip(x, 20); }
  if (!Object.keys(typed).length) throw new HttpError(400, 'Type at least one answer.');
  db.run('DELETE FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
  const id = Number(db.run("INSERT INTO submissions (assessment_id, student_id, status, source) VALUES (?,?,'read','student')", [a.id, st.id]).lastInsertRowid);
  return studentResult(await core.finalizeSubmission(db.get('SELECT * FROM submissions WHERE id = ?', [id]), a, { ...ai, configured: () => false }, typed));
}
// Photo or PDF: two reads. The student re-types any question where the reads disagree.
async function homeworkPhoto(user, ai, assessmentId, file) {
  const { st, a } = hwFor(user, assessmentId);
  if (!file) throw new HttpError(400, 'Please choose a photo or PDF.');
  try { ensureNotFinal(a, st); } catch (e) { core.forget(file.path); throw e; }
  if (!ai.configured()) { core.forget(file.path); throw new HttpError(503, 'Photo reading is not set up. Type your answers instead.'); }
  let ra, rb;
  try { [ra, rb] = await ai.readSheetTwice(file.path, file.mimetype, a.questions); } catch (e) { core.forget(file.path); throw e; }
  const oldHw = db.get('SELECT file_path FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
  if (oldHw) core.forget(oldHw.file_path);
  db.run('DELETE FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
  const id = Number(db.run("INSERT INTO submissions (assessment_id, student_id, file_path, mime_type, read_a_json, read_b_json, status, source) VALUES (?,?,?,?,?,?,'read','student')",
    [a.id, st.id, file.path, file.mimetype, JSON.stringify(ra), JSON.stringify(rb)]).lastInsertRowid);
  return studentDraft(id, a);
}
function studentDraft(submissionId, a) {
  const d = core.draftView(submissionId, a.questions);
  return { submissionId, assessmentId: a.id, title: a.title,
    // Agreed reads are shown and locked. Disagreeing ones must be typed by the student (blank = teacher will review).
    answers: d.answers.map((x) => ({ id: x.id, prompt: practice.pretty(x.expression), agree: x.agree, value: x.agree ? x.value : '' })) };
}
async function homeworkConfirm(user, ai, submissionId, answers) {
  const st = me(user);
  const sub = must(db.get('SELECT * FROM submissions WHERE id = ? AND student_id = ? AND source = ?', [submissionId, st.id, 'student']), 'Draft not found.');
  if (sub.status === 'final') throw new HttpError(409, 'You have already handed this homework in.');
  const a = hwFor(user, sub.assessment_id).a;
  const d = core.draftView(sub.id, a.questions);
  const typed = {};
  for (const x of d.answers) if (!x.agree && (answers || {})[x.id] !== undefined && String(answers[x.id]).trim()) typed[x.id] = clip(answers[x.id], 20);
  return studentResult(await core.finalizeSubmission(sub, a, ai, typed));
}
const studentResult = (r) => ({ marks: r.result.marks, total: r.result.total, reviewCount: r.result.needsReview.length,
  items: r.result.items.map((i) => ({ q: i.q, expression: i.expression, yourAnswer: i.studentAnswer, correct: i.correct, status: i.status })) });

// ================= INTERVIEW COACH (audio only) =================
const INTERVIEW_QUESTIONS = [
  'Tell me about yourself.',
  'Why do you want to join this school, course or program?',
  'What is your biggest strength, and how have you used it?',
  'Tell me about a time you worked in a team.',
  'Tell me about a problem you solved.',
  'Where do you see yourself in five years?',
  'Describe a mistake you made and what you learned from it.',
  'Why should we choose you?',
];
const rubricKeys = ['clarity', 'relevance', 'structure', 'confidence', 'vocabulary'];
const score15 = (n) => Math.min(5, Math.max(1, Math.round(Number(n)) || 1));
const list = (x, n, len) => (Array.isArray(x) ? x : []).slice(0, n).map((s) => clip(s, len)).filter(Boolean);
// Keep only the fields we expect, as short plain text. Never store anything else the AI returned.
function sanitizeFeedback(raw) {
  if (Array.isArray(raw)) raw = raw[0];               // some replies come wrapped in a list
  if (!raw || typeof raw !== 'object' || raw.audible === false) return null;
  const rubric = {};
  for (const k of rubricKeys) { const r = (raw.rubric || {})[k] || {}; rubric[k] = { score: score15(r.score), reason: clip(r.reason, 200) }; }
  const bodyKeys = ['eyeContact', 'expression', 'posture'];
  let body = null;
  if (raw.bodyVisible !== false && raw.body && typeof raw.body === 'object') {
    body = {};
    for (const k of bodyKeys) { const r = raw.body[k] || {}; body[k] = { score: score15(r.score), reason: clip(r.reason, 200) }; }
  }
  const summary = clip(raw.summary || (Array.isArray(raw.strengths) ? raw.strengths[0] : '') || raw.feedback || raw.tryThis, 400);
  const fb = { summary, rubric, ...(body ? { body } : {}), strengths: list(raw.strengths, 4, 200), improve: list(raw.improve, 4, 200), fillers: list(raw.fillers, 6, 20), tryThis: clip(raw.tryThis, 250) };
  return fb.summary ? fb : null;
}
// files: the audio file (or, for compatibility, one file object). frames: optional JPEG snapshots (video mode).
// Every uploaded file is deleted in `finally`, whatever happens.
async function submitInterview(user, ai, { question, consent, share, mode }, file, frames = []) {
  const st = me(user);
  const frameList = (Array.isArray(frames) ? frames : []).filter(Boolean).slice(0, MAX_FRAMES);
  const drop = () => [file, ...frameList].forEach((f) => { if (f && f.path) fs.rm(f.path, { force: true }, () => {}); });
  try {
    if (!(consent === true || consent === 'true' || consent === '1' || consent === 'on')) throw new HttpError(400, 'Please tick the box to allow the AI to listen to your recording.');
    if (!file) throw new HttpError(400, 'No recording received.');
    const video = mode === 'video';
    if (video && frameList.length < 3) throw new HttpError(400, 'Video mode needs the camera pictures. Allow the camera and try again, or use voice only.');
    const qText = clip(question, 200);
    if (qText.length < 5) throw new HttpError(400, 'Choose a question first.');
    if (!ai.configured() || !ai.interview) throw new HttpError(503, 'The interview coach needs the AI key (GEMINI_API_KEY in .env). Add it and restart the server.');
    let raw;
    try { raw = await ai.interview(file.path, file.mimetype, qText, video ? frameList : []); }
    catch (e) { throw new HttpError(502, e && e.reason ? gemini.messageFor(e.reason) : 'The AI could not listen to that recording. Try again.'); }
    const fb = sanitizeFeedback(raw);
    if (!fb) {
      const heardNothing = raw && !Array.isArray(raw) && raw.audible === false;
      console.error('[interview] no usable feedback:', heardNothing ? 'AI said it heard no clear speech' : 'unexpected reply shape, keys=' + Object.keys(raw && typeof raw === 'object' ? raw : {}).join(','));
      throw heardNothing
        ? new HttpError(422, 'The AI could not make out clear speech in that recording. Speak for at least 10 seconds, close to the microphone, in a quiet place. In the browser, check that the right microphone is selected and the level bar moves while you talk.')
        : new HttpError(502, 'The AI replied in a format the app could not read. Please try again.');
    }
    if (video && !fb.body) fb.bodyNote = 'The camera could not see you clearly in most pictures, so there is no on-camera feedback. Sit with your face in the middle of the picture and good light in front of you.';
    fb.mode = video ? 'video' : 'voice';
    const shared = share === true || share === 'true' || share === '1' || share === 'on' ? 1 : 0;
    const id = Number(db.run('INSERT INTO interviews (student_id, question, feedback_json, shared) VALUES (?,?,?,?)', [st.id, qText, JSON.stringify(fb), shared]).lastInsertRowid);
    return { id, question: qText, feedback: fb, shared: Boolean(shared), note: video
      ? 'AI coaching feedback, not a grade. It looked at a few snapshots, not a full video. Your recording and pictures were deleted after they were analysed.'
      : 'AI coaching feedback, not a grade. Your recording was deleted after it was analysed.' };
  } finally { drop(); }
}
const myInterviews = (user) => db.all('SELECT * FROM interviews WHERE student_id = ? ORDER BY id DESC LIMIT 30', [me(user).id])
  .map((r) => ({ id: r.id, question: r.question, feedback: J(r.feedback_json), shared: Boolean(r.shared), at: r.created_at }));
function shareInterview(user, id, shared) {
  const r = must(db.get('SELECT * FROM interviews WHERE id = ? AND student_id = ?', [id, me(user).id]));
  db.run('UPDATE interviews SET shared = ? WHERE id = ?', [shared ? 1 : 0, r.id]);
  return { id: r.id, shared: Boolean(shared) };
}
const classInterviews = (user, classId) => (core.ownClass(user, classId), db.all(
  `SELECT i.*, s.name FROM interviews i JOIN students s ON s.id = i.student_id WHERE s.class_id = ? AND i.shared = 1 ORDER BY i.id DESC LIMIT 100`, [classId])
  .map((r) => ({ id: r.id, student: r.name, question: r.question, feedback: J(r.feedback_json), at: r.created_at })));

// ================= STUDY HELP =================
function studentGap(user, assessmentId, signature) {
  const st = me(user);
  const sub = must(db.get("SELECT * FROM submissions WHERE assessment_id = ? AND student_id = ? AND status = 'final'", [assessmentId, st.id]), 'No checked sheet for this test.');
  const res = J(sub.result_json);
  if (!res.findings.some((f) => f.level === 'likely' && f.signature === signature)) throw new HttpError(400, 'Study help is made for a gap your teacher has seen in 2 or more questions.');
  const it = res.items.find((i) => i.verified && v.signature(i.ruleExpression) === signature);
  const name = db.get('SELECT name FROM group_names WHERE assessment_id = ? AND signature = ?', [assessmentId, signature])?.name || it?.ruleName || 'Your practice area';
  return { name, explanation: it?.explanation || '', expression: it?.expression };
}
async function resourcesFor(name) {
  const hit = db.get('SELECT * FROM resource_cache WHERE topic = ?', [name]);
  if (hit && Date.now() - Date.parse(hit.fetched_at.replace(' ', 'T') + 'Z') < 86400000) return J(hit.json);
  const r = await tinyfish.searchResources(name);   // topic only
  if (r.live) db.run('INSERT OR REPLACE INTO resource_cache (topic, json, fetched_at) VALUES (?,?,CURRENT_TIMESTAMP)', [name, JSON.stringify(r)]);
  return r;
}
// Mini lesson (AI words, code answer) + online resources + a link to a printable sheet
async function studyHelp(user, ai, assessmentId, signature) {
  const g = studentGap(user, assessmentId, signature);
  let lesson = null, lessonMessage = '';
  const c = g.expression && v.checkAnswer(g.expression, '0');
  if (c && c.correct) {
    const key = signature + '|' + g.expression;
    const cached = db.get('SELECT json FROM gap_lessons WHERE key = ?', [key]);
    if (cached) lesson = J(cached.json);
    else if (ai.configured() && ai.lesson) {
      try {
        const l = await ai.lesson({ name: g.name, explanation: g.explanation, expression: g.expression, correct: c.correct });
        if (l.steps.length >= 2) { lesson = l; db.run('INSERT OR REPLACE INTO gap_lessons (key, json) VALUES (?,?)', [key, JSON.stringify(l)]); }
      } catch (e) { /* fall through */ }
      if (!lesson) lessonMessage = 'The AI mini lesson could not be made right now.';
    } else lessonMessage = 'AI mini lessons are not set up.';
    if (lesson) lesson = { ...lesson, example: practice.pretty(g.expression), answer: c.correct };
  }
  const resources = await resourcesFor(g.name);
  return { name: g.name, explanation: g.explanation, lesson, lessonMessage, resources };
}

// Help for one mistaken idea found in a class quiz (any subject). The explanation is AI-written and cannot be checked by code, so it is labelled.
async function conceptHelp(user, ai, quizId, tag) {
  const st = me(user), q = studentQuizRow(user, quizId);
  const a = must(db.get('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [quizId, st.id]), 'Do the quiz first.');
  const key = concept.tagKey(tag);
  const ans = J(a.answers_json) || {};
  const d = concept.diagnose(q.questions, ans);
  const hit = d.tags.find((t) => t.key === key);
  if (!key || !hit) throw new HttpError(400, 'That mistaken idea was not found in your answers.');
  const qq = q.questions.find((x) => x.number === hit.questions[0]);
  const ckey = `concept|${quizId}|${key}`;
  let lesson = null, lessonMessage = '';
  const cached = db.get('SELECT json FROM gap_lessons WHERE key = ?', [ckey]);
  if (cached) lesson = J(cached.json);
  else if (ai.configured() && ai.conceptLesson) {
    try {
      const l = await ai.conceptLesson({ subject: q.subject, topic: q.topic, tag: hit.name, question: qq.text, wrongChoice: qq.options[Number(ans[qq.number])], rightChoice: qq.options[qq.correct] });
      if (l.steps.length >= 2) { lesson = l; db.run('INSERT OR REPLACE INTO gap_lessons (key, json) VALUES (?,?)', [ckey, JSON.stringify(l)]); }
    } catch (e) { /* fall through */ }
    if (!lesson) lessonMessage = 'The AI explanation could not be made right now.';
  } else lessonMessage = 'AI explanations are not set up.';
  const resources = await resourcesFor([q.subject, hit.name].filter(Boolean).join(' - '));
  return { name: hit.name, level: hit.level, lesson, lessonMessage, resources, note: 'AI explanation: the computer cannot check facts, so confirm with your teacher or book.' };
}

// Printable remedial sheet. Questions and answer key both come from code.
function sheetFrom(name, explanation, sources, rule, seed, count) {
  const qs = practice.generatePractice({ rule, sourceExpressions: sources, count, seed });
  return { title: 'Remedial sheet: ' + name, explanation, questions: qs.map((q) => ({ number: q.number, prompt: q.prompt })), answerKey: qs.map((q) => ({ number: q.number, answer: q.answer })) };
}
function studentSheet(user, assessmentId, signature) {
  const st = me(user);
  const g = studentGap(user, assessmentId, signature);
  const sub = db.get("SELECT result_json FROM submissions WHERE assessment_id = ? AND student_id = ? AND status = 'final'", [assessmentId, st.id]);
  const sources = [...new Set(J(sub.result_json).items.filter((i) => i.verified && v.signature(i.ruleExpression) === signature).map((i) => i.expression))];
  const s = sheetFrom(g.name, g.explanation, sources, signature, require('crypto').randomInt(1, 2 ** 31), 8);
  if (s.questions.length < 3) throw new HttpError(400, 'Could not make a sheet for this gap.');
  return s;
}
function teacherSheet(user, assessmentId, signature) {
  const g = core.groupSources(user, assessmentId, signature);
  const s = sheetFrom(g.name, g.explanation, g.sources, signature, require('crypto').randomInt(1, 2 ** 31), 8);
  if (s.questions.length < 3) throw new HttpError(400, 'Could not make a sheet for this group.');
  return s;
}

// ================= BADGES, STREAK, ENGAGEMENT =================
function activityOf(studentId) {
  const acts = [];
  db.all('SELECT done_at AS t FROM practice_sets WHERE student_id = ? AND score IS NOT NULL AND done_at IS NOT NULL', [studentId]).forEach((r) => acts.push({ kind: 'practice', t: r.t }));
  db.all("SELECT a.created_at AS t FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.student_id = ? AND q.mode = 'online'", [studentId]).forEach((r) => acts.push({ kind: 'quiz', t: r.t }));
  db.all("SELECT created_at AS t FROM submissions WHERE student_id = ? AND source = 'student' AND status = 'final'", [studentId]).forEach((r) => acts.push({ kind: 'homework', t: r.t }));
  db.all('SELECT created_at AS t FROM interviews WHERE student_id = ?', [studentId]).forEach((r) => acts.push({ kind: 'interview', t: r.t }));
  return acts;
}
function streakOf(acts) {
  const days = new Set(acts.map((a) => istDate(a.t)));
  const today = todayIst();
  let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return { current: n, activeToday: days.has(today), days: days.size };
}
function badgesOf(studentId, acts, streak) {
  const count = (k) => acts.filter((a) => a.kind === k).length;
  const perfect = db.get('SELECT COUNT(*) AS n FROM practice_sets WHERE student_id = ? AND score = total AND total > 0', [studentId]).n
    + db.get("SELECT COUNT(*) AS n FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.student_id = ? AND a.score = a.total AND a.total > 0 AND q.mode = 'online'", [studentId]).n;
  const defs = [
    ['first-practice', 'First practice', 'Finished a practice set', count('practice') >= 1],
    ['practice-5', 'Practice habit', 'Finished 5 practice sets', count('practice') >= 5],
    ['perfect', 'Full marks', 'Got every answer right in a practice set or quiz', perfect >= 1],
    ['quiz-3', 'Quiz regular', 'Did 3 quizzes', count('quiz') >= 3],
    ['homework', 'Homework done', 'Handed in homework online', count('homework') >= 1],
    ['speaker', 'Found your voice', 'Tried an interview practice', count('interview') >= 1],
    ['streak-3', '3-day streak', 'Active 3 days in a row', streak.current >= 3],
    ['streak-7', '7-day streak', 'Active 7 days in a row', streak.current >= 7],
  ];
  return defs.map(([key, name, how, earned]) => ({ key, name, how, earned }));
}
function studentProgress(user) {
  const st = me(user), acts = activityOf(st.id), streak = streakOf(acts);
  return { streak, badges: badgesOf(st.id, acts, streak) };
}

// Teacher: who is taking part
function engagement(user, classId) {
  core.ownClass(user, classId);
  const students = db.all('SELECT id, name, roll FROM students WHERE class_id = ? ORDER BY id', [classId]);
  const nQuiz = db.get("SELECT COUNT(*) AS n FROM quizzes WHERE class_id = ? AND student_id IS NULL AND status != 'draft' AND mode = 'online' AND audience_json IS NULL", [classId]).n;
  const nHw = db.get("SELECT COUNT(*) AS n FROM assessments WHERE class_id = ? AND kind = 'homework'", [classId]).n;
  const rows = students.map((s) => {
    const acts = activityOf(s.id), streak = streakOf(acts);
    const quizzes = db.get("SELECT COUNT(*) AS n FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.student_id = ? AND q.student_id IS NULL AND q.mode = 'online' AND q.audience_json IS NULL", [s.id]).n;
    const homework = db.get("SELECT COUNT(*) AS n FROM submissions sub JOIN assessments a ON a.id = sub.assessment_id WHERE sub.student_id = ? AND a.kind = 'homework' AND sub.status = 'final'", [s.id]).n;
    const last = acts.map((a) => a.t).sort().pop();
    return { id: s.id, name: s.name, roll: s.roll, quizzes, homework, practiceDone: acts.filter((a) => a.kind === 'practice').length,
      interviews: acts.filter((a) => a.kind === 'interview').length, streak: streak.current, lastActive: last ? istDate(last) : null,
      badges: badgesOf(s.id, acts, streak).filter((b) => b.earned).length, active: acts.length > 0 };
  });
  return { classQuizzes: nQuiz, classHomework: nHw, students: rows, inactive: rows.filter((r) => !r.active).map((r) => r.name) };
}

// ================= CSV =================
// Cells that start with = + - @ can run as formulas in Excel, so they get a leading apostrophe.
function csvCell(x) {
  let s = x == null ? '' : String(x);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
function assessmentCsv(user, assessmentId) {
  const rep = core.getReport(user, assessmentId);
  const rows = [['Student', 'Roll', 'Marks', 'Out of', 'Likely gaps', 'Suspected', 'Questions needing teacher review']];
  rep.students.forEach((s) => rows.push(s.done
    ? [s.name, s.roll, s.marks, s.total, s.findings.filter((f) => f.level === 'likely').map((f) => f.name).join('; '), s.findings.filter((f) => f.level === 'suspected').map((f) => f.name).join('; '), (s.needsReview || []).length]
    : [s.name, s.roll, 'not checked yet', rep.assessment.total, '', '', '']));
  return { filename: 'results-' + assessmentId + '.csv', text: toCsv(rows) };
}
function engagementCsv(user, classId) {
  const e = engagement(user, classId);
  const rows = [['Student', 'Roll', 'Class quizzes done', 'Class quizzes set', 'Homework done', 'Homework set', 'Practice sets done', 'Interview practices', 'Streak (days)', 'Last active', 'Badges']];
  e.students.forEach((s) => rows.push([s.name, s.roll, s.quizzes, e.classQuizzes, s.homework, e.classHomework, s.practiceDone, s.interviews, s.streak, s.lastActive || 'never', s.badges]));
  return { filename: 'participation-class-' + classId + '.csv', text: toCsv(rows) };
}

module.exports = { activityOf, badgesOf, todayIst, addDays, me, ownQuiz, quizView, revealQ, markQuiz, cleanAnswers, makeQuestions, renumber, audienceOf, cleanQuestions, sanitizeFeedback, csvCell, toCsv, istDate, streakOf, INTERVIEW_QUESTIONS, MAX_SELF_QUIZZES_PER_DAY,
  createQuiz, getQuiz, removeQuizQuestion, publishQuiz, closeQuiz, listQuizzes, quizParticipation,
  studentQuizzes, getQuizForStudent, submitQuiz, selfQuiz,
  listHomework, homeworkDetail, homeworkTyped, homeworkPhoto, homeworkConfirm,
  submitInterview, myInterviews, shareInterview, classInterviews,
  conceptHelp, studyHelp, studentSheet, teacherSheet, studentProgress, engagement, assessmentCsv, engagementCsv };
