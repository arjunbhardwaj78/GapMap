// Milestone 10 tests: multiple-choice PAPER tests for any subject (teacher enters each student's sheet, code marks, ideas counted).
// No internet and no real AI: a FAKE AI is injected. Real Gemini reading of real photos is NOT covered here.
process.env.DATABASE_PATH = ':memory:';
const fs = require('fs'), os = require('os'), path = require('path');
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const choice = require('./services/choice');
const db = require('./database/db');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const throwsStatus = async (fn, status) => { try { await fn(); return false; } catch (e) { return e.status === status; } };
const user = (u) => auth.userFromToken(auth.login(u.username, u.pin || 'pass1234').token);
const tmp = (n) => { const p = path.join(os.tmpdir(), 'gm-choice-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '-' + n); fs.writeFileSync(p, 'x'); return p; };

// The teacher's own questions (typed block). Tag N = "Thinks the nucleus does every job", tag R = "Mixes up protein with energy".
const N = 'Thinks the nucleus does every job', R = 'Mixes up protein with energy';
const BLOCK = [
  ['Which part of the cell makes energy?', '*Mitochondria', `Nucleus | ${N}`, `Ribosome | ${R}`, 'Chloroplast'],
  ['Which part controls the cell?', '*Nucleus', 'Vacuole', `Ribosome | ${R}`, 'Cell wall'],
  ['Where is protein made?', `Nucleus | ${N}`, '*Ribosome', 'Vacuole', 'Cell wall'],
  ['Which part stores water?', `Nucleus | ${N}`, 'Mitochondria', '*Vacuole', 'Cell wall'],
  ['What gives a plant cell its shape?', 'Cell membrane', '*Cell wall', `Nucleus | ${N}`, 'Chloroplast'],
].map((b) => b.join('\n')).join('\n\n');
// correct letters: Q1 A, Q2 A, Q3 B, Q4 C, Q5 B  -> "AABCB"

// Fake AI. reads: what the two photo reads return. quizItems: what ai.quiz returns.
let reads = null, quizCalls = 0;
const taggedAi = [
  { type: 'mcq', text: 'Which part of the cell controls the other parts?', options: ['Nucleus', 'Vacuole', 'Cell wall', 'Ribosome'], correct: 0, tags: [null, 'Thinks storage and control are the same', null, null] },
  { type: 'mcq', text: 'Which part holds the DNA?', options: ['Vacuole', 'Nucleus', 'Cell wall', 'Ribosome'], correct: 1, tags: ['Thinks storage and control are the same', null, null, null] },
  { type: 'mcq', text: 'Which part of the cell makes protein?', options: ['Ribosome', 'Nucleus', 'Vacuole', 'Cell wall'], correct: 0, tags: [null, N, null, null] },
];
const ai = {
  configured: () => true,
  quiz: async () => { quizCalls++; return taggedAi; },
  readChoiceSheetTwice: async () => reads,
};
const noAi = { configured: () => false };

(async () => {
  // ---------- people ----------
  auth.createUser({ username: 'tea1', password: 'pass1234', name: 'T1', role: 'teacher' });
  const T = user({ username: 'tea1' });
  auth.createUser({ username: 'tea2', password: 'pass1234', name: 'T2', role: 'teacher' });
  const T2 = user({ username: 'tea2' });
  const cls = core.createClass(T, 'Class A'), cls2 = core.createClass(T2, 'Class B');
  const studs = ['A1', 'A2', 'A3', 'A4'].map((n, i) => core.addStudent(T, cls.id, { name: n, roll: String(i + 1) }));
  const other = core.addStudent(T2, cls2.id, { name: 'B1', roll: '1' });
  const S = studs.map((s) => user({ username: s.login.username, pin: s.login.pin }));
  const SO = user({ username: other.login.username, pin: other.login.pin });
  const [a1, a2, a3, a4] = studs.map((s) => s.id);

  // ---------- letters ----------
  t('letterToIndex: B, b), (c) and index 2', choice.letterToIndex('B') === 1 && choice.letterToIndex('b)') === 1 && choice.letterToIndex('(c)') === 2 && choice.letterToIndex(2) === 2);
  t('letterToIndex: E, AB, empty, 5, null are never guessed', [choice.letterToIndex('E'), choice.letterToIndex('AB'), choice.letterToIndex(''), choice.letterToIndex(5), choice.letterToIndex(null), choice.letterToIndex(undefined)].every((v) => v === null));
  const pl = choice.parseLetters('BA-CB', 5);
  t('parseLetters: BA-CB, dash = blank', pl[1] === 1 && pl[2] === 0 && pl[3] === undefined && pl[4] === 2 && pl[5] === 1);
  t('parseLetters: spaces, commas and lower case are fine', JSON.stringify(choice.parseLetters('b, a  c', 3)) === '{"1":1,"2":0,"3":2}');
  t('parseLetters: too many letters gives 400', await throwsStatus(async () => choice.parseLetters('ABCDA', 4), 400));
  t('parseLetters: a letter that is not an option gives 400', await throwsStatus(async () => choice.parseLetters('ABZ', 5), 400));
  t('parseLetters: object form, empty = blank', JSON.stringify(choice.parseLetters({ 1: 'B', 2: '', 3: null, 4: 2 }, 4)) === '{"1":1,"4":2}');
  t('parseLetters: object with a bad value gives 400', await throwsStatus(async () => choice.parseLetters({ 1: 'Q' }, 4), 400));
  t('parseLetters: nothing at all gives 400', await throwsStatus(async () => choice.parseLetters(42, 4), 400));

  // ---------- create a paper test ----------
  t('other teacher cannot make a paper test in my class', await throwsStatus(() => choice.createPaperTest(T2, noAi, cls.id, { typedMcq: BLOCK }), 403));
  t('a paper test cannot be made from number sums', await throwsStatus(() => choice.createPaperTest(T, noAi, cls.id, { expressions: ['1/2+1/2'] }), 400));
  const pt = await choice.createPaperTest(T, noAi, cls.id, { title: 'Cells check', subject: 'Science', typedMcq: BLOCK });
  t('paper test from typed questions: draft, mode paper, 5 questions, tags counted', pt.status === 'draft' && pt.mode === 'paper' && pt.questions.length === 5 && pt.tagList.length === 2);
  const mixed = await choice.createPaperTest(T, { configured: () => true, quiz: async () => [{ type: 'calc', expression: '1/2+1/2' }, ...taggedAi] }, cls.id, { topic: 'cells', subject: 'Science' });
  t('AI draft: number-sum questions are left out (A to D only) and the teacher is told', mixed.questions.length === 3 && mixed.questions.every((q) => q.type === 'mcq') && /left out/.test(mixed.note || ''));
  t('AI draft with only number sums gives 422', await throwsStatus(() => choice.createPaperTest(T, { configured: () => true, quiz: async () => [{ type: 'calc', expression: '1/2+1/2' }, { type: 'calc', expression: '2*3' }] }, cls.id, { topic: 'fractions' }), 422));

  // ---------- nothing can be entered before the teacher publishes ----------
  t('typed sheet refused while the paper test is a draft', await throwsStatus(async () => choice.typedPaperSheet(T, pt.id, a1, 'BAAAB'), 400));
  t('photo sheet refused while the paper test is a draft (file not kept)', await (async () => { const f = { path: tmp('d.jpg'), mimetype: 'image/jpeg' }; const ok = await throwsStatus(() => choice.readPaperSheet(T, ai, pt.id, a1, f), 400); return ok; })());
  t('an online quiz is not a paper test', await (async () => { const oq = await x.createQuiz(T, noAi, cls.id, { title: 'Online', typedMcq: BLOCK }); return throwsStatus(async () => choice.typedPaperSheet(T, oq.id, a1, 'A'), 400); })());
  x.publishQuiz(T, pt.id);
  t('students see nothing yet: a paper test is hidden until their sheet is entered', S.every((s) => x.studentQuizzes(s).filter((q) => q.id === pt.id).length === 0));
  t('student cannot open a paper test before the sheet is entered', await throwsStatus(async () => x.getQuizForStudent(S[0], pt.id), 404));
  t('student cannot submit a paper test online', await throwsStatus(async () => x.submitQuiz(S[0], pt.id, { 1: 0 }), 404));

  // ---------- typed letters ----------
  const v1 = choice.typedPaperSheet(T, pt.id, a1, 'BAAAB');   // A1 picks the nucleus idea in Q1, Q3, Q4
  t('typed sheet is marked by code: 2 of 5', v1.score === 2 && v1.total === 5);
  t('A1 is LIKELY to hold "nucleus does every job" (same idea in 3 wrong answers)', v1.problem.kind === 'likely' && v1.problem.tags[0].name === N && v1.problem.tags[0].count === 3 && v1.problem.tags[0].level === 'likely');
  t('attempt view shows the key, the pick and the idea', v1.questions[0].correctIndex === 0 && v1.questions[0].yourIndex === 1 && v1.questions[0].yourTag === N && v1.questions[1].correct === true);
  t('typed sheet for a student outside the class gives 400', await throwsStatus(async () => choice.typedPaperSheet(T, pt.id, other.id, 'AABCB'), 400));
  t('typed sheet with no letters gives 400', await throwsStatus(async () => choice.typedPaperSheet(T, pt.id, a3, '---'), 400));
  t('other teacher cannot enter a sheet in my test', await throwsStatus(async () => choice.typedPaperSheet(T2, pt.id, a1, 'AABCB'), 403));
  t('other teacher cannot read a student\'s answers', await throwsStatus(async () => choice.attemptView(T2, pt.id, a1), 403));

  // ---------- what the student sees ----------
  const sl = x.studentQuizzes(S[0]).find((q) => q.id === pt.id);
  t('once entered, A1 sees it in the list labelled paper, with the score, not attemptable', sl && sl.paper === true && sl.attempted === true && sl.score === 2 && sl.canAttempt === false);
  const sv = x.getQuizForStudent(S[0], pt.id);
  t('A1 sees the problem and each answer with "Looks like"', sv.paper === true && sv.problem.kind === 'likely' && sv.questions[0].yourTag === N);
  t('A1 cannot submit it online (paper)', await throwsStatus(async () => x.submitQuiz(S[0], pt.id, { 1: 0 }), 400));
  t('A2 still sees nothing (their sheet is not entered)', x.studentQuizzes(S[1]).filter((q) => q.id === pt.id).length === 0 && await throwsStatus(async () => x.getQuizForStudent(S[1], pt.id), 404));
  t('student of another class cannot open it', await throwsStatus(async () => x.getQuizForStudent(SO, pt.id), 404));

  // ---------- retyping replaces the old attempt ----------
  const v1b = choice.typedPaperSheet(T, pt.id, a1, 'AABCB');
  t('retyped sheet replaces the older attempt: 5 of 5, still one row', v1b.score === 5 && db.all('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [pt.id, a1]).length === 1);
  t('no mistaken idea when all are right', v1b.problem.kind === 'none');
  choice.typedPaperSheet(T, pt.id, a1, 'BAAAB');          // back to the nucleus pattern for the group tests

  // ---------- photo sheet: two reads, disagreement = blank ----------
  reads = [{ 1: 'B', 2: 'A', 3: 'A', 4: 'A', 5: 'B' }, { 1: 'B', 2: 'C', 3: 'A', 4: 'UNCLEAR', 5: 'B' }];
  t('photo without AI gives 503 and the file is deleted', await (async () => { const f = { path: tmp('n.jpg'), mimetype: 'image/jpeg' }; const ok = await throwsStatus(() => choice.readPaperSheet(T, noAi, pt.id, a2, f), 503); return ok && !fs.existsSync(f.path); })());
  t('AI without a choice reader gives 503', await (async () => { const f = { path: tmp('n2.jpg'), mimetype: 'image/jpeg' }; const ok = await throwsStatus(() => choice.readPaperSheet(T, { configured: () => true }, pt.id, a2, f), 503); return ok && !fs.existsSync(f.path); })());
  t('no file gives 400', await throwsStatus(() => choice.readPaperSheet(T, ai, pt.id, a2, undefined), 400));
  t('AI error: the error is passed on and the file is deleted', await (async () => { const f = { path: tmp('e.jpg'), mimetype: 'image/jpeg' }; const bad = { configured: () => true, readChoiceSheetTwice: async () => { const e = new Error('x'); e.status = 503; throw e; } }; let ok = false; try { await choice.readPaperSheet(T, bad, pt.id, a2, f); } catch (e) { ok = e.status === 503; } return ok && !fs.existsSync(f.path); })());
  t('student outside the class gives 400 (photo)', await throwsStatus(() => choice.readPaperSheet(T, ai, pt.id, other.id, { path: tmp('o.jpg'), mimetype: 'image/jpeg' }), 400));
  const f2 = { path: tmp('a2.jpg'), mimetype: 'image/jpeg' };
  const d2 = await choice.readPaperSheet(T, ai, pt.id, a2, f2);
  t('draft: questions where both reads agree are pre-filled', d2.answers[0].agree && d2.answers[0].value === 1 && d2.answers[2].agree && d2.answers[4].agree);
  t('draft: a disagreement (A vs C) is left BLANK, not guessed', d2.answers[1].agree === false && d2.answers[1].value === null && d2.answers[1].readA === 'A' && d2.answers[1].readB === 'C');
  t('draft: UNCLEAR is left blank', d2.answers[3].agree === false && d2.answers[3].value === null);
  t('draft has no mark yet (nothing saved as an attempt)', !db.get('SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [pt.id, a2]));
  t('draft is readable by its teacher, not by another', (await choice.getPaperSheet(T, d2.sheetId)).status === 'draft' && await throwsStatus(async () => choice.getPaperSheet(T2, d2.sheetId), 403));
  t('sheet file: teacher gets it, other teacher gets 403', choice.paperSheetFile(T, d2.sheetId).mime === 'image/jpeg' && await throwsStatus(async () => choice.paperSheetFile(T2, d2.sheetId), 403));
  t('A2 still sees nothing while it is only a draft', x.studentQuizzes(S[1]).filter((q) => q.id === pt.id).length === 0);
  t('other teacher cannot confirm', await throwsStatus(async () => choice.confirmPaperSheet(T2, d2.sheetId, { 1: 'B' }), 403));
  const f2b = { path: tmp('a2b.jpg'), mimetype: 'image/jpeg' };
  await choice.readPaperSheet(T, ai, pt.id, a2, f2b);
  t('a second upload replaces the first draft and deletes the old file', !fs.existsSync(f2.path) && db.all('SELECT * FROM paper_sheets WHERE quiz_id = ? AND student_id = ?', [pt.id, a2]).length === 1);
  const sheetId = db.get('SELECT id FROM paper_sheets WHERE quiz_id = ? AND student_id = ?', [pt.id, a2]).id;
  const fin = choice.confirmPaperSheet(T, sheetId, { 1: 'B', 2: 'C', 3: 'A', 4: 'C', 5: 'B' });   // teacher fills Q2 = C and Q4 = C
  t('confirm marks by code: 2 of 5', fin.score === 2 && fin.total === 5);
  t('A2: nucleus idea LIKELY (2), protein/energy idea only SUSPECTED (1)', fin.problem.kind === 'likely' && fin.problem.tags.find((g) => g.name === N).level === 'likely' && fin.problem.tags.find((g) => g.name === R).level === 'suspected');
  t('sheet is now final and getPaperSheet shows the marked result', (await choice.getPaperSheet(T, sheetId)).status === 'final' && (await choice.getPaperSheet(T, sheetId)).score === 2);
  t('A2 now sees the paper test', x.studentQuizzes(S[1]).some((q) => q.id === pt.id && q.paper));
  // blank answers are never guessed
  const f3 = { path: tmp('a3.jpg'), mimetype: 'image/jpeg' };
  const d3 = await choice.readPaperSheet(T, ai, pt.id, a3, f3);
  const blankFin = choice.confirmPaperSheet(T, d3.sheetId, { 1: 'A' });
  t('blank answers count as wrong and "unclear", never as a guess', blankFin.score === 1 && blankFin.problem.kind === 'unclear' && blankFin.problem.unclearCount === 4 && blankFin.problem.tags.length === 0);
  t('student can see blank rows as no answer', x.getQuizForStudent(S[2], pt.id).questions[1].yourIndex === null);
  choice.typedPaperSheet(T, pt.id, a3, 'AABCB');         // A3 all right

  // ---------- participation, gaps, audience ----------
  const part = x.quizParticipation(T, pt.id);
  t('participation: 3 sheets entered, 1 missing (A4)', part.attemptedCount === 3 && part.absentCount === 1 && part.students.find((s) => s.name === 'A4').attempted === false);
  const gapN = part.gaps.find((g) => g.name === N), gapR = part.gaps.find((g) => g.name === R);
  t('gaps: nucleus idea LIKELY for A1 and A2; protein idea only SUSPECTED for A2', gapN && gapN.likely.map((g) => g.name).sort().join() === 'A1,A2' && gapR && gapR.likely.length === 0 && gapR.suspected.map((g) => g.name).join() === 'A2');
  t('listQuizzes shows the mode', x.listQuizzes(T, cls.id).find((q) => q.id === pt.id).mode === 'paper');

  // ---------- practice quiz for the group (draft, only likely students) ----------
  t('other teacher cannot send a practice quiz', await throwsStatus(() => choice.groupPracticeQuiz(T2, ai, pt.id, N), 403));
  t('unknown idea gives 404', await throwsStatus(() => choice.groupPracticeQuiz(T, ai, pt.id, 'Thinks the moon is made of cheese'), 404));
  t('nobody is LIKELY for the suspected idea: 400 and nothing is created', await (async () => { const before = db.all('SELECT id FROM quizzes').length; const ok = await throwsStatus(() => choice.groupPracticeQuiz(T, ai, pt.id, R), 400); return ok && db.all('SELECT id FROM quizzes').length === before; })());
  const pq = await choice.groupPracticeQuiz(T, ai, pt.id, N);
  t('practice quiz is a DRAFT, online, AI-drafted, 3 tagged questions', pq.status === 'draft' && pq.mode === 'online' && pq.source === 'ai' && pq.questions.length === 3 && quizCalls === 1);
  t('audience = the two LIKELY students only', pq.audience.map((s) => s.name).sort().join() === 'A1,A2' && pq.audienceCount === 2);
  t('draft is invisible to its own audience', await throwsStatus(async () => x.getQuizForStudent(S[0], pq.id), 404));
  t('the teacher\'s getQuiz lists the audience once it is a draft', (x.getQuiz(T, pq.id).audienceCount === 2));
  x.publishQuiz(T, pq.id);
  t('after publishing, A1 and A2 see it and can attempt it', [S[0], S[1]].every((s) => { const q = x.studentQuizzes(s).find((r) => r.id === pq.id); return q && q.forGroup && q.canAttempt; }));
  t('A3 and A4 do not see it, cannot open it, cannot submit it', [S[2], S[3]].every((s) => x.studentQuizzes(s).every((r) => r.id !== pq.id)) && await throwsStatus(async () => x.getQuizForStudent(S[2], pq.id), 404) && await throwsStatus(async () => x.submitQuiz(S[3], pq.id, { 1: 0 }), 404));
  t('student of another class cannot see it', await throwsStatus(async () => x.getQuizForStudent(SO, pq.id), 404));
  const taken = x.submitQuiz(S[0], pq.id, { 1: 0, 2: 1, 3: 0 });
  t('A1 attempts the practice quiz and is marked by code: 3 of 3', taken.attempted && taken.score === 3);
  const pp = x.quizParticipation(T, pq.id);
  t('practice participation counts only its audience (2 students, 1 not yet)', pp.students.length === 2 && pp.attemptedCount === 1 && pp.absentCount === 1);
  t('listQuizzes shows "for 2 students"', x.listQuizzes(T, cls.id).find((q) => q.id === pq.id).audienceCount === 2);
  // include suspected
  const withSus = await choice.groupPracticeQuiz(T, ai, pt.id, R, { includeSuspected: true });
  t('includeSuspected adds the suspected student', withSus.audience.map((s) => s.name).join() === 'A2');

  // ---------- no AI: the teacher's own questions, options shuffled, key and ideas kept aligned ----------
  const pn = await choice.groupPracticeQuiz(T, noAi, pt.id, N);
  t('no AI: reshuffled from the teacher\'s own questions that carry the idea (4 of 5), with a reason', pn.source === 'reshuffled' && pn.questions.length === 4 && /no|missing|key/i.test(pn.note || ''), pn.note);
  const orig = x.ownQuiz(T, pt.id).questions;
  const aligned = pn.questions.every((q) => {
    const o = orig.find((r) => r.text === q.text);
    return o && q.options[q.correct] === o.options[o.correct] && q.options.every((opt, i) => { const oi = o.options.indexOf(opt); return oi >= 0 && (q.tags ? q.tags[i] : null) === (o.tags ? o.tags[oi] : null); });
  });
  t('no AI: after shuffling, the right option and every idea tag still match their option', aligned);
  t('no AI: numbering restarts at 1', pn.questions.map((q) => q.number).join() === '1,2,3,4');
  let allOk = true;
  for (let i = 0; i < 200; i++) { const q = choice.shuffleQuestion(orig[0]); if (q.options[q.correct] !== 'Mitochondria' || q.tags[q.options.indexOf(`Nucleus`)] !== N || q.tags[q.correct] !== null || new Set(q.options).size !== 4) allOk = false; }
  t('shuffleQuestion keeps the key and the tags with their options (200 random shuffles)', allOk);
  t('shuffleQuestion with a fixed shuffle is repeatable', JSON.stringify(choice.shuffleQuestion(orig[0], () => 0)) === JSON.stringify(choice.shuffleQuestion(orig[0], () => 0)));
  const junk = await choice.groupPracticeQuiz(T, { configured: () => true, quiz: async () => [{ foo: 1 }] }, pt.id, N);
  t('AI returns junk: falls back to the reshuffled questions with a note', junk.source === 'reshuffled' && /usable/.test(junk.note));
  const quota = await choice.groupPracticeQuiz(T, { configured: () => true, quiz: async () => { const e = new Error('x'); e.reason = 'quota'; throw e; } }, pt.id, N);
  t('AI quota error: reshuffled with the real reason', quota.source === 'reshuffled' && /free limit/i.test(quota.note));

  // ---------- paper sheets do not count as activity ----------
  const prog = x.studentProgress(S[2]);   // A3 only has a paper sheet entered by the teacher
  t('a paper sheet does not give a streak, badge or quiz count', prog.streak.current === 0 && prog.badges.every((b) => !b.earned));
  const eng = x.engagement(T, cls.id);
  t('engagement ignores paper and group quizzes', eng.classQuizzes === 0 && eng.students.every((s) => s.quizzes === 0));

  // ---------- a student on a closed paper test; closing ----------
  x.closeQuiz(T, pt.id);
  t('closed paper test: entering more sheets gives 400', await throwsStatus(async () => choice.typedPaperSheet(T, pt.id, a4, 'AABCB'), 400));
  t('closed paper test: a student who already has a sheet still sees the result', x.getQuizForStudent(S[0], pt.id).attempted === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
