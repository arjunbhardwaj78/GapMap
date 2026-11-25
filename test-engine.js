// Tests the engine WITHOUT the AI: reads and rule suggestions are supplied by hand.
const v = require('./verify');
const e = require('./services/engine');
const p = require('./services/practice');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const questions = ['1/2+1/3', '2/5+1/5', '3/4+1/6', '5/6-1/3', '7/8-1/4', '2/3*3/4', '1/2*4/5'].map((x, i) => ({ id: 'Q' + (i + 1), expression: x }));
const ADD = { rule: '(n1+n3)/(n2+n4)', name: 'Adds tops and bottoms of fractions', explanation: 'Adds the numerators and the denominators separately.' };
const SUB = { rule: '(n1-n3)/(n2-n4)', name: 'Subtracts tops and bottoms of fractions', explanation: 'x' };
const FLIP = { rule: '(n1*n4)/(n2*n3)', name: 'Flips the second fraction when multiplying', explanation: 'x' };
const toRead = (arr) => Object.fromEntries(arr.map((f, i) => ['Q' + (i + 1), { final: f, legible: true }]));
const rulesFor = (map) => async (q) => map[q.id] || null;

(async () => {
  const s37a = ['2/5', '3/5', '2/5', '4/3', '3/2', '16/9', '5/8'];
  const r37 = await e.analyzeStudent({ questions, readA: toRead(s37a), readB: toRead(s37a),
    describeRule: rulesFor({ Q1: ADD, Q3: ADD, Q4: SUB, Q5: SUB, Q6: FLIP, Q7: FLIP }) });
  t('S37 marks', r37.marks === 1 && r37.total === 7, JSON.stringify([r37.marks, r37.total]));
  t('S37 Q6 flip rule not verified -> teacher review', r37.needsReview.includes(6));
  t('S37 Q6 label says unverified', r37.items[5].label === 'AI suggestion (unverified)', r37.items[5].label);
  t('S37 add rule is likely (2 questions)', r37.findings.some((f) => f.signature === ADD.rule && f.level === 'likely'));

  // wrong answer with no suggestion at all: honest label, never "AI suggestion"
  const none = await e.analyzeStudent({ questions, readA: toRead(['9', '3/5', '2/5', '1/2', '5/8', '1/2', '2/5']), readB: toRead(['9', '3/5', '2/5', '1/2', '5/8', '1/2', '2/5']), describeRule: async () => null });
  t('wrong answer with no suggestion is labelled "No pattern found"', none.items[0].label === 'No pattern found' && none.needsReview.includes(1), none.items[0].label);
  const failed = await e.analyzeStudent({ questions, readA: toRead(['9', '3/5', '2/5', '1/2', '5/8', '1/2', '2/5']), readB: toRead(['9', '3/5', '2/5', '1/2', '5/8', '1/2', '2/5']), describeRule: async () => ({ rule: '', aiFailed: 'AI over its limit' }) });
  t('AI failure is kept as a note on the answer', failed.items[0].aiNote === 'AI over its limit' && failed.items[0].label === 'No pattern found');

  // reads disagree -> needs review, never marked
  const a = ['2/5', '3/5', '2/5', '1/2', '5/8', '1/2', '2/5'], b = a.slice(); b[3] = '1/3';
  const rd = await e.analyzeStudent({ questions, readA: toRead(a), readB: toRead(b), describeRule: rulesFor({}) });
  t('differing reads -> needs_review', rd.items[3].status === 'needs_review' && rd.needsReview.includes(4));
  t('differing reads not counted as correct', rd.items[3].status !== 'correct');

  // equivalent forms agree between reads
  t('3/6 and 1/2 count as the same read', e.sameValue('3/6', '1/2'));
  t('UNCLEAR goes to review', (await e.analyzeStudent({ questions: [questions[0]], readA: toRead(['UNCLEAR']), readB: toRead(['UNCLEAR']), describeRule: null })).items[0].status === 'needs_review');

  // AI giving an unsafe rule
  const bad = await e.analyzeStudent({ questions: [questions[0]], readA: toRead(['2/5']), readB: toRead(['2/5']),
    describeRule: async () => ({ rule: 'evaluate("1+1")', name: 'Something odd here', explanation: '' }) });
  t('unsafe AI rule is not verified', bad.items[0].verified === false && bad.needsReview.includes(1));

  // class report
  const s1 = ['2/5', '3/10', '4/10', '1/2', '5/8', '1/2', '2/5'];
  const r1 = await e.analyzeStudent({ questions, readA: toRead(s1), readB: toRead(s1), describeRule: rulesFor({ Q1: ADD, Q2: ADD, Q3: ADD }) });
  const rep = e.buildClassReport([{ student: 'S1', result: r1 }, { student: 'S37', result: r37 }]);
  const g = rep.groups.find((x) => x.signature === ADD.rule);
  t('group has both students', g && g.count === 2, JSON.stringify(rep.groups));
  t('group name is plain language (no M1 code)', g && g.name === ADD.name && !/\bM\d/.test(g.name));
  t('rename overrides name', e.buildClassReport([{ student: 'S1', result: r1 }], { [ADD.rule]: 'Fraction adding mix-up' }).groups[0].name === 'Fraction adding mix-up');
  t('codes rejected as names', e.cleanName('M1') === null && e.cleanName('Adds tops and bottoms') !== null);

  // practice
  const prac = p.generatePractice({ rule: ADD.rule, sourceExpressions: ['1/2+1/3', '2/5+1/5'], count: 5, seed: 7 });
  t('5 practice questions made', prac.length === 5, String(prac.length));
  t('answers computed by code', prac.every((q) => v.checkAnswer(q.expression, q.answer).status === 'correct'));
  t('wrong rule gives a different answer on every question', prac.every((q) => !v.verifyRule(ADD.rule, e.numbersOf(q.expression), q.answer).verified));
  t('no duplicate questions', new Set(prac.map((q) => q.expression)).size === prac.length);
  const marked = p.markPractice(prac, Object.fromEntries(prac.map((q, i) => [q.number, i < 3 ? q.answer : '0/1'])));
  t('practice marking', marked.score === 3 && marked.total === 5, JSON.stringify(marked.score));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
