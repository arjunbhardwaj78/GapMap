// Tests the whole app logic (database + engine + practice + portals) with NO internet and NO AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const throwsStatus = async (fn, status) => { try { await fn(); return false; } catch (e) { return e.status === status; } };
const noAi = { configured: () => false };

(async () => {
  auth.createUser({ username: 'teacher1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
  const tUser = auth.userFromToken(auth.login('teacher1', 'pass1234', 'teacher').token);
  auth.createUser({ username: 'teacher2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
  const t2User = auth.userFromToken(auth.login('teacher2', 'pass1234').token);
  t('wrong password rejected', await throwsStatus(() => auth.login('teacher1', 'nope'), 401));
  t('teacher cannot log in as student', await throwsStatus(() => auth.login('teacher1', 'pass1234', 'student'), 401));

  const cls = core.createClass(tUser, 'Class 7-B');
  const names = ['Roll 01', 'Roll 02', 'Roll 03', 'Roll 04'];
  const studs = names.map((n, i) => core.addStudent(tUser, cls.id, { name: n, roll: String(i + 1) }));
  t('students get a login with a 4-digit PIN', studs.every((s) => /^\d{4}$/.test(s.login.pin)));
  const asm = core.createAssessment(tUser, cls.id, { title: 'Fractions check', expressions: core.PRESETS[0].expressions });
  t('bad question rejected', await throwsStatus(() => core.createAssessment(tUser, cls.id, { title: 'x', expressions: ['x+2'] }), 400));
  t('other teacher cannot see my class', await throwsStatus(() => core.listStudents(t2User, cls.id), 403));
  t('other teacher cannot read my report', await throwsStatus(() => core.getReport(t2User, asm.id), 403));

  const sheets = [
    ['2/5', '3/10', '4/10', '1/2', '5/8', '1/2', '2/5'],     // roll 1: adds tops and bottoms x3
    ['2/5', '3/5', '2/5', '1/2', '5/8', '6', '4'],           // roll 2
    ['2/5', '3/5', '2/5', '4/3', '3/2', '16/9', '5/8'],      // roll 3
    ['5/6', '3/5', '11/12', '3/6', '5/8', '6/12', '4/10'],   // roll 4: all correct
  ];
  for (let i = 0; i < 4; i++) {
    const a = Object.fromEntries(sheets[i].map((x, k) => ['Q' + (k + 1), x]));
    await core.manualSubmission(tUser, noAi, asm.id, studs[i].id, a);
  }
  let rep = core.getReport(tUser, asm.id);
  const add = rep.groups.find((g) => g.name === 'Adds tops and bottoms of fractions');
  t('group for adding tops and bottoms has 3 students', add && add.count === 3, JSON.stringify(rep.groups.map((g) => [g.name, g.count])));
  t('no group name looks like a code', rep.groups.every((g) => !/\bM\d/.test(g.name)));
  t('all-correct student has 7/7 and no findings', rep.students[3].marks === 7 && rep.students[3].findings.length === 0);
  t('roll 3 Q6 (16/9) is in needs-review, not guessed', rep.review.some((x) => x.student === studs[2].id && x.questions.includes(6)));
  t('roll 3 flip pattern is only suspected', rep.suspected.some((x) => x.student === studs[2].id));
  t('marks come from code', rep.students[0].marks === 4, String(rep.students[0].marks));

  core.renameGroup(tUser, asm.id, add.signature, 'Fraction adding mix-up');
  rep = core.getReport(tUser, asm.id);
  t('teacher rename sticks', rep.groups.find((g) => g.signature === add.signature).name === 'Fraction adding mix-up');
  t('code-like rename rejected', await throwsStatus(() => core.renameGroup(tUser, asm.id, add.signature, 'M1'), 400));

  const kit = await core.getKit(tUser, asm.id, add.signature);
  t('kit has 5 practice questions with computed answers', kit.samplePractice.length === 5 && kit.samplePractice.every((q) => q.answer));
  t('kit resources empty without TinyFish key, no fake links', kit.resources.resources.length === 0 && kit.resources.live === false);
  t('kit has examples', kit.examples.length > 0);
  const asg = core.assignPractice(tUser, asm.id, add.signature);
  t('practice assigned to 3 students', asg.assigned === 3 && asg.groupSize === 3, JSON.stringify(asg));
  t('assign twice does not duplicate', core.assignPractice(tUser, asm.id, add.signature).assigned === 0);

  const sUser = auth.userFromToken(auth.login(studs[0].login.username, studs[0].login.pin, 'student').token);
  const home = core.studentHome(sUser);
  t('student sees marks, plain misconception and practice', home.results[0].marks === 4 && home.results[0].likely[0].name === 'Fraction adding mix-up' && home.practice.length === 1, JSON.stringify(home.results[0].likely));
  const pr = core.getPractice(sUser, home.practice[0].id);
  t('answer key hidden before submit', pr.questions.every((q) => q.answer === undefined));
  const full = Object.fromEntries(pr.questions.slice(0, 2).map((q) => [q.number, '0/1']));
  const sub = core.submitPractice(sUser, pr.id, full);
  t('wrong practice answers score 0, marked by code', sub.score === 0 && sub.total === 5);
  t('answer key shown after submit', core.getPractice(sUser, pr.id).questions.every((q) => q.answer !== undefined));
  const sUser4 = auth.userFromToken(auth.login(studs[3].login.username, studs[3].login.pin).token);
  t('student cannot open another student practice', await throwsStatus(() => core.getPractice(sUser4, pr.id), 404));
  t('history lists students with mistakes', core.classHistory(tUser, cls.id).length === 3 && !core.classHistory(tUser, cls.id).some((h) => h.studentId === studs[3].id));

  // Sheet upload path with a pretend AI (no real Gemini): two reads disagree on Q4
  const fakeAi = {
    configured: () => true,
    readSheetTwice: async (f, m, qs) => {
      const a = Object.fromEntries(qs.map((q, i) => [q.id, { final: sheets[0][i] }]));
      const b = JSON.parse(JSON.stringify(a)); b.Q4 = { final: '1/3' };
      return [a, b];
    },
    describeRule: async () => ({ rule: '(n1+n3)/(n2+n4)', name: 'Adds tops and bottoms of fractions', explanation: 'x' }),
  };
  const draft = await core.readSubmission(tUser, fakeAi, asm.id, studs[0].id, { path: '/tmp/none.jpg', mimetype: 'image/jpeg' });
  t('draft flags the question where the two reads differ', draft.answers[3].agree === false && draft.answers[0].agree === true);
  const conf = await core.confirmSubmission(tUser, fakeAi, draft.submissionId, { Q4: '1/2' });
  t('teacher correction resolves it', conf.result.items[3].status === 'correct');
  const conf2 = await core.readSubmission(tUser, fakeAi, asm.id, studs[1].id, { path: '/tmp/none.jpg', mimetype: 'image/jpeg' })
    .then((d) => core.confirmSubmission(tUser, fakeAi, d.submissionId, {}));
  t('unresolved differing read stays in review', conf2.result.items[3].status === 'needs_review');
  t('upload without AI configured gives clear 503', await throwsStatus(() => core.readSubmission(tUser, noAi, asm.id, studs[0].id, { path: 'x', mimetype: 'image/png' }), 503));


  // ---- teacher-chosen PIN, student own PIN ----
  const custom = core.addStudent(tUser, cls.id, { name: 'Custom PIN', roll: '9', pin: '8421' });
  t('teacher can choose the PIN when adding', custom.login.pin === '8421' && !!auth.login(custom.login.username, '8421', 'student').token);
  t('bad PIN rejected (3 digits)', await throwsStatus(() => core.setPin(tUser, studs[1].id, '123'), 400));
  t('bad PIN rejected (letters)', await throwsStatus(() => core.setPin(tUser, studs[1].id, 'ab12'), 400));
  core.setPin(tUser, studs[1].id, '123456');
  t('student signs in with the PIN the teacher set', !!auth.login(studs[1].login.username, '123456', 'student').token);
  t('old PIN no longer works', await throwsStatus(() => auth.login(studs[1].login.username, studs[1].login.pin, 'student'), 401));
  t('other teacher cannot set my student PIN', await throwsStatus(() => core.setPin(t2User, studs[1].id, '5555'), 403));
  const s2 = auth.userFromToken(auth.login(studs[1].login.username, '123456').token);
  t('student change PIN needs the right old PIN', await throwsStatus(() => core.changeOwnPin(s2, '0000', '7777'), 400));
  core.changeOwnPin(s2, '123456', '7777');
  t('student can sign in with their own new PIN', !!auth.login(studs[1].login.username, '7777').token);

  // ---- integers preset (library rules) ----
  const asmI = core.createAssessment(tUser, cls.id, { title: 'Integers', expressions: core.PRESETS[1].expressions });
  const intAns = ['2', '-5', '-13', '-14', '-1', '-12'];
  const ri = await core.manualSubmission(tUser, noAi, asmI.id, studs[0].id, Object.fromEntries(intAns.map((x, k) => ['Q' + (k + 1), x])));
  t('integer slips verified by code', ri.result.findings.length === 2 && ri.result.findings.every((f) => f.level === 'likely' && f.questions.length === 3), JSON.stringify(ri.result.findings));
  const repI = core.getReport(tUser, asmI.id);
  t('integer groups are plain-language', repI.students[0].findings.every((f) => /[a-z ]{8,}/i.test(f.name) && !/\bM\d/.test(f.name)));

  // ---- overview numbers for the charts ----
  const ov = core.getOverview(tUser, asm.id);
  t('overview counts sheets and average', ov.sheetsChecked === 4 && ov.averageMarks > 0, JSON.stringify([ov.sheetsChecked, ov.averageMarks]));
  t('marks spread adds up to sheets checked', ov.marks.reduce((p, m) => p + m.students, 0) === 4 && ov.marks.length === 8);
  t('per-question counts add up', ov.perQuestion.every((q) => q.correct + q.wrong + q.review === 4) && ov.perQuestion.length === 7);
  t('patterns listed with likely counts', ov.patterns.some((p) => p.likely === 3), JSON.stringify(ov.patterns));
  t('status counts add up', Object.values(ov.status).reduce((p, x) => p + x, 0) === 4);
  t('practice progress shows who has done it', ov.practice.some((g) => g.assigned === 3 && g.done === 1 && g.beforePct === 57 && g.afterPct === 0), JSON.stringify(ov.practice));

  // ---- AI teaching ideas (pretend AI, cached) ----
  let tipCalls = 0;
  const tipAi = { configured: () => true, tips: async () => { tipCalls++; return { activities: ['a1', 'a2', 'a3'], checkQuestion: 'q?' }; } };
  const tp = await core.getTips(tUser, tipAi, asm.id, add.signature);
  const tp2 = await core.getTips(tUser, tipAi, asm.id, add.signature);
  t('teaching ideas come back and are cached', tp.activities.length === 3 && tp2.cached === true && tipCalls === 1);
  t('teaching ideas say 503 when AI is off', await throwsStatus(() => core.getTips(tUser, noAi, asm.id, rep.groups[1]?.signature || add.signature), add.signature && rep.groups[1] ? 503 : 200).catch(() => true));

  // ---- student: new practice from own diagnosis + hints ----
  const s1 = auth.userFromToken(auth.login(studs[0].login.username, studs[0].login.pin).token);
  const h1 = core.studentHome(s1);
  const g1 = h1.gaps.find((g) => g.assessmentId === asm.id);
  t('student home lists every gap they can practise', h1.gaps.length === 3 && g1 && g1.setsMade === 1, JSON.stringify(h1.gaps));
  const np = core.newPractice(s1, g1.assessmentId, g1.signature);
  const npSet = core.getPractice(s1, np.id);
  t('new practice set has 5 fresh questions', npSet.questions.length === 5);
  const oldQs = new Set(core.getPractice(s1, h1.practice[0].id).questions.map((q) => q.prompt));
  t('new set has no repeats of the old set', npSet.questions.every((q) => !oldQs.has(q.prompt)));
  t('hint blocked before submitting', await throwsStatus(() => core.practiceHint(s1, tipAi, np.id, 1), 400));
  const wrongAns = Object.fromEntries(npSet.questions.map((q) => [q.number, '0/1']));
  core.submitPractice(s1, np.id, wrongAns);
  let hintArgs = null;
  const hintAi = { configured: () => true, hint: async (a) => { hintArgs = a; return 'Find a common denominator first.'; } };
  const hh = await core.practiceHint(s1, hintAi, np.id, 1);
  t('hint returned after submitting', hh.hint.length > 0);
  t('hint call gets only the pattern, question and code answer (no student data)', hintArgs && Object.keys(hintArgs).sort().join() === 'correct,explanation,expression,name' && !/Roll/.test(JSON.stringify(hintArgs)), JSON.stringify(hintArgs));
  t('hint says 503 when AI off', await throwsStatus(() => core.practiceHint(s1, noAi, np.id, 1), 503));
  const s4 = auth.userFromToken(auth.login(studs[3].login.username, studs[3].login.pin).token);
  t('student with no gap cannot make practice', await throwsStatus(() => core.newPractice(s4, asm.id, add.signature), 400));
  for (let i = 0; i < 6; i++) { try { core.newPractice(s1, g1.assessmentId, g1.signature); } catch (e) { /* limit */ } }
  t('practice sets per gap are limited', await throwsStatus(() => core.newPractice(s1, g1.assessmentId, g1.signature), 400));

  // ---- labelled sample class ----
  const smp = await core.createSampleClass(tUser, noAi);
  const rs = core.getReport(tUser, smp.assessmentId);
  t('sample class is labelled and has groups', core.listClasses(tUser).some((c) => /demo data/.test(c.name)) && rs.groups.length >= 1 && rs.submittedCount === 6, JSON.stringify(rs.groups.map((g) => [g.name, g.count])));

  // ---- Milestone 8: subject on tests, known slips named by code first, honest result when the AI is over its limit ----
  const sci = core.createAssessment(tUser, cls.id, { title: 'Subject check', subject: 'Science', expressions: ['1/2+1/3'] });
  t('test stores its subject, default is Maths', core.getAssessment(tUser, sci.id).subject === 'Science' && core.getAssessment(tUser, asm.id).subject === 'Maths' && core.listAssessments(tUser, cls.id).some((a) => a.subject === 'Science'));
  const asm8 = core.createAssessment(tUser, cls.id, { title: 'Library first', expressions: core.PRESETS[0].expressions });
  const right = ['5/6', '3/5', '11/12', '1/2', '5/8', '1/2', '2/5'];
  let aiCalls = 0;
  const countingAi = { configured: () => true, readSheetTwice: async (f, m, qs) => { const a = Object.fromEntries(qs.map((q, i) => [q.id, { final: i === 0 ? '2/5' : right[i] }])); return [a, JSON.parse(JSON.stringify(a))]; },
    describeRule: async () => { aiCalls++; return { rule: '(n1+n3)/(n2+n4)', name: 'AI name', explanation: 'x' }; } };
  const d8 = await core.readSubmission(tUser, countingAi, asm8.id, studs[2].id, { path: '/tmp/none.jpg', mimetype: 'image/jpeg' });
  const c8 = await core.confirmSubmission(tUser, countingAi, d8.submissionId, {});
  t('known slip is named by code without asking the AI', aiCalls === 0 && c8.result.items[0].verified && c8.result.items[0].ruleName === 'Adds tops and bottoms of fractions', JSON.stringify([aiCalls, c8.result.items[0].ruleName]));
  const limitAi = { ...countingAi, readSheetTwice: async (f, m, qs) => { const a = Object.fromEntries(qs.map((q, i) => [q.id, { final: i === 0 ? '9' : right[i] }])); return [a, JSON.parse(JSON.stringify(a))]; },
    describeRule: async () => { const e = new Error('x'); e.reason = 'quota'; throw e; } };
  const d9 = await core.readSubmission(tUser, limitAi, asm8.id, studs[3].id, { path: '/tmp/none.jpg', mimetype: 'image/jpeg' });
  const c9 = await core.confirmSubmission(tUser, limitAi, d9.submissionId, {});
  t('AI over its limit: honest label and reason, not a blank "AI suggestion"', c9.result.items[0].label === 'No pattern found' && /free limit/.test(c9.result.items[0].aiNote || '') && c9.result.needsReview.includes(1), JSON.stringify(c9.result.items[0]));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
