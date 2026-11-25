// AI helpers for Milestone 5. Same rules as before: the AI never marks and never writes an answer key for a number question.
//  - quiz: AI proposes questions. Number questions are sent as an expression only; CODE computes the answer.
//  - interview: AI gets the AUDIO and the question (no name, no class, no scores) and returns coaching feedback.
//  - lesson: AI gets pattern name + explanation + a question whose answer was computed by code.
const fs = require('fs');
const gemini = require('./gemini');

const clip = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);

// Raw questions from the AI. Validation happens in extras.js (cleanQuestions).
// Works for ANY subject. Number sums ("calc") are only for questions whose answer is a plain number; the computer works those out.
// Everything else is multiple choice, and each WRONG option is tagged with the mistaken idea behind it.
async function quizWithAI({ topic, count, allowMcq, subject, level }) {
  const kinds = allowMcq
    ? `- {"type":"mcq","text":"...","options":["...","...","...","..."],"correct":0,"tags":[null,"mistaken idea A","mistaken idea B","mistaken idea C"]}
  "correct" is the index 0-3 of the right option. "tags" has 4 entries: null at the correct option; at every wrong option, a short plain-language name (under 12 words) of the mistaken idea a student would hold if they picked it, for example "Thinks heavier objects fall faster". If two questions share the same mistaken idea, reuse EXACTLY the same wording so they can be counted together. Never mention a student.
- {"type":"calc","expression":"3/4+1/8"}  ONLY when the whole question is a plain number sum: digits, + - * / ^ and brackets. Do NOT give the answer; a calculator will work it out. Use mcq for everything else.`
    : `- {"type":"calc","expression":"3/4+1/8"}  ONLY a plain number expression: digits, + - * / ^ and brackets. Do NOT give the answer; a calculator will work it out.
Use ONLY this kind. If the topic cannot be asked as number expressions, return {"questions":[]}.`;
  const prompt = `You write short quizzes for school students in India.
Subject: ${clip(subject, 60) || 'not given (guess from the topic)'}
Topic: ${topic}
Level: ${clip(level, 40) || 'Class 6-8'}
Write ${count} different questions. Allowed kinds:
${kinds}
Keep the level right for the students. Test understanding of the concept, not trick wording. Make the wrong options things a real student might believe. No real people, no links.
Return only JSON: {"questions":[...]}`;
  const out = await gemini.generateJson([{ text: prompt }], 0.5);
  return Array.isArray(out.questions) ? out.questions : [];
}

// A short explanation for a mistaken idea in any subject. Labelled "AI explanation" on screen: code cannot check facts.
async function conceptLessonWithAI({ subject, topic, tag, question, wrongChoice, rightChoice }) {
  const prompt = `A school student in India (${clip(subject, 60) || 'subject not given'}, topic: ${clip(topic, 80)}) seems to hold this mistaken idea: ${clip(tag, 120)}.
In a quiz question "${clip(question, 200)}" they chose "${clip(wrongChoice, 100)}". The teacher's answer key says the right answer is "${clip(rightChoice, 100)}".
Explain in 3 to 5 short steps (each under 30 words, plain English) why the right answer is right and where the mistaken idea goes wrong, then one short tip to remember it.
Only state facts you are sure about. If you are not sure, say so in the tip.
Return only JSON: {"steps":["...","..."],"tip":"..."}`;
  const out = await gemini.generateJson([{ text: prompt }], 0.2);
  return { steps: (Array.isArray(out.steps) ? out.steps : []).slice(0, 5).map((s) => clip(s, 220)).filter(Boolean), tip: clip(out.tip, 220) };
}

// A step-by-step mini lesson. The answer was computed by code and must not change.
async function lessonWithAI({ name, explanation, expression, correct }) {
  const prompt = `A Class 6-8 student often makes this slip: ${name}. ${explanation}
Teach them how to solve: ${expression}
The correct answer is ${correct} (already worked out by a calculator; do not change it).
Give 3 to 5 short steps (each under 30 words, plain English, use only numbers from the question or numbers you get on the way) and one short tip to avoid the slip.
Return only JSON: {"steps":["...","..."],"tip":"..."}`;
  const out = await gemini.generateJson([{ text: prompt }], 0.2);
  return { steps: (Array.isArray(out.steps) ? out.steps : []).slice(0, 5).map((s) => clip(s, 220)).filter(Boolean), tip: clip(out.tip, 220) };
}

// Interview coaching from audio, and (video mode) a few still snapshots taken while the student spoke.
// Only the question text, the recording and the snapshots are sent. No name, class or scores.
async function interviewWithAI(filePath, mimeType, question, frames = []) {
  const video = frames.length > 0;
  const bodyRules = video ? `
You are also given ${frames.length} still snapshots taken in order while the student answered. Coach their on-camera delivery from what is visible:
- eyeContact: do they look towards the camera most of the time, or look away/down a lot?
- expression: is their face relaxed and engaged, or tense/blank? Describe what you SEE (for example "smiling at the start", "frowning while thinking"). Do not claim to know their feelings or character.
- posture: sitting upright and steady, or slouching, leaning, fidgeting, covering the face?
- Only use what is visible in the snapshots. A few snapshots cannot show everything, so say "in the snapshots".
- NEVER comment on face shape, skin colour, age, gender, weight, disability, religion, clothing, hair, jewellery, room or background, or how attractive someone looks. Never identify the person.
- If the face or body is not visible in most snapshots, return "bodyVisible":false and skip the body rubric.` : '';
  const bodyJson = video ? `,"bodyVisible":true,"body":{"eyeContact":{"score":1,"reason":"..."},"expression":{"score":1,"reason":"..."},"posture":{"score":1,"reason":"..."}}` : '';
  const prompt = `You are a kind speaking coach for a school student in India who is practising for an interview.
The question they were asked: "${question}"
Listen to their spoken answer. Coach them on WHAT they said and HOW clearly they said it.${video ? ' Then coach how they come across on camera.' : ''}
Rules:
- Judge the answer: clarity, relevance to the question, structure (a beginning, middle and end), confident delivery, and word choice.
- Do NOT comment on accent, voice, gender, looks, religion, caste, family, or background. Do not guess personal traits.
- Do not repeat any personal details (names, phone numbers, addresses) in your feedback.
- Be encouraging and specific. Quote nothing longer than a few words.
- Coach whatever you can hear, even if the answer is short, quiet or has some noise. Return {"audible":false} ONLY if there is no intelligible speech at all (silence or pure noise).${bodyRules}
Return only JSON:
{"audible":true,"summary":"two sentences","rubric":{"clarity":{"score":1,"reason":"..."},"relevance":{"score":1,"reason":"..."},"structure":{"score":1,"reason":"..."},"confidence":{"score":1,"reason":"..."},"vocabulary":{"score":1,"reason":"..."}},"strengths":["...","..."],"improve":["...","..."],"fillers":["um"],"tryThis":"one sentence they could use as a stronger opening"${bodyJson}}
Scores are whole numbers 1 to 5.`;
  const data = fs.readFileSync(filePath).toString('base64');
  const parts = [{ text: prompt }, { inline_data: { mime_type: mimeType, data } }];
  for (const f of frames) parts.push({ inline_data: { mime_type: f.mimetype || 'image/jpeg', data: fs.readFileSync(f.path).toString('base64') } });
  return gemini.generateJson(parts, 0.2);
}

// Paper multiple-choice sheet: which option did the student mark for each numbered question? Letters only, no names.
// variant 0 reads top to bottom, variant 1 reads from the last question (a different path catches slips).
async function readChoiceSheetOnce(filePath, mimeType, count, variant) {
  const order = variant === 0 ? 'from question 1 to the last question' : 'one question at a time, starting from the last question';
  const prompt = `This is a student's paper multiple-choice answer sheet with ${count} numbered questions. Read it ${order}.
For each question, find the option the student circled, ticked or filled in. Report it as A, B, C or D (if the options are written a, b, c, d or 1, 2, 3, 4, then a or 1 is A, b or 2 is B, c or 3 is C, d or 4 is D).
If no option is marked, more than one option is marked, or you cannot tell, use "UNCLEAR". Do not guess.
Do not output any name or roll number from the sheet.
Return only JSON: {"answers":{"1":"B","2":"UNCLEAR"}}`;
  const data = fs.readFileSync(filePath).toString('base64');
  const out = await gemini.generateJson([{ text: prompt }, { inline_data: { mime_type: mimeType, data } }], variant === 0 ? 0.1 : 0.3);
  const raw = out && typeof out.answers === 'object' && out.answers ? out.answers : {};
  const answers = {};
  for (let n = 1; n <= count; n++) answers[n] = String(raw[n] ?? raw['Q' + n] ?? 'UNCLEAR').trim().slice(0, 12) || 'UNCLEAR';
  return answers;
}
// One read after the other (not at the same moment) so a free-tier key is not hit by a burst.
async function readChoiceSheetTwice(filePath, mimeType, count) {
  const a = await readChoiceSheetOnce(filePath, mimeType, count, 0);
  const b = await readChoiceSheetOnce(filePath, mimeType, count, 1);
  return [a, b];
}

module.exports = { readChoiceSheetOnce, readChoiceSheetTwice, quizWithAI, conceptLessonWithAI, lessonWithAI, interviewWithAI, clip };
