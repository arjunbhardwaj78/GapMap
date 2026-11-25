// Practice questions: same structure as the group's questions, new random numbers.
// Answers are computed by code (verify.js). The AI never writes an answer key.
const v = require('../verify');
const { numbersOf } = require('./engine');

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Replace every fraction a/b with a new PROPER fraction (denominator 2-9, numerator smaller than it).
// Any other number becomes 1-9.
function randomise(expression, rnd) {
  return expression
    .replace(/\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/g, () => {
      const d = 2 + Math.floor(rnd() * 8);
      const n = 1 + Math.floor(rnd() * (d - 1));
      return `${n}/${d}`;
    })
    .replace(/(?<![\d./])\d+(?:\.\d+)?(?![\d./])/g, () => String(1 + Math.floor(rnd() * 9)));
}

const pretty = (e) => e.replace(/^-/, '\u2212').replace(/\(-/g, '(\u2212').replace(/\*/g, ' \u00d7 ').replace(/\+/g, ' + ').replace(/-/g, ' \u2212 ').replace(/\s+/g, ' ').trim();

// rule: the group's verified rule. sourceExpressions: questions this group got wrong. Returns up to `count` items.
function generatePractice({ rule, sourceExpressions, count = 5, seed = Date.now(), avoid = [] }) {
  const rnd = mulberry32(seed);
  const seen = new Set(avoid);
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < 400 && sourceExpressions.length) {
    const base = sourceExpressions[out.length % sourceExpressions.length];
    const expr = randomise(base, rnd);
    if (seen.has(expr)) continue;
    const check = v.checkAnswer(expr, '0');          // gives the correct answer, computed by code
    if (!check.correct) continue;
    // Keep only questions where the wrong rule gives a DIFFERENT answer, so practice can tell them apart.
    const probe = v.verifyRule(rule, numbersOf(expr), check.correct);
    if (probe.verified || !String(probe.reason).startsWith('rule gives')) continue;
    seen.add(expr);
    out.push({ number: out.length + 1, instruction: 'Evaluate', expression: expr, prompt: pretty(expr), answer: check.correct });
  }
  return out;
}

// Marks a student's practice attempt in code. answers: {1:"3/4", ...}
function markPractice(questions, answers) {
  const results = questions.map((q) => {
    const c = v.checkAnswer(q.expression, answers[q.number] ?? '');
    return { number: q.number, correct: c.status === 'correct', needsReview: c.status === 'needs_review', answer: q.answer };
  });
  return { results, score: results.filter((r) => r.correct).length, total: results.length };
}

module.exports = { generatePractice, markPractice, randomise, pretty };
