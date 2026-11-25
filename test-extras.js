// Milestone 5 tests: quizzes, homework, interview, study help, badges, CSV. No internet, fake AI.
process.env.DATABASE_PATH = ':memory:';
const fs = require('fs'), os = require('os'), path = require('path');
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const throwsStatus = async (fn, status) => { try { await fn(); return false; } catch (e) { return e.status === status; } };
const user = (u) => auth.userFromToken(auth.login(u.username, u.pin || 'pass1234').token);

const goodFeedback = { audible: true, summary: 'Clear start.', rubric: { clarity: { score: 4, reason: 'ok' }, relevance: { score: 9, reason: 'ok' }, structure: { score: 3, reason: 'ok' }, confidence: { score: 3, reason: 'ok' }, vocabulary: { score: 3, reason: 'ok' } }, strengths: ['Good start'], improve: ['Slow down'], fillers: ['um'], tryThis: 'My name is...', secret: 'DROP ME' };
let interviewCalls = 0;
const ai = {
  configured: () => true,
  quiz: async ({ allowMcq }) => [
    { type: 'calc', expression: '3/4+1/8', answer: 'WRONG-FROM-AI' }, { type: 'calc', expression: 'x+1' }, { type: 'calc', expression: '3/4+1/8' },
    { type: 'calc', expression: '2/3*3/4' }, { type: 'mcq', text: 'What is the top number of a fraction called?', options: ['Numerator', 'Denominator', 'Factor', 'Product'], correct: 0 },
    { type: 'mcq', text: 'Bad one', options: ['a', 'a', 'b', 'c'], correct: 1 },
  ],
  lesson: async () => ({ steps: ['Find a common denominator.', 'Add the tops.'], tip: 'Keep the bottom.' }),
  interview: async () => { interviewCalls++; return goodFeedback; },
  readSheetTwice: async (f, m, qs) => [Object.fromEntries(qs.map((q, i) => [q.id, { final: i === 0 ? '5/6' : '1' }])), Object.fromEntries(qs.map((q, i) => [q.id, { final: i === 0 ? '5/6' : '2' }]))],
  describeRule: async () => null,
};
const noAi = { configured: () => false };

(async () => {
  auth.createUser({ username: 'tea1', password: 'pass1234', name: 'T1', role: 'teacher' });
  const T = user({ username: 'tea1' });
  auth.createUser({ username: 'tea2', password: 'pass1234', name: 'T2', role: 'teacher' });
  const T2 = user({ username: 'tea2' });
  const cls = core.createClass(T, 'Class A');
  const cls2 = core.createClass(T2, 'Class B');
  const studs = ['A1', 'A2', 'A3'].map((n, i) => core.addStudent(T, cls.id, { name: n, roll: String(i + 1) }));
  const other = core.addStudent(T2, cls2.id, { name: 'B1', roll: '1' });
  const S = studs.map((s) => user({ username: s.login.username, pin: s.login.pin }));
  const SO = user({ username: other.login.username, pin: other.login.pin });

  // ---- cleanQuestions ----
  const cq = x.cleanQuestions([{ type: 'calc', expression: '3/4+1/8', answer: '9' }, { type: 'calc', expression: 'x+1' }, { type: 'calc', expression: '3/4+1/8' }, { type: 'mcq', text: 'Is this allowed here?', options: ['a', 'b', 'c', 'd'], correct: 0 }], { allowMcq: false });
  t('cleanQuestions: letters, duplicates and MCQ dropped when not allowed', cq.length === 1);
  t('cleanQuestions: answer computed by code, AI answer ignored', cq[0].answer === '7/8', cq[0].answer);
  t('cleanQuestions: long expression dropped', x.cleanQuestions([{ type: 'calc', expression: '1+'.repeat(30) + '1' }]).length === 0);

  // ---- teacher quiz ----
  let q = await x.createQuiz(T, ai, cls.id, { topic: 'fractions', count: 5 });
  t('AI quiz is a draft with 3 valid questions (2 calc + 1 mcq)', q.status === 'draft' && q.questions.length === 3, JSON.stringify(q.questions.map((a) => a.type)));
  t('calc answer key came from code', q.questions[0].answer === '7/8');
  t('AI-key count reported', q.aiKeyCount === 1);
  t('quiz without topic or questions rejected', await throwsStatus(() => x.createQuiz(T, ai, cls.id, {}), 400));
  // AI off: falls back to the built-in bank, with a clear reason (no more bare "AI not available")
  const off = await x.createQuiz(T, noAi, cls.id, { topic: 'adding fractions', count: 6 });
  t('AI off -> built-in bank quiz with reason', off.source === 'builtin' && off.questions.length >= 4 && /key is missing/i.test(off.note) && off.aiKeyCount === 0);
  t('built-in answers are computed by code', off.questions.filter((q) => q.type === 'calc').every((q) => /^\d+(\/\d+)?$/.test(q.answer)));
  const failAi = { configured: () => true, quiz: async () => { const e = new Error('x'); e.reason = 'quota'; throw e; } };
  const q2 = await x.createQuiz(T, failAi, cls.id, { topic: 'integers', count: 4 });
  t('AI quota error -> bank + quota reason', q2.source === 'builtin' && /free limit/i.test(q2.note));
  t('unknown topic with AI off -> 422 listing topics', await throwsStatus(() => x.createQuiz(T, noAi, cls.id, { topic: 'poetry' }), 422));
  t('AI quiz still labelled ai', (await x.createQuiz(T, ai, cls.id, { topic: 'fractions' })).source === 'ai');
  const typed = await x.createQuiz(T, noAi, cls.id, { title: 'Typed', expressions: ['1/2+1/2', 'abc', '2*3'] });
  t('typed quiz works with AI off and skips bad lines', typed.questions.length === 2);
  t('draft is invisible to students', (x.studentQuizzes(S[0]).length === 0) && await throwsStatus(() => x.getQuizForStudent(S[0], q.id), 404));
  t('other teacher cannot open my quiz', await throwsStatus(() => x.getQuiz(T2, q.id), 403));
  t('other teacher cannot publish my quiz', await throwsStatus(() => x.publishQuiz(T2, q.id), 403));
  q = x.removeQuizQuestion(T, q.id, 3);
  t('remove question renumbers', q.questions.length === 2 && q.questions[1].number === 2);
  q = x.publishQuiz(T, q.id);
  t('publish works', q.status === 'published');
  t('published quiz cannot be edited', await throwsStatus(() => x.removeQuizQuestion(T, q.id, 1), 400));
  t('students in the class see it, other class does not', x.studentQuizzes(S[0]).length === 1 && x.studentQuizzes(SO).length === 0);
  const view = x.getQuizForStudent(S[0], q.id);
  t('student view hides answers before attempt', view.questions.every((a) => a.answer === undefined && a.correct === undefined));
  t('other class student cannot open it', await throwsStatus(() => x.getQuizForStudent(SO, q.id), 404));
  const done = x.submitQuiz(S[0], q.id, { 1: '7/8', 2: '1/2' });
  t('score is marked by code and answers revealed', done.score === 2 && done.questions[0].answer === '7/8');
  t('one attempt only', await throwsStatus(() => x.submitQuiz(S[0], q.id, { 1: '7/8' }), 409));
  x.submitQuiz(S[1], q.id, { 1: '1', 2: '' });
  const part = x.quizParticipation(T, q.id);
  t('participation: 2 attempted, 1 absent', part.attemptedCount === 2 && part.absentCount === 1 && part.students.filter((s) => !s.attempted)[0].name === 'A3');
  t('participation: per-question stats', part.perQuestion[0].correct === 1 && part.perQuestion[0].attempted === 2);
  x.closeQuiz(T, q.id);
  t('closed quiz refuses new attempts', await throwsStatus(() => x.submitQuiz(S[2], q.id, { 1: '7/8' }), 400));

  // ---- MCQ answers ----
  let m = await x.createQuiz(T, ai, cls.id, { topic: 'fractions' });
  m = x.publishQuiz(T, m.id);
  const mcqNo = m.questions.find((a) => a.type === 'mcq').number;
  const r = x.submitQuiz(S[2], m.id, { [mcqNo]: 0 });
  t('MCQ marked against the key', r.questions.find((a) => a.number === mcqNo).correct === true);

  // ---- self quiz ----
  const sq = await x.selfQuiz(S[0], ai, { topic: 'adding fractions' });
  const sv = x.getQuizForStudent(S[0], sq.id);
  t('self quiz has no MCQ and is private', sv.self && sv.questions.every((a) => a.type === 'calc') && x.studentQuizzes(S[1]).every((a) => a.id !== sq.id));
  t('other student cannot open my self quiz', await throwsStatus(() => x.getQuizForStudent(S[1], sq.id), 404));
  t('teacher quiz list excludes self quizzes', x.listQuizzes(T, cls.id).every((a) => a.id !== sq.id));
  for (let i = 0; i < x.MAX_SELF_QUIZZES_PER_DAY - 1; i++) await x.selfQuiz(S[0], ai, { topic: 'fractions' });
  const sqOff = await x.selfQuiz(S[1], noAi, { topic: 'subtracting fractions' });
  t('student self quiz works with AI off (built-in bank)', sqOff.source === 'builtin' && /key is missing/i.test(sqOff.note) && Boolean(sqOff.id));
  t('self quiz limit per day', await throwsStatus(() => x.selfQuiz(S[0], ai, { topic: 'fractions' }), 429));
  t('self quiz needs topic when no gap', await throwsStatus(() => x.selfQuiz(S[1], ai, {}), 400));

  // ---- homework ----
  const hw = core.createAssessment(T, cls.id, { title: 'HW 1', expressions: ['1/2+1/3', '1/2+1/2'], kind: 'homework', due: '2000-01-01' });
  t('bad due date rejected', await throwsStatus(() => core.createAssessment(T, cls.id, { title: 'x', expressions: ['1+1'], kind: 'homework', due: 'tomorrow' }), 400));
  let list = x.listHomework(S[0]);
  t('student sees homework, overdue flagged', list.length === 1 && list[0].overdue === true && x.listHomework(SO).length === 0);
  t('other class cannot open homework', await throwsStatus(() => x.homeworkDetail(SO, hw.id), 404));
  t('tests (not homework) are not listed as homework', await throwsStatus(() => x.homeworkDetail(S[0], core.createAssessment(T, cls.id, { title: 'Test', expressions: ['1+1'] }).id), 404));
  const typedRes = await x.homeworkTyped(S[0], noAi, hw.id, { Q1: '5/6', Q2: '2' });
  t('typed homework marked by code', typedRes.marks === 1 && typedRes.total === 2, JSON.stringify(typedRes.marks));
  t('cannot hand in twice', await throwsStatus(() => x.homeworkTyped(S[0], noAi, hw.id, { Q1: '5/6' }), 409));
  t('teacher sees it in the report', core.getReport(T, hw.id).students.find((s) => s.name === 'A1').marks === 1);
  t('student results list includes homework', core.studentHome(S[0]).results.some((a) => a.title === 'HW 1'));
  const tmp = path.join(os.tmpdir(), 'hw-' + Date.now() + '.png'); fs.writeFileSync(tmp, 'x');
  const draft = await x.homeworkPhoto(S[1], ai, hw.id, { path: tmp, mimetype: 'image/png' });
  t('photo draft: agreed read locked, disagreeing read blank', draft.answers[0].agree && draft.answers[0].value === '5/6' && !draft.answers[1].agree && draft.answers[1].value === '', JSON.stringify(draft.answers));
  t('other student cannot confirm my draft', await throwsStatus(() => x.homeworkConfirm(S[2], ai, draft.submissionId, {}), 404));
  const conf = await x.homeworkConfirm(S[1], ai, draft.submissionId, { Q1: '999', Q2: '1' });
  t('typed value ignored on agreed question; typed value used on disagreeing one', conf.items[0].yourAnswer === '5/6' && conf.items[1].yourAnswer === '1', JSON.stringify(conf.items.map((i) => i.yourAnswer)));
  const blank = await x.homeworkPhoto(S[2], ai, hw.id, { path: tmp, mimetype: 'image/png' });
  const cb = await x.homeworkConfirm(S[2], ai, blank.submissionId, {});
  t('blank disagreeing answer stays "needs teacher review"', cb.reviewCount === 1 && cb.items[1].status !== 'correct', JSON.stringify(cb.items[1]));
  t('photo needs AI', await throwsStatus(() => x.homeworkPhoto(S[2], noAi, core.createAssessment(T, cls.id, { title: 'HW 2', expressions: ['1+1'], kind: 'homework' }).id, { path: tmp, mimetype: 'image/png' }), 503));
  fs.rmSync(tmp, { force: true });

  // ---- interview ----
  const au = path.join(os.tmpdir(), 'rec-' + Date.now() + '.wav');
  const mk = () => { fs.writeFileSync(au, 'RIFF'); return { path: au, mimetype: 'audio/wav' }; };
  const gone = () => new Promise((res) => setTimeout(() => res(!fs.existsSync(au)), 50));
  t('interview needs consent', await throwsStatus(() => x.submitInterview(S[0], ai, { question: 'Tell me about yourself.' }, mk()), 400) && interviewCalls === 0);
  t('audio deleted after refused request', await gone());
  const iv = await x.submitInterview(S[0], ai, { question: 'Tell me about yourself.', consent: 'true' }, mk());
  t('feedback saved, scores clamped 1-5, unknown fields dropped', iv.feedback.rubric.relevance.score === 5 && iv.feedback.secret === undefined && iv.shared === false);
  t('audio deleted after analysis', await gone());
  t('AI off -> 503 and file deleted', await throwsStatus(() => x.submitInterview(S[0], noAi, { question: 'Tell me about yourself.', consent: 'true' }, mk()), 503) && await gone());
  const badAi = { ...ai, interview: async () => ({ audible: false }) };
  t('inaudible -> 422', await throwsStatus(() => x.submitInterview(S[0], badAi, { question: 'Tell me about yourself.', consent: 'true' }, mk()), 422));
  // ---- interview: video mode (camera snapshots) ----
  const frameFiles = [];
  const mkFrames = (n) => Array.from({ length: n }, (_, i) => { const f = path.join(os.tmpdir(), `frame-${Date.now()}-${i}.jpg`); fs.writeFileSync(f, 'JPEG'); frameFiles.push(f); return { path: f, mimetype: 'image/jpeg' }; });
  const framesGone = () => new Promise((res) => setTimeout(() => res(frameFiles.every((f) => !fs.existsSync(f))), 50));
  let seenFrames = -1;
  const vAi = { ...ai, interview: async (f, m, q, frames) => { seenFrames = frames.length; return { ...goodFeedback, bodyVisible: true, body: { eyeContact: { score: 9, reason: 'Looked at the camera most of the time.' }, expression: { score: 3, reason: 'Smiled at the start.' }, posture: { score: 4, reason: 'Sat upright.' }, hair: { score: 1, reason: 'secret' } } }; } };
  t('video mode without pictures -> 400', await throwsStatus(() => x.submitInterview(S[0], vAi, { question: 'Tell me about yourself.', consent: 'true', mode: 'video' }, mk(), mkFrames(1)), 400) && await gone() && await framesGone());
  const vv = await x.submitInterview(S[0], vAi, { question: 'Tell me about yourself.', consent: 'true', mode: 'video' }, mk(), mkFrames(5));
  t('video mode sends the pictures to the AI', seenFrames === 5);
  t('body feedback kept, clamped, unknown fields dropped', vv.feedback.body.eyeContact.score === 5 && vv.feedback.body.hair === undefined && vv.feedback.mode === 'video');
  t('audio and every picture deleted after video analysis', await gone() && await framesGone());
  seenFrames = -1;
  const vo = await x.submitInterview(S[0], vAi, { question: 'Tell me about yourself.', consent: 'true', mode: 'voice' }, mk(), mkFrames(5));
  t('voice mode never sends pictures even if some arrive', seenFrames === 0 && vo.feedback.mode === 'voice' && await framesGone());
  const hidden = { ...ai, interview: async () => ({ ...goodFeedback, bodyVisible: false }) };
  const vh = await x.submitInterview(S[0], hidden, { question: 'Tell me about yourself.', consent: 'true', mode: 'video' }, mk(), mkFrames(4));
  t('face not visible -> no body scores, friendly note', !vh.feedback.body && /could not see you clearly/i.test(vh.feedback.bodyNote));
  const errAi = { ...ai, interview: async () => { const e = new Error('x'); e.reason = 'quota'; throw e; } };
  t('AI error shows the real reason (502)', await throwsStatus(() => x.submitInterview(S[0], errAi, { question: 'Tell me about yourself.', consent: 'true', mode: 'video' }, mk(), mkFrames(4)), 502) && await framesGone());
  const oddAi = { ...ai, interview: async () => ({ weird: true }) };
  t('unreadable AI reply -> 502 (not "could not hear")', await throwsStatus(() => x.submitInterview(S[0], oddAi, { question: 'Tell me about yourself.', consent: 'true' }, mk()), 502));
  const listAi = { ...ai, interview: async () => [goodFeedback] };
  t('AI reply wrapped in a list is accepted', (await x.submitInterview(S[0], listAi, { question: 'Tell me about yourself.', consent: 'true' }, mk())).feedback.summary.length > 0);
  const noSum = { ...ai, interview: async () => ({ ...goodFeedback, summary: undefined }) };
  t('missing summary falls back to a strength', (await x.submitInterview(S[0], noSum, { question: 'Tell me about yourself.', consent: 'true' }, mk())).feedback.summary.length > 0);
  t('teacher sees nothing until the student shares', x.classInterviews(T, cls.id).length === 0);
  x.shareInterview(S[0], iv.id, true);
  t('after share the teacher sees it', x.classInterviews(T, cls.id).length === 1);
  t('another student cannot share mine', await throwsStatus(() => x.shareInterview(S[1], iv.id, false), 404));
  t('other teacher cannot see shared interviews', await throwsStatus(() => x.classInterviews(T2, cls.id), 403));

  // ---- study help, sheets (needs a student with a likely gap) ----
  const asm = core.createAssessment(T, cls.id, { title: 'Fractions', expressions: core.PRESETS[0].expressions });
  await core.manualSubmission(T, noAi, asm.id, studs[0].id, Object.fromEntries(['2/5', '3/10', '4/10', '1/2', '5/8', '1/2', '2/5'].map((a, k) => ['Q' + (k + 1), a])));
  const home = core.studentHome(S[0]);
  const gap = home.gaps[0];
  t('student portal says what the problem is (likely pattern with a plain name)', home.results[0].problem.kind === 'likely' && home.results[0].likely[0].name.length > 3 && home.results[0].problem.wrongCount >= 2);
  t('wrong answers carry the pattern name when verified', home.results[0].items.filter((i) => i.status === 'wrong' && i.pattern).length >= 2);
  await core.manualSubmission(T, noAi, asm.id, studs[2].id, Object.fromEntries(['1/2+1/3', '', '', '', '', '', ''].map((_, k) => ['Q' + (k + 1), k === 0 ? '99' : core.PRESETS[0].expressions[k] ? String(eval(core.PRESETS[0].expressions[k].replace(/(\d+)\/(\d+)/g, '($1/$2)'))) : '1'])));
  const h1 = core.studentHome(S[2]).results[0];
  t('wrong answer with no known pattern is NOT called nice work (kind unclear)', h1.problem.kind === 'unclear' && h1.problem.wrongCount >= 1 && h1.items.find((i) => i.status === 'wrong').pattern === null);
  t('student has a likely gap', Boolean(gap));
  const sh = await x.studyHelp(S[0], ai, gap.assessmentId, gap.signature);
  t('study help: mini lesson with code-computed answer', sh.lesson && sh.lesson.steps.length === 2 && /^\d+(\/\d+)?$/.test(sh.lesson.answer), JSON.stringify(sh.lesson));
  t('study help: no TinyFish key -> honest empty list', sh.resources.resources.length === 0);
  t('study help refused for someone with no gap', await throwsStatus(() => x.studyHelp(S[1], ai, gap.assessmentId, gap.signature), 404));
  const ss = x.studentSheet(S[0], gap.assessmentId, gap.signature);
  t('student printable sheet has questions and a code key', ss.questions.length >= 3 && ss.answerKey.length === ss.questions.length);
  const ts = x.teacherSheet(T, asm.id, gap.signature);
  t('teacher printable sheet works', ts.questions.length >= 3);
  t('other teacher cannot make a sheet', await throwsStatus(() => x.teacherSheet(T2, asm.id, gap.signature), 403));

  // ---- badges / streak / engagement ----
  const pr = x.studentProgress(S[0]);
  t('streak counts today and badges earned', pr.streak.current >= 1 && pr.badges.find((b) => b.key === 'speaker').earned && pr.badges.find((b) => b.key === 'homework').earned);
  t('streak logic: gap breaks it', x.streakOf([{ t: '2020-01-01 10:00:00' }]).current === 0);
  t('IST date conversion', x.istDate('2026-10-10 20:00:00') === '2026-10-11');
  const eg = x.engagement(T, cls.id);
  t('engagement lists every student', eg.students.length === 3 && eg.classHomework >= 1);
  t('other teacher cannot see engagement', await throwsStatus(() => x.engagement(T2, cls.id), 403));

  // ---- CSV ----
  t('CSV neutralises formulas', x.csvCell('=1+1') === "'=1+1" && x.csvCell('+1') === "'+1" && x.csvCell('-2') === "'-2" && x.csvCell('@a') === "'@a");
  t('CSV quotes commas and quotes', x.csvCell('a,"b"') === '"a,""b"""');
  const csv = x.assessmentCsv(T, asm.id);
  t('results CSV has header and one row per student', csv.text.split('\r\n').filter(Boolean).length === 4 && csv.text.includes('Marks'));
  t('engagement CSV works', x.engagementCsv(T, cls.id).text.includes('Streak'));
  t('other teacher cannot export', await throwsStatus(() => x.assessmentCsv(T2, asm.id), 403));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
