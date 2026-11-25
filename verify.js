// GapMap core: checks answers and VERIFIES error rules with code (no AI decides marks).
// Needs:  npm install mathjs
const { create, all } = require("mathjs");
const math = create(all, { number: "Fraction" }); // exact fractions: 3/6 equals 1/2

const QUESTION_OK = /^[0-9.\s+\-*\/^()]+$/;          // a question expression: digits and + - * / ^ ( )
const RULE_OK = /^(?:[0-9.\s+\-*\/^()]|n\d+)+$/;     // a rule: the same, plus n1, n2, n3...

// Turn text like "2/5", "6" or "0.4" into an exact fraction. Returns null if it cannot.
function toFraction(text) {
  try {
    const t = String(text).replace(/\s+/g, "");
    if (!t || t.toUpperCase() === "UNCLEAR") return null;
    return math.fraction(t);
  } catch (e) {
    return null;
  }
}
const show = (f) => f.toFraction(); // "5/6" or "6"

// The correct answer, computed by code from the question expression.
function computeCorrect(expression) {
  if (typeof expression !== "string" || expression.length > 80 || !QUESTION_OK.test(expression)) return null;
  try {
    return math.fraction(math.evaluate(expression));
  } catch (e) {
    return null;
  }
}

// status: correct | wrong | needs_review (answer unreadable) | unsupported (no usable question)
function checkAnswer(expression, studentFinal) {
  const correct = computeCorrect(expression);
  if (!correct) return { status: "unsupported", correct: null };
  const given = toFraction(studentFinal);
  if (!given) return { status: "needs_review", correct: show(correct) };
  return { status: math.equal(given, correct) ? "correct" : "wrong", correct: show(correct) };
}

// Does the rule the AI described reproduce the student's wrong answer?
function verifyRule(ruleExpression, numbers, studentFinal) {
  if (typeof ruleExpression !== "string" || ruleExpression.length > 80) return { verified: false, reason: "no rule given" };
  if (!RULE_OK.test(ruleExpression)) return { verified: false, reason: "rule rejected (unsafe characters)" };
  const given = toFraction(studentFinal);
  if (!given) return { verified: false, reason: "student answer unreadable" };
  try {
    const scope = {};
    (numbers || []).forEach((v, i) => { scope["n" + (i + 1)] = math.fraction(v); });
    const result = math.fraction(math.evaluate(ruleExpression, scope));
    if (math.equal(result, given)) return { verified: true, reason: "rule reproduces the student's answer" };
    return { verified: false, reason: "rule gives " + show(result) + ", student wrote " + show(given) };
  } catch (e) {
    return { verified: false, reason: "rule could not be evaluated" };
  }
}

const signature = (rule) => String(rule).replace(/\s+/g, ""); // same rule = same signature

// One student. items: [{ q, status, verified, ruleExpression }]
// 2+ questions with the same VERIFIED rule = "likely"; 1 = "suspected".
function summarizeStudent(items) {
  const bySig = {};
  const needsReview = [];
  items.forEach((it) => {
    if (it.status === "needs_review" || it.status === "unsupported") needsReview.push(it.q);
    else if (it.status === "wrong") {
      if (it.verified) (bySig[signature(it.ruleExpression)] = bySig[signature(it.ruleExpression)] || []).push(it.q);
      else needsReview.push(it.q);
    }
  });
  const findings = Object.entries(bySig).map(([sig, qs]) => ({
    signature: sig, questions: qs, level: qs.length >= 2 ? "likely" : "suspected", evidenceCount: qs.length,
  }));
  return { findings, needsReview: needsReview.sort((a, b) => a - b) };
}

// Class groups: students who have a LIKELY finding with the same signature.
function groupClass(studentSummaries) { // [{ student, findings }]
  const groups = {};
  studentSummaries.forEach((s) => s.findings.forEach((f) => {
    if (f.level === "likely") (groups[f.signature] = groups[f.signature] || []).push(s.student);
  }));
  return Object.entries(groups).map(([signature, students]) => ({ signature, students }));
}

module.exports = { toFraction, computeCorrect, checkAnswer, verifyRule, signature, summarizeStudent, groupClass };
