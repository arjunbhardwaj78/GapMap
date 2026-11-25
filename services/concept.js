// Milestone 7: any subject, any topic.
// A concept question is a multiple-choice question where every WRONG option names the mistaken idea behind it
// ("Thinks plants breathe in oxygen only"). The key and the tags are written by the teacher, or drafted by the AI and
// reviewed by the teacher before publishing. After that CODE does the counting:
//   - a wrong answer is marked by code against the key;
//   - a student has a "likely" gap when 2+ wrong answers carry the same tag, "suspected" when only 1 does;
//   - a wrong answer whose option has no tag is "unclear" (never guessed).
// "Likely" means "consistent with these answers", not proof. The evidence is only as good as the teacher-checked tags.
const clip = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);

// Same idea written twice with different capitals / punctuation counts as one tag.
const tagKey = (t) => String(t == null ? '' : t).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

// Tags for one question. Always an array of 4 (or null when the question has none): null at the correct option.
function cleanTags(rawTags, options, correct) {
  if (!Array.isArray(rawTags) || !Array.isArray(options)) return null;
  const tags = options.map((_, i) => {
    if (i === correct) return null;
    const t = clip(rawTags[i], 90);
    return t.length >= 3 && tagKey(t) ? t : null;
  });
  return tags.some(Boolean) ? tags : null;
}

// Teacher-typed questions. Blocks are separated by a blank line:
//   Which part of the cell makes energy?
//   *Mitochondria
//   Nucleus | Thinks the nucleus does everything
//   Ribosome | Mixes up making protein with making energy
//   Chloroplast
// Line 1 = question. Next 4 lines = options. Put * in front of the correct one. After "|" write the mistaken idea (optional).
function parseTyped(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  const out = [], problems = [];
  blocks.forEach((lines, n) => {
    if (lines.length !== 5) { problems.push(`Question ${n + 1}: write the question on line 1 and exactly 4 options under it (found ${lines.length - 1}).`); return; }
    const options = [], tags = [];
    let correct = -1;
    lines.slice(1).forEach((l, i) => {
      let star = false;
      if (l.startsWith('*')) { star = true; l = l.slice(1).trim(); }
      const [opt, ...rest] = l.split('|');
      options.push(opt.trim()); tags.push(rest.join('|').trim() || null);
      if (star) { if (correct !== -1) correct = -2; else correct = i; }
    });
    if (correct < 0) { problems.push(`Question ${n + 1}: put * in front of exactly one correct option.`); return; }
    out.push({ type: 'mcq', text: lines[0], options, correct, tags, typed: true });
  });
  return { questions: out, problems };
}

// ---------- evidence: all counting is done here, in code ----------
const given = (answers, q) => { const x = (answers || {})[q.number]; return x === undefined || x === null || String(x).trim() === '' ? null : Number(x); };

// One student's answers -> which tagged mistaken ideas show up, how often.
function diagnose(questions, answers) {
  const tally = new Map();
  let wrong = 0, unclear = 0;
  const wrongItems = [];
  for (const q of questions) {
    if (q.type !== 'mcq') continue;
    const g = given(answers, q);
    if (g === q.correct && Number.isInteger(g)) continue;
    wrong++;
    const tag = g !== null && q.tags ? q.tags[g] : null;
    if (tag && tagKey(tag)) {
      const k = tagKey(tag);
      const cur = tally.get(k) || { key: k, name: tag, count: 0, questions: [] };
      cur.count++; cur.questions.push(q.number); tally.set(k, cur);
      wrongItems.push({ number: q.number, tag, key: k });
    } else { unclear++; wrongItems.push({ number: q.number, tag: null, key: null }); }
  }
  const tags = [...tally.values()].map((t) => ({ ...t, level: t.count >= 2 ? 'likely' : 'suspected' })).sort((a, b) => b.count - a.count);
  const kind = !wrong ? 'none' : tags.some((t) => t.level === 'likely') ? 'likely' : tags.length ? 'suspected' : 'unclear';
  return { kind, wrongCount: wrong, unclearCount: unclear, tags, wrong: wrongItems };
}

// Whole class: which mistaken idea is held by how many students.
function classGaps(questions, attempts) {
  const map = new Map();
  for (const a of attempts) {
    for (const t of diagnose(questions, a.answers).tags) {
      const cur = map.get(t.key) || { key: t.key, name: t.name, likely: [], suspected: [] };
      cur[t.level].push({ id: a.student_id, name: a.name, count: t.count });
      map.set(t.key, cur);
    }
  }
  return [...map.values()].sort((a, b) => (b.likely.length * 100 + b.suspected.length) - (a.likely.length * 100 + a.suspected.length));
}

// The distinct tags in a quiz and how many questions use each (so the teacher can check the wording before publishing).
function tagList(questions) {
  const map = new Map();
  for (const q of questions) {
    if (q.type !== 'mcq' || !q.tags) continue;
    for (const t of q.tags) {
      if (!t) continue;
      const k = tagKey(t), cur = map.get(k) || { key: k, name: t, questions: 0 };
      cur.questions++; map.set(k, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.questions - a.questions);
}

module.exports = { tagKey, cleanTags, parseTyped, diagnose, classGaps, tagList };
