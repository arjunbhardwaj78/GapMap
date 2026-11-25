// Milestone 7 tests: any subject, misconception-tagged multiple choice. No internet, fake AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const c = require('./services/concept');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const throwsStatus = async (fn, status) => { try { await fn(); return false; } catch (e) { return e.status === status; } };
const user = (u) => auth.userFromToken(auth.login(u.username, u.pin || 'pass1234').token);

const TYPED = `Which part of the cell makes energy?
*Mitochondria
Nucleus | Thinks the nucleus does every job
Ribosome | Mixes up making protein with making energy
Chloroplast | Thinks animal cells have chloroplasts

Where does photosynthesis happen?
*Chloroplast
Mitochondria | Mixes up making food with releasing energy
Nucleus | Thinks the nucleus does every job
Vacuole

What do plants take in for photosynthesis?
*Carbon dioxide
Oxygen | Thinks plants breathe like animals
Nitrogen
Hydrogen`;

let calls = 0;
const ai = {
  configured: () => true,
  quiz: async ({ subject, level }) => { calls++; ai.last = { subject, level }; return [
    { type: 'mcq', text: 'Which is the capital of France?', options: ['Paris', 'Lyon', 'Nice', 'Lille'], correct: 0, tags: ['SHOULD BE DROPPED', 'Thinks the biggest city is the capital', 'x', null] },
    { type: 'mcq', text: 'Which river flows through Paris?', options: ['Seine', 'Rhone', 'Loire', 'Garonne'], correct: 0, tags: [null, 'Thinks the biggest city is the capital', null, null] }]; },
  conceptLesson: async () => ({ steps: ['Step one.', 'Step two.'], tip: 'Remember this.' }),
};
const noAi = { configured: () => false };

(async () => {
  // ---- parseTyped ----
  const p = c.parseTyped(TYPED);
  t('parseTyped reads 3 questions', p.questions.length === 3 && p.problems.length === 0, JSON.stringify(p.problems));
  t('parseTyped finds the starred correct option', p.questions[0].correct === 0 && p.questions[1].correct === 0);
  t('parseTyped keeps tags after |', p.questions[0].tags[1] === 'Thinks the nucleus does every job' && p.questions[0].tags[0] === null);
  t('parseTyped rejects 2 stars, no star, wrong option count', (() => {
    const a = c.parseTyped('Q?\n*A\n*B\nC\nD'), b = c.parseTyped('Q?\nA\nB\nC\nD'), d = c.parseTyped('Q?\n*A\nB\nC');
    return a.questions.length === 0 && b.questions.length === 0 && d.questions.length === 0 && a.problems.length === 1 && b.problems.length === 1 && d.problems.length === 1;
  })());
  t('parseTyped handles Windows line endings and empty text', c.parseTyped(TYPED.replace(/\n/g, '\r\n')).questions.length === 3 && c.parseTyped('').questions.length === 0);

  // ---- cleanTags / tagKey ----
  t('tagKey ignores capitals and punctuation', c.tagKey('Thinks plants BREATHE, like animals!') === c.tagKey('thinks plants breathe like animals'));
  t('cleanTags forces null on the correct option and drops short tags', JSON.stringify(c.cleanTags(['bad tag', 'Mixed up idea', 'no', 'Another idea'], ['a', 'b', 'c', 'd'], 0)) === JSON.stringify([null, 'Mixed up idea', null, 'Another idea']));
  t('cleanTags returns null when nothing usable', c.cleanTags([null, '', 'x', null], ['a', 'b', 'c', 'd'], 0) === null && c.cleanTags('nope', ['a'], 0) === null);

  // ---- diagnose (pure code) ----
  const qs = x.cleanQuestions(p.questions, { allowMcq: true });
  t('cleanQuestions keeps tags and typed flag', qs.length === 3 && qs[0].typed === true && qs[0].tags[1] === 'Thinks the nucleus does every job');
  const likely = c.diagnose(qs, { 1: 1, 2: 2 });   // Nucleus (tag A) + Nucleus (tag A) on Q1 and Q2
  t('same tag on 2 questions = likely', likely.kind === 'likely' && likely.tags[0].level === 'likely' && likely.tags[0].count === 2, JSON.stringify(likely));
  const susp = c.diagnose(qs, { 1: 1, 2: 0, 3: 0 });
  t('one tagged wrong answer = suspected', susp.kind === 'suspected' && susp.tags[0].level === 'suspected' && susp.wrongCount === 1);
  const unclear = c.diagnose(qs, { 1: 0, 2: 3, 3: 3 });   // Vacuole (no tag), Hydrogen (no tag)
  t('wrong answers with no tag = unclear, never guessed', unclear.kind === 'unclear' && unclear.tags.length === 0 && unclear.unclearCount === 2);
  t('all right = none; blank = wrong but unclear', c.diagnose(qs, { 1: 0, 2: 0, 3: 0 }).kind === 'none' && c.diagnose(qs, {}).kind === 'unclear');
  t('different tags on different questions are NOT merged', c.diagnose(qs, { 1: 2, 3: 1 }).kind === 'suspected');

  // ---- end to end with typed questions, AI OFF ----
  auth.createUser({ username: 'tea1', password: 'pass1234', name: 'T1', role: 'teacher' });
  auth.createUser({ username: 'tea2', password: 'pass1234', name: 'T2', role: 'teacher' });
  const T = user({ username: 'tea1' }), T2 = user({ username: 'tea2' });
  const cls = core.createClass(T, 'Class A'), cls2 = core.createClass(T2, 'Class B');
  const studs = ['A1', 'A2', 'A3'].map((n, i) => core.addStudent(T, cls.id, { name: n, roll: String(i + 1) }));
  const other = core.addStudent(T2, cls2.id, { name: 'B1', roll: '1' });
  const S = studs.map((s) => user({ username: s.login.username, pin: s.login.pin }));
  const SO = user({ username: other.login.username, pin: other.login.pin });

  const q = await x.createQuiz(T, noAi, cls.id, { title: 'Cells', topic: 'Cells and photosynthesis', subject: 'Biology', typedMcq: TYPED });
  t('typed MCQ quiz works with the AI off, any subject', q.status === 'draft' && q.source === 'typed' && q.questions.length === 3 && q.subject === 'Biology');
  t('typed questions are not counted as AI-written keys', q.aiKeyCount === 0);
  t('draft shows the tag list for the teacher to check', q.tagList.length >= 3 && q.tagList[0].questions === 2, JSON.stringify(q.tagList));
  t('bad typed text gives a helpful 400', await throwsStatus(() => x.createQuiz(T, noAi, cls.id, { topic: 'x', typedMcq: 'Q?\nA\nB' }), 400));
  t('other teacher cannot use this class', await throwsStatus(() => x.createQuiz(T2, noAi, cls.id, { topic: 'Cells', typedMcq: TYPED }), 403));
  await x.publishQuiz(T, q.id);

  // students never see tags before or while attempting
  const view = x.getQuizForStudent(S[0], q.id);
  t('student view hides tags and key', view.questions.every((a) => !('tags' in a) && !('correct' in a) && !('correctIndex' in a)), JSON.stringify(view.questions[0]));
  t('student of another class cannot open it', await throwsStatus(() => x.getQuizForStudent(SO, q.id), 404));

  const r0 = x.submitQuiz(S[0], q.id, { 1: 1, 2: 2, 3: 0 });   // Nucleus x2 -> likely
  const r1 = x.submitQuiz(S[1], q.id, { 1: 1, 2: 0, 3: 0 });   // one Nucleus -> suspected
  x.submitQuiz(S[2], q.id, { 1: 0, 2: 0, 3: 0 });
  t('student result has a problem card: likely', r0.problem.kind === 'likely' && r0.problem.tags[0].name === 'Thinks the nucleus does every job', JSON.stringify(r0.problem));
  t('wrong answer shows its tag after attempt only', r0.questions[0].yourTag === 'Thinks the nucleus does every job' && r0.questions[2].yourTag === null);
  t('second student is only suspected', r1.problem.kind === 'suspected');

  const part = x.quizParticipation(T, q.id);
  const g = part.gaps.find((a) => a.name === 'Thinks the nucleus does every job');
  t('teacher sees class pattern: 1 likely + 1 suspected', g && g.likely.length === 1 && g.suspected.length === 1 && g.likely[0].name === 'A1', JSON.stringify(part.gaps));
  t('correct student is in no gap', !part.gaps.some((a) => [...a.likely, ...a.suspected].some((s) => s.name === 'A3')));

  // ---- concept help (AI explanation, cached, labelled) ----
  const h = await x.conceptHelp(S[0], ai, q.id, 'thinks the NUCLEUS does every job');
  t('help returns an AI explanation with a warning label', h.lesson && h.lesson.steps.length === 2 && /cannot check facts/.test(h.note), JSON.stringify(h));
  t('help for a tag the student did not show is refused', await throwsStatus(() => x.conceptHelp(S[0], ai, q.id, 'Thinks plants breathe like animals'), 400));
  t('help before attempting is refused', await throwsStatus(() => x.conceptHelp(S[2], ai, q.id, 'Thinks the nucleus does every job'), 400));
  const hOff = await x.conceptHelp(S[1], noAi, q.id, 'Thinks the nucleus does every job');
  t('help reuses the cached lesson when the AI is off', hOff.lesson && hOff.lesson.steps.length === 2);

  // ---- AI drafted quiz for another subject ----
  const q2 = await x.createQuiz(T, ai, cls.id, { topic: 'Capitals of Europe', subject: 'Geography', level: 'Class 8', count: 2 });
  t('AI quiz gets subject and level', ai.last.subject === 'Geography' && ai.last.level === 'Class 8' && q2.source === 'ai');
  t('AI tag on the correct option is dropped', q2.questions[0].tags[0] === null && q2.questions[0].tags[1] === 'Thinks the biggest city is the capital');
  t('AI-written keys are counted so the teacher is warned', q2.aiKeyCount === 2);
  t('same wording across questions is one tag used twice', q2.tagList.length === 1 && q2.tagList[0].questions === 2, JSON.stringify(q2.tagList));

  // ---- AI off + subject outside the built-in bank ----
  t('AI off + unknown subject topic explains how to type questions', await throwsStatus(() => x.createQuiz(T, noAi, cls.id, { topic: 'Mughal empire', subject: 'History' }), 422));
  t('student own quiz stays number-only for other subjects', await throwsStatus(() => x.selfQuiz(S[0], noAi, { topic: 'Mughal empire' }), 422));
  t('built-in maths bank still works with the AI off', (await x.createQuiz(T, noAi, cls.id, { topic: 'adding fractions' })).source === 'builtin');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
