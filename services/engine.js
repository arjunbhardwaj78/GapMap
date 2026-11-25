// GapMap engine: read twice -> check in code -> verify the AI's rule in code -> group.
// The AI never decides marks. "Verified" means "consistent with", not "proves".
const fs = require('fs');
const v = require('../verify');
const gemini = require('./gemini');

// Numbers of a question in order of appearance: "1/2+1/3" -> [1,2,1,3] (these are n1..n4)
const numbersOf = (expression) => (String(expression).match(/\d+(?:\.\d+)?/g) || []).map(Number);

// Plain-language names only. Reject codes like "M1" and empty or long text.
function cleanName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (s.length < 4 || s.length > 70 || /\bM\d+\b/i.test(s)) return null;
  return s;
}

// ---------- Gemini calls (only these two touch the AI) ----------
function sheetPart(filePath, mimeType) {
  return { inline_data: { mime_type: mimeType, data: fs.readFileSync(filePath).toString('base64') } };
}

// One read of the sheet. Returns { Q1: { final: "2/5", legible: true }, ... }
async function readSheetOnce(filePath, mimeType, questions, variant) {
  const list = questions.map((q) => `${q.id}: ${q.expression}`).join('\n');
  const order = variant === 0 ? 'top to bottom' : 'one question at a time, starting from the last question';
  const prompt = `This is a student's handwritten maths answer sheet. Read it ${order}.
Questions:
${list}
For each question give the student's FINAL answer exactly as written (for example "2/5" or "6"), not the correct answer.
If a final answer is blank or you cannot read it, use "UNCLEAR" and legible=false.
Do not output any name or roll number from the sheet.
Return only JSON: {"answers":{"Q1":{"final":"...","legible":true}}}`;
  const out = await gemini.generateJson([{ text: prompt }, sheetPart(filePath, mimeType)], variant === 0 ? 0.1 : 0.3);
  const answers = {};
  for (const q of questions) {
    const a = (out.answers || {})[q.id] || {};
    answers[q.id] = { final: String(a.final ?? 'UNCLEAR').trim() || 'UNCLEAR', legible: a.legible !== false };
  }
  return answers;
}

// One after the other (not both at once) so a free-tier per-minute limit is not hit by a burst.
async function readSheetTwice(filePath, mimeType, questions) {
  const a = await readSheetOnce(filePath, mimeType, questions, 0);
  const b = await readSheetOnce(filePath, mimeType, questions, 1);
  return [a, b];
}

// For ONE wrong answer: ask the AI which rule the student seemed to follow, as a formula in n1, n2...
async function describeRuleWithAI(filePath, mimeType, q, studentFinal) {
  const nums = numbersOf(q.expression);
  const prompt = `A student answered the question "${q.expression}" with "${studentFinal}". The correct answer is different.
The question numbers are: ${nums.map((n, i) => `n${i + 1}=${n}`).join(', ')}.
Look at the sheet if it helps. Describe the rule the student seemed to follow as a formula using only n1, n2, ... digits, + - * / ^ and brackets (under 80 characters),
and give a short plain-language name a teacher would understand (no codes, no jargon), for example "Adds tops and bottoms of fractions", plus one plain sentence explaining it.
Return only JSON: {"rule":"(n1+n3)/(n2+n4)","name":"...","explanation":"..."}`;
  const out = await gemini.generateJson([{ text: prompt }, sheetPart(filePath, mimeType)], 0.1);
  return { rule: String(out.rule || ''), name: cleanName(out.name), explanation: String(out.explanation || '').slice(0, 300) };
}


// Known common slips, tested by CODE against the student's actual answer. Used only when the AI gives no verified rule.
// A match means "consistent with this pattern", not proof.
const LIBRARY = [
  { op: '+', rule: '(n1+n3)/(n2+n4)', name: 'Adds tops and bottoms of fractions', explanation: 'Adds the numerators and the denominators separately instead of finding a common denominator.' },
  { op: '-', rule: '(n1-n3)/(n2-n4)', name: 'Subtracts tops and bottoms of fractions', explanation: 'Subtracts the numerators and the denominators separately.' },
  { op: '+', rule: '(n1+n3)/n2', name: 'Adds the tops and keeps the first bottom', explanation: 'Adds the numerators but copies the first denominator without a common denominator.' },
  { op: '-', rule: '(n1-n3)/n2', name: 'Subtracts the tops and keeps the first bottom', explanation: 'Subtracts the numerators but copies the first denominator.' },
  { op: '*', rule: '(n1*n4)/(n2*n3)', name: 'Flips the second fraction when multiplying', explanation: 'Turns the second fraction upside down, as if dividing, when the sign says multiply.' },
  { op: '*', rule: '(n1*n3)/(n2+n4)', name: 'Multiplies the tops but adds the bottoms', explanation: 'Multiplies the numerators but adds the denominators.' },
  { op: '+', rule: '(n1+n3)/(n2*n4)', name: 'Adds the tops but multiplies the bottoms', explanation: 'Adds the numerators but multiplies the denominators.' },
  // Whole numbers with negatives (two numbers: n1, n2; the minus signs are not part of n1, n2)
  { op: 'neg', rule: 'n1-n2', name: 'Ignores the minus sign inside brackets', explanation: 'Treats subtracting a negative number as if it were subtracting a positive one.' },
  { op: 'pos', rule: '-(n1+n2)', name: 'Adds the numbers and keeps a minus sign', explanation: 'Adds the two numbers and writes a minus, instead of finding the difference.' },
];
// Which kind of question is this? '+', '-', '*' for two fractions, 'neg' for a-(-b), 'pos' for -a+b, else null.
function questionKind(expression) {
  const e = String(expression).replace(/\s+/g, '');
  if (/^-\d+\+\d+$/.test(e)) return 'pos';
  if (/^\d+-\(-\d+\)$/.test(e)) return 'neg';
  const m = e.match(/^\d+\/\d+([+\-*])\d+\/\d+$/);
  return m ? m[1] : null;
}
// A library slip is used only if it belongs to this kind of question AND exactly one slip reproduces the answer.
// If two slips give the same answer the label would be a guess, so we return null (the AI path or the teacher decides).
function findLibraryRule(q, studentFinal) {
  const kind = questionKind(q.expression);
  if (!kind) return null;
  const hits = LIBRARY.filter((r) => r.op === kind && v.verifyRule(r.rule, numbersOf(q.expression), studentFinal).verified);
  return hits.length === 1 ? { ...hits[0] } : null;
}

// Text-only helpers. They get a pattern NAME and EXPLANATION (and the code-computed answer), never student data.
async function teachingTipsWithAI(name, explanation) {
  const prompt = `You help a Class 6-8 maths teacher in India. A group of students share this mistake pattern.
Pattern: ${name}
What happens: ${explanation}
Give 3 short classroom activities to fix it (each under 25 words, plain English) and one quick question to ask the class.
Return only JSON: {"activities":["...","...","..."],"checkQuestion":"..."}`;
  const out = await gemini.generateJson([{ text: prompt }], 0.4);
  const clip = (x, n) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, n);
  return { activities: (Array.isArray(out.activities) ? out.activities : []).slice(0, 4).map((x) => clip(x, 200)).filter(Boolean), checkQuestion: clip(out.checkQuestion, 200) };
}
async function hintWithAI({ name, explanation, expression, correct }) {
  const prompt = `A Class 6-8 student got this question wrong: ${expression}
The correct answer is ${correct} (already computed by a calculator; do not change it).
Their common slip: ${name}. ${explanation}
In at most 3 short sentences, explain how to reach ${correct}. Use only numbers from the question. Plain English.
Return only JSON: {"hint":"..."}`;
  const out = await gemini.generateJson([{ text: prompt }], 0.2);
  return String(out.hint || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

// ---------- Pure logic (testable without the AI) ----------
const sameValue = (a, b) => {
  const fa = v.toFraction(a), fb = v.toFraction(b);
  if (fa && fb) return fa.toFraction() === fb.toFraction(); // works for negatives too
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
};

// questions: [{id, expression}], readA/readB: {Q1:{final}}, describeRule: async (q, final) => {rule,name,explanation} | null
async function analyzeStudent({ questions, readA, readB, describeRule }) {
  const items = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = readA[q.id]?.final ?? 'UNCLEAR';
    const b = readB[q.id]?.final ?? 'UNCLEAR';
    const base = { q: i + 1, id: q.id, expression: q.expression, verified: false };

    if (!sameValue(a, b)) {
      items.push({ ...base, status: 'needs_review', studentAnswer: a, reason: `The two reads differ ("${a}" and "${b}")` });
      continue;
    }
    const check = v.checkAnswer(q.expression, a);
    const item = { ...base, status: check.status, studentAnswer: a, correct: check.correct };
    if (check.status === 'wrong' && describeRule) {
      let suggestion = null;
      try { suggestion = await describeRule(q, a); } catch (e) { suggestion = null; }
      if (suggestion && suggestion.aiFailed) item.aiNote = suggestion.aiFailed; // the AI could not be asked (limit, key, network)
      if (suggestion && suggestion.rule) {
        const ver = v.verifyRule(suggestion.rule, numbersOf(q.expression), a);
        Object.assign(item, {
          ruleExpression: suggestion.rule, ruleName: suggestion.name, explanation: suggestion.explanation,
          verified: ver.verified, reason: ver.reason,
        });
      }
    }
    item.label = item.status === 'correct' ? 'Correct'
      : item.status === 'wrong' ? (item.verified ? 'Verified' : item.ruleName ? 'AI suggestion (unverified)' : 'No pattern found')
      : 'Needs teacher review';
    items.push(item);
  }
  const summary = v.summarizeStudent(items);
  const marks = items.filter((x) => x.status === 'correct').length;
  return { items, marks, total: items.length, ...summary };
}

// students: [{ student, result }] -> groups with plain names (never the formula as the headline)
function buildClassReport(students, renames = {}) {
  const nameBySig = {};
  students.forEach((s) => s.result.items.forEach((it) => {
    if (it.verified && it.ruleName && !nameBySig[v.signature(it.ruleExpression)]) nameBySig[v.signature(it.ruleExpression)] = it.ruleName;
  }));
  const groups = v.groupClass(students.map((s) => ({ student: s.student, findings: s.result.findings })))
    .map((g) => ({ ...g, name: renames[g.signature] || nameBySig[g.signature] || 'Unnamed pattern (please rename)', count: g.students.length }));
  const suspected = students.flatMap((s) => s.result.findings.filter((f) => f.level === 'suspected').map((f) => ({
    student: s.student, signature: f.signature, name: renames[f.signature] || nameBySig[f.signature] || 'Unnamed pattern', questions: f.questions })));
  const review = students.filter((s) => s.result.needsReview.length).map((s) => ({ student: s.student, questions: s.result.needsReview }));
  return { groups, suspected, review };
}

module.exports = { teachingTipsWithAI, hintWithAI, LIBRARY, findLibraryRule, numbersOf, cleanName, readSheetTwice, describeRuleWithAI, sameValue, analyzeStudent, buildClassReport };
