// SANDBOX ONLY: runs the app with a pretend AI and an in-memory database so screens can be clicked in a headless browser.
// Run:  NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js
process.env.DATABASE_PATH = ':memory:';
const express = require('express'), path = require('path');
const { buildRouter } = require('../../routes');
const engine = require('../../services/engine');
const fakeAi = {
  configured: () => !process.env.AI_OFF,
  readSheetTwice: async (f, m, qs) => [Object.fromEntries(qs.map((q, i) => [q.id, { final: i === 0 ? '5/6' : '2/3' }])), Object.fromEntries(qs.map((q, i) => [q.id, { final: i === 0 ? '5/6' : '3/4' }]))],
  describeRule: async () => null,
  tips: async () => ({ activities: ['PRETEND AI idea'], misconceptionNote: 'pretend' }),
  hint: async () => 'PRETEND AI hint',
  quiz: async ({ topic, allowMcq, subject }) => /photosyn|cell|biolog|plant/i.test(String(topic) + String(subject)) ? [
    { type: 'mcq', text: 'What do plants take in for photosynthesis?', options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'], correct: 0, tags: [null, 'Thinks plants breathe like animals', null, null] },
    { type: 'mcq', text: 'Which gas do plants give out in photosynthesis?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Methane'], correct: 0, tags: [null, 'Thinks plants breathe like animals', null, null] },
    { type: 'mcq', text: 'Where does photosynthesis happen?', options: ['Chloroplast', 'Mitochondria', 'Nucleus', 'Vacuole'], correct: 0, tags: [null, 'Mixes up making food with releasing energy', null, null] }] : [{ type: 'calc', expression: '3/4+1/8' }, { type: 'calc', expression: '2/3*3/4' }, { type: 'calc', expression: '5/6-1/3' },
    ...(allowMcq ? [{ type: 'mcq', text: 'What is the top number of a fraction called?', options: ['Numerator', 'Denominator', 'Factor', 'Product'], correct: 0 }] : [])],
  // pretend circled-letter reader: the two reads disagree on Q2 and Q4 (so the teacher must fill those)
  readChoiceSheetTwice: async (f, m, n) => { const a = {}, b = {}; const base = ['B', 'A', 'A', 'A', 'B']; for (let i = 1; i <= n; i++) { a[i] = base[i - 1] || 'A'; b[i] = i === 2 ? 'C' : i === 4 ? 'UNCLEAR' : a[i]; } return [a, b]; },
  conceptLesson: async () => ({ steps: ['PRETEND concept step one.', 'PRETEND concept step two.'], tip: 'PRETEND concept tip' }),
  lesson: async () => ({ steps: ['PRETEND step one.', 'PRETEND step two.'], tip: 'PRETEND tip' }),
  interview: async (f, m, q, frames = []) => ({ audible: true, ...(frames.length ? { bodyVisible: true, body: { eyeContact: { score: 4, reason: 'PRETEND looked at camera' }, expression: { score: 3, reason: 'PRETEND relaxed face' }, posture: { score: 5, reason: 'PRETEND upright' } } } : {}), summary: 'PRETEND feedback summary.', rubric: Object.fromEntries(['clarity', 'relevance', 'structure', 'confidence', 'vocabulary'].map((k) => [k, { score: 4, reason: 'ok' }])), strengths: ['PRETEND good'], improve: ['PRETEND improve'], fillers: ['um'], tryThis: 'PRETEND opening' }),
};
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', buildRouter(fakeAi));
app.use(express.static(path.join(__dirname, '../../public')));
const PORT = parseInt(process.env.PORT, 10) || 3100;
app.listen(PORT, () => console.log('fake-ai app on ' + PORT + (process.env.AI_OFF ? ' (AI OFF)' : '')));
