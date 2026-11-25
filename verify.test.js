const v = require("./verify");
let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got " + JSON.stringify(got) + " want " + JSON.stringify(want))); };

// ---- checking answers (by value, computed by code) ----
t("1/2+1/3 correct is 5/6", v.checkAnswer("1/2+1/3", "5/6"), { status: "correct", correct: "5/6" });
t("3/6 counts as 1/2", v.checkAnswer("5/6-1/3", "3/6").status, "correct");
t("2/5 is wrong", v.checkAnswer("1/2+1/3", "2/5"), { status: "wrong", correct: "5/6" });
t("UNCLEAR goes to review", v.checkAnswer("1/2+1/3", "UNCLEAR").status, "needs_review");
t("question with letters is unsupported", v.checkAnswer("x+2", "5").status, "unsupported");
t("decimal answer 0.5 equals 1/2", v.checkAnswer("2/3*3/4", "0.5").status, "correct");

// ---- verifying rules ----
t("add tops and bottoms verified", v.verifyRule("(n1+n3)/(n2+n4)", [1, 2, 1, 3], "2/5").verified, true);
t("a wrong rule is NOT verified", v.verifyRule("n1*n3/n2", [1, 2, 1, 3], "2/5").verified, false);
t("T2 common-denominator rule verified", v.verifyRule("((n1*n4)*(n3*n2))/(n2*n4)", [2, 3, 3, 4], "6").verified, true);
t("S37 flip rule verified on Q7", v.verifyRule("(n1*n4)/(n2*n3)", [1, 2, 4, 5], "5/8").verified, true);
t("S37 flip rule NOT verified on Q6 (student wrote 16/9)", v.verifyRule("(n1*n4)/(n2*n3)", [2, 3, 3, 4], "16/9").verified, false);
t("unsafe rule rejected: import", v.verifyRule('import("fs")', [1], "1").reason, "rule rejected (unsafe characters)");
t("unsafe rule rejected: evaluate", v.verifyRule('evaluate("1+1")', [1], "2").verified, false);
t("rule using a missing number is not verified", v.verifyRule("n9+1", [1, 2], "2").verified, false);
t("divide by zero is handled", v.verifyRule("n1/(n2-n2)", [1, 2], "1").verified, false);

// ---- whole pipeline on our real pilot sheets (rules as Gemini would describe them) ----
const ADD = "(n1+n3)/(n2+n4)", SUB = "(n1-n3)/(n2-n4)", CDM = "((n1*n4)*(n3*n2))/(n2*n4)", FLIP = "(n1*n4)/(n2*n3)";
const Q = [
  ["1/2+1/3", [1, 2, 1, 3]], ["2/5+1/5", [2, 5, 1, 5]], ["3/4+1/6", [3, 4, 1, 6]],
  ["5/6-1/3", [5, 6, 1, 3]], ["7/8-1/4", [7, 8, 1, 4]], ["2/3*3/4", [2, 3, 3, 4]], ["1/2*4/5", [1, 2, 4, 5]],
];
// each sheet: final answers + the rule the AI suggested for each wrong one
const sheets = {
  S1:  { a: ["2/5", "3/10", "4/10", "1/2", "5/8", "1/2", "2/5"], rules: { 1: ADD, 2: ADD, 3: ADD } },
  T2:  { a: ["2/5", "3/5", "2/5", "1/2", "5/8", "6", "4"],       rules: { 1: ADD, 3: ADD, 6: CDM, 7: CDM } },
  S37: { a: ["2/5", "3/5", "2/5", "4/3", "3/2", "16/9", "5/8"],  rules: { 1: ADD, 3: ADD, 4: SUB, 5: SUB, 6: FLIP, 7: FLIP } },
  S38: { a: ["5/6", "3/5", "11/12", "3/6", "5/8", "6/12", "4/10"], rules: {} },
};
const summaries = [];
for (const [id, s] of Object.entries(sheets)) {
  const items = Q.map(([expr, nums], i) => {
    const c = v.checkAnswer(expr, s.a[i]);
    const rule = s.rules[i + 1];
    const ver = c.status === "wrong" && rule ? v.verifyRule(rule, nums, s.a[i]) : { verified: false };
    return { q: i + 1, status: c.status, verified: ver.verified, ruleExpression: rule };
  });
  const sum = v.summarizeStudent(items);
  summaries.push({ student: id, findings: sum.findings });
  console.log(id, JSON.stringify(sum));
}
const groups = v.groupClass(summaries);
console.log("GROUPS", JSON.stringify(groups));
t("S38 has no findings and no review", summaries[3].findings.length, 0);
t("S37 Q6 goes to teacher review (unverified)", v.summarizeStudent([{ q: 6, status: "wrong", verified: false, ruleExpression: FLIP }]).needsReview, [6]);
t("class group for the add rule", groups.find((g) => g.signature === ADD).students, ["S1", "T2", "S37"]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
