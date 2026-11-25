// Milestone 10: multiple-choice PAPER tests for any subject.
// The teacher gives a paper test. For each student the teacher uploads a photo/PDF of the answer sheet (the AI reads the circled
// letters TWICE), or types the letters. The teacher checks the draft. CODE then marks and counts the mistaken ideas (concept.js).
// A paper test is a quiz with mode 'paper'. Each confirmed sheet becomes a normal quiz_attempts row, so participation, gaps by
// idea, the student's "Your problem" screen and the help modal all reuse the quiz engine.
// Rules kept: the AI never marks. A blank or unclear answer is never guessed: it counts as no answer (wrong, "unclear").
const fs = require('fs');
const crypto = require('crypto');
const db = require('../database/db');
const core = require('./core');
const x = require('./extras');
const concept = require('./concept');
const gemini = require('./gemini');
const { HttpError } = require('./auth');

const { J, must } = core;
const LETTERS = ['A', 'B', 'C', 'D'];

// "B", "b)", "(c)", 2 (index) -> 0..3. Anything else -> null (never guessed).
function letterToIndex(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-D]/g, '');
  return s.length === 1 ? LETTERS.indexOf(s) : null;
}
// Typed letters: "BACDB" (use - or . for a blank), or an object { 1: "B", 2: null }.
function parseLetters(input, count) {
  const out = {};
  if (typeof input === 'string') {
    const chars = input.replace(/[\s,;]/g, '').toUpperCase().split('');
    if (chars.length > count) throw new HttpError(400, `You typed ${chars.length} letters but the test has ${count} questions.`);
    chars.forEach((ch, i) => {
      if ('-._?X'.includes(ch)) return;
      const k = letterToIndex(ch);
      if (k === null) throw new HttpError(400, `"${ch}" is not an option. Use A, B, C or D (or - for no answer).`);
      out[i + 1] = k;
    });
    return out;
  }
  if (input && typeof input === 'object') {
    for (let n = 1; n <= count; n++) {
      const v = input[n];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      const k = letterToIndex(/^\d$/.test(String(v).trim()) ? Number(v) : v);
      if (k === null) throw new HttpError(400, `Question ${n}: use A, B, C or D.`);
      out[n] = k;
    }
    return out;
  }
  throw new HttpError(400, 'Type the letters, for example BACDB.');
}

// ---------- teacher: create ----------
// Same builder as a quiz (typed block, or AI draft), but only multiple-choice questions. Stays DRAFT until the teacher publishes.
const createPaperTest = (user, ai, classId, body) => x.createQuiz(user, ai, classId, { ...body, mode: 'paper' });

function paperQuiz(user, quizId) {
  const q = x.ownQuiz(user, quizId);
  if (q.mode !== 'paper') throw new HttpError(400, 'This is an online quiz, not a paper test.');
  return q;
}
function readyForSheets(q) {
  if (q.status === 'draft') throw new HttpError(400, 'Publish the paper test first (check the answer key before you mark any sheet).');
  if (q.status === 'closed') throw new HttpError(400, 'This paper test is closed.');
}
function studentOf(user, q, studentId) {
  const s = must(db.get('SELECT * FROM students WHERE id = ?', [studentId]), 'Student not found.');
  if (s.class_id !== q.class_id) throw new HttpError(400, 'That student is not in this class.');
  core.ownClass(user, s.class_id);
  return s;
}
const forget = (p) => { try { if (p) fs.unlinkSync(p); } catch (e) { /* already gone */ } };

// ---------- teacher: photo/PDF sheet -> two reads -> draft ----------
async function readPaperSheet(user, ai, quizId, studentId, file) {
  const q = paperQuiz(user, quizId); readyForSheets(q);
  const s = studentOf(user, q, studentId);
  if (!file) throw new HttpError(400, 'Please choose a photo, image or PDF.');
  if (!ai.configured() || !ai.readChoiceSheetTwice) { forget(file.path); throw new HttpError(503, gemini.messageFor('no_key') + ' You can type the letters instead.'); }
  let A, B;
  try { [A, B] = await ai.readChoiceSheetTwice(file.path, file.mimetype, q.questions.length); } catch (e) { forget(file.path); throw e; }
  const old = db.get('SELECT * FROM paper_sheets WHERE quiz_id = ? AND student_id = ?', [q.id, s.id]);
  if (old) { forget(old.file_path); db.run('DELETE FROM paper_sheets WHERE id = ?', [old.id]); }
  const id = Number(db.run('INSERT INTO paper_sheets (quiz_id, student_id, file_path, mime_type, read_a_json, read_b_json, status) VALUES (?,?,?,?,?,?,?)',
    [q.id, s.id, file.path, file.mimetype, JSON.stringify(A || {}), JSON.stringify(B || {}), 'draft']).lastInsertRowid);
  return draftView(id, q);
}

// Each question: both reads agree on a letter -> prefilled. Otherwise left BLANK for the teacher (never guessed).
function draftView(sheetId, q) {
  const sh = db.get('SELECT * FROM paper_sheets WHERE id = ?', [sheetId]);
  const A = J(sh.read_a_json) || {}, B = J(sh.read_b_json) || {};
  return {
    sheetId, quizId: q.id, studentId: sh.student_id, status: sh.status, hasFile: Boolean(sh.file_path),
    answers: q.questions.map((qq) => {
      const ra = A[qq.number] ?? 'UNCLEAR', rb = B[qq.number] ?? 'UNCLEAR';
      const ia = letterToIndex(ra), ib = letterToIndex(rb);
      const agree = ia !== null && ia === ib;
      return { number: qq.number, text: qq.text, options: qq.options, readA: ra, readB: rb, agree, value: agree ? ia : null };
    }),
  };
}

// ---------- teacher: typed letters or checked draft -> mark -> save ----------
function saveAttempt(q, studentId, answers) {
  const clean = x.cleanAnswers(q.questions, answers);
  const m = x.markQuiz(q.questions, clean);
  db.run(`INSERT INTO quiz_attempts (quiz_id, student_id, answers_json, score, total) VALUES (?,?,?,?,?)
          ON CONFLICT(quiz_id, student_id) DO UPDATE SET answers_json = excluded.answers_json, score = excluded.score, total = excluded.total, created_at = CURRENT_TIMESTAMP`,
  [q.id, studentId, JSON.stringify(clean), m.score, m.total]);
  require('./notify').notifyStudent(studentId, { type: 'result_ready', key: 'result_q:' + q.id + ':' + studentId, title: 'Result ready: ' + q.title,
    body: `Marks: ${m.score} out of ${m.total}.`, link: '#/s/quizzes', hi: require('./hindi').result(q.title, m.score, m.total, false) });
  try { require('./alerts').afterChange([studentId]); } catch (e) { console.error('[alerts]', e.message); }
  return m;
}
function typedPaperSheet(user, quizId, studentId, letters) {
  const q = paperQuiz(user, quizId); readyForSheets(q);
  const s = studentOf(user, q, studentId);
  const answers = parseLetters(letters, q.questions.length);
  if (!Object.keys(answers).length) throw new HttpError(400, 'Type at least one answer.');
  saveAttempt(q, s.id, answers);
  return attemptView(user, q.id, s.id);
}
function confirmPaperSheet(user, sheetId, answers) {
  const sh = must(db.get('SELECT * FROM paper_sheets WHERE id = ?', [sheetId]), 'Sheet not found.');
  const q = paperQuiz(user, sh.quiz_id); readyForSheets(q);
  saveAttempt(q, sh.student_id, parseLetters(answers || {}, q.questions.length));
  db.run("UPDATE paper_sheets SET status = 'final' WHERE id = ?", [sh.id]);
  return attemptView(user, q.id, sh.student_id);
}
function getPaperSheet(user, sheetId) {
  const sh = must(db.get('SELECT * FROM paper_sheets WHERE id = ?', [sheetId]), 'Sheet not found.');
  const q = paperQuiz(user, sh.quiz_id);
  if (sh.status !== 'final') return { status: 'draft', draft: draftView(sh.id, q) };
  return { status: 'final', ...attemptView(user, q.id, sh.student_id), sheetId: sh.id };
}
function paperSheetFile(user, sheetId) {
  const sh = must(db.get('SELECT * FROM paper_sheets WHERE id = ?', [sheetId]), 'Sheet not found.');
  paperQuiz(user, sh.quiz_id);
  if (!sh.file_path || !fs.existsSync(sh.file_path)) throw new HttpError(404, 'No sheet was uploaded for this student.');
  return { path: sh.file_path, mime: sh.mime_type };
}

// One student's answers on a quiz (paper or online): what they picked, the key, the idea, and the pattern found by code.
function attemptView(user, quizId, studentId) {
  const q = x.ownQuiz(user, quizId);
  const s = must(db.get('SELECT * FROM students WHERE id = ?', [studentId]), 'Student not found.');
  if (s.class_id !== q.class_id) throw new HttpError(404, 'Student not found.');
  const a = must(db.get('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [quizId, studentId]), 'No answers for this student yet.');
  const ans = J(a.answers_json) || {};
  const sheet = db.get('SELECT id, status FROM paper_sheets WHERE quiz_id = ? AND student_id = ?', [quizId, studentId]);
  return { quizId, title: q.title, mode: q.mode, student: { id: s.id, name: s.name }, score: a.score, total: a.total,
    sheetId: sheet ? sheet.id : null, hasFile: Boolean(sheet && db.get('SELECT file_path FROM paper_sheets WHERE id = ?', [sheet.id]).file_path),
    problem: concept.diagnose(q.questions, ans), questions: q.questions.map((qq) => x.revealQ(qq, ans[qq.number])) };
}

// ---------- teacher: practice quiz for the students who share one mistaken idea ----------
// Shuffle one question's options. The correct index and the idea tags move with their options.
function shuffleQuestion(q, rnd = (n) => crypto.randomInt(n)) {
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = rnd(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = { ...q, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct) };
  if (q.tags) out.tags = order.map((i) => q.tags[i]);
  delete out.builtin;
  return out;
}

async function groupPracticeQuiz(user, ai, quizId, tag, { includeSuspected = false } = {}) {
  const q = x.ownQuiz(user, quizId);
  if (q.status === 'draft') throw new HttpError(400, 'Publish the test and add student answers first.');
  const key = concept.tagKey(tag);
  const students = db.all('SELECT id, name FROM students WHERE class_id = ?', [q.class_id]);
  const named = Object.fromEntries(students.map((s) => [s.id, s.name]));
  const att = db.all('SELECT * FROM quiz_attempts WHERE quiz_id = ?', [quizId]).map((a) => ({ student_id: a.student_id, name: named[a.student_id] || '', answers: J(a.answers_json) || {} }));
  const gap = concept.classGaps(q.questions, att).find((g) => g.key === key);
  if (!key || !gap) throw new HttpError(404, 'That mistaken idea was not found in this class.');
  const group = [...gap.likely, ...(includeSuspected ? gap.suspected : [])];
  if (!group.length) throw new HttpError(400, 'Nobody is likely to hold this idea yet (it needs the same idea in 2 or more of a student\'s wrong answers). Nothing was created.');

  // Questions: AI drafts them (tagged). If the AI is off or fails, re-use the teacher's own questions that carry this idea, options shuffled.
  let qs = [], source = 'ai', note = null;
  if (ai.configured() && ai.quiz) {
    try {
      qs = x.cleanQuestions(await ai.quiz({ topic: `Fix this mistaken idea: ${gap.name}. (Test topic: ${q.topic})`, count: 5, allowMcq: true, subject: q.subject, level: null }), { allowMcq: true, max: 5 });
      if (!qs.length) note = 'The AI did not return usable questions.';
    } catch (e) { note = e && e.reason ? gemini.messageFor(e.reason) : 'The AI could not write the quiz.'; }
  } else note = gemini.messageFor('no_key');
  if (!qs.length) {
    qs = x.renumber(q.questions.filter((qq) => qq.type === 'mcq' && (qq.tags || []).some((t) => t && concept.tagKey(t) === key)).map((qq) => shuffleQuestion(qq)));
    source = 'reshuffled';
    note = (note ? note + ' ' : '') + 'The practice quiz re-uses the test questions that carry this idea, with the options shuffled.';
  }
  if (!qs.length) throw new HttpError(422, 'Could not make practice questions for this idea.');
  const ids = group.map((g) => g.id);
  const id = Number(db.run('INSERT INTO quizzes (class_id, student_id, title, topic, subject, status, questions_json, mode, audience_json) VALUES (?,?,?,?,?,?,?,?,?)',
    [q.class_id, null, 'Practice: ' + gap.name, gap.name, q.subject || null, 'draft', JSON.stringify(qs), 'online', JSON.stringify(ids)]).lastInsertRowid);
  return { ...x.quizView(x.ownQuiz(user, id)), source, note, audience: group.map((g) => ({ id: g.id, name: g.name })) };
}

module.exports = { LETTERS, letterToIndex, parseLetters, shuffleQuestion, createPaperTest, readPaperSheet, typedPaperSheet, confirmPaperSheet, getPaperSheet, paperSheetFile, attemptView, groupPracticeQuiz };
