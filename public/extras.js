/* GapMap Milestone 5 frontend. Loaded after app.js. Uses window.GM helpers.
   All server text goes in with h() (textContent), never innerHTML. */
(() => {
'use strict';
const { h, api, state, toast, modal, busy, btn, link, page, head, empty, errorBox, icon, ring, hbar, qlist, route } = window.GM;
const GM = window.GM;
const T = (cid) => [{ label: 'Classes', href: '#/t' }, { label: 'Class', href: '#/t/c/' + cid }];
const enc = encodeURIComponent;
let pendingNote = null; // why the AI was not used (shown once on the next quiz screen)
GM.setNote = (n) => { pendingNote = n || null; };
const LETTER = ['A', 'B', 'C', 'D'];
const takeNote = () => { const n = pendingNote; pendingNote = null; return n ? h('div', { class: 'note' }, n) : null; };

// ---------- small shared pieces ----------
async function download(path, fallbackName) {
  try {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + state.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast(e.message, 'bad'); }
}
const note = (text) => h('p', { class: 'small muted', style: 'margin-top:8px' }, text);
const tile = (href, color, ic, title, sub) => h('a', { class: 'tile', href }, h('div', { class: 'ico ' + color }, icon(ic)), h('h2', {}, title), h('p', { class: 'muted' }, sub));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const rubricLabels = { clarity: 'Clarity', relevance: 'Answers the question', structure: 'Structure', confidence: 'Confident delivery', vocabulary: 'Word choice', eyeContact: 'Looking at the camera', expression: 'Face expression', posture: 'Sitting posture' };

// A question as the student sees it: a number sum box or four options
function questionInput(q, store, disabled) {
  if (q.type === 'mcq') {
    const name = 'q' + q.number + Math.random().toString(36).slice(2, 6);
    return h('div', { class: 'stack' }, h('span', { class: 'expr' }, q.text), q.options.map((o, i) => h('label', { class: 'opt' },
      h('input', { type: 'radio', name, disabled, onchange: () => { store[q.number] = i; } }), h('span', {}, o))));
  }
  const input = h('input', { 'aria-label': 'Answer to ' + q.prompt, placeholder: 'e.g. 3/4', autocomplete: 'off', disabled, oninput: () => { store[q.number] = input.value.trim(); } });
  return h('div', {}, h('span', { class: 'expr' }, q.prompt + ' = '), input);
}
function reviewRow(q) {
  const ok = q.correct;
  const detail = q.type === 'mcq'
    ? h('div', {}, h('p', { class: 'small muted' }, q.yourIndex == null ? 'No answer. ' : 'You chose: ' + q.options[q.yourIndex] + '. ', 'Right answer: ' + q.options[q.correctIndex]),
        q.yourTag ? h('p', { class: 'small' }, 'Looks like: ' + q.yourTag) : null)
    : h('p', { class: 'small muted' }, 'You wrote: ' + (q.yourAnswer || 'nothing') + '. Right answer: ' + q.answer);
  return h('div', { class: 'qrow' }, h('div', { class: 'qno' }, q.number), h('div', { class: 'grow' }, h('span', { class: 'expr' }, q.type === 'mcq' ? q.text : q.prompt), detail),
    h('span', { class: 'chip ' + (ok ? 'leaf' : 'rose') }, ok ? 'Right' : 'Not yet'));
}

// ================= TEACHER =================
async function quizzesScreen(cid) {
  const list = await api('GET', `/classes/${cid}/quizzes`);
  const topic = h('input', { id: 'qt', placeholder: 'For example: photosynthesis, the Mughal empire, adding fractions' });
  const subject = h('input', { id: 'qs', list: 'subjList', placeholder: 'Any subject: Biology, History, English, Maths, Computer Science...' });
  const level = h('input', { id: 'ql', placeholder: 'Class 6-8', style: 'max-width:180px' });
  const typedMcq = h('textarea', { id: 'qm', rows: 9, placeholder: 'Which part of the cell makes energy?\n*Mitochondria\nNucleus | Thinks the nucleus does every job\nRibosome | Mixes up making protein with making energy\nChloroplast\n\n(blank line, then the next question)' });
  const count = h('input', { id: 'qc', type: 'number', min: 1, max: 10, value: 5, style: 'max-width:90px' });
  const typed = h('textarea', { id: 'qe', placeholder: '3/4+1/8\n2/3*3/4' });
  const err = h('div');
  const make = async (body) => {
    const done = busy('Making the quiz');
    try { const q = await api('POST', `/classes/${cid}/quizzes`, body); done(); pendingNote = q.note || null; toast(q.source === 'builtin' ? 'Draft quiz ready (built-in questions)' : 'Draft quiz ready to review', 'ok'); location.hash = '#/t/q/' + q.id; }
    catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  };
  page([...T(cid), { label: 'Quizzes' }], head('Quizzes', 'A quiz for the whole class. You review it before any student sees it.'),
    h('div', { class: 'slab' }, err, h('h3', { style: 'margin-bottom:10px' }, 'New quiz on any subject or topic (AI)'),
      h('div', { class: 'field' }, h('label', { for: 'qs' }, 'Subject'), subject, h('datalist', { id: 'subjList' }, ['Maths', 'Science', 'Biology', 'Physics', 'Chemistry', 'Social Science', 'History', 'Geography', 'English', 'Hindi', 'Computer Science'].map((x) => h('option', { value: x })))), h('div', { class: 'field' }, h('label', { for: 'qt' }, 'Topic or concept'), topic),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'ql' }, 'Level'), level), h('div', { class: 'field' }, h('label', { for: 'qc' }, 'How many questions (1 to 10)'), count)),
      h('p', { class: 'hint' }, 'The AI proposes multiple-choice questions and names the mistaken idea behind each wrong option. Number sums are worked out by the computer. The AI-written answer key and mistaken-idea names can be wrong, so check them before you publish.'),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Make a draft quiz', 'plum', () => make({ topic: topic.value, subject: subject.value, level: level.value, count: count.value }), 'big')),
      h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:22px 0' }),
      h('h3', { style: 'margin-bottom:6px' }, 'Or type your own multiple-choice questions (any subject, no AI needed)'),
      h('p', { class: 'hint' }, 'Line 1: the question. Next 4 lines: the options. Put * in front of the correct one. After a | write the mistaken idea a student has if they pick that option (optional, but it is what lets the computer find patterns). Leave a blank line between questions. Use the exact same wording when two questions share the same mistaken idea.'),
      h('div', { class: 'field' }, h('label', { for: 'qm' }, 'Questions'), typedMcq),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Make a draft quiz', 'blue', () => make({ topic: topic.value || subject.value || 'Typed questions', subject: subject.value, typedMcq: typedMcq.value }), 'big')),
      h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:22px 0' }),
      h('h3', { style: 'margin-bottom:10px' }, 'Or type your own number questions'),
      h('div', { class: 'field' }, h('label', { for: 'qe' }, 'One per line'), typed),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Make a draft quiz', 'leaf', () => make({ topic: topic.value, expressions: typed.value.split('\n') }), 'big'))),
    h('h2', { style: 'margin:30px 0 14px' }, 'Your quizzes'),
    list.length ? h('div', { class: 'list' }, list.map((q) => h('a', { class: 'item', href: '#/t/q/' + q.id }, h('div', { class: 'grow' }, h('strong', {}, q.title), h('p', { class: 'muted small' }, q.topic)),
      h('span', { class: 'chip ' + (q.status === 'published' ? 'leaf' : q.status === 'draft' ? 'sun' : '') }, q.status === 'draft' ? 'Draft' : q.status === 'published' ? 'Open' : 'Closed'),
      q.mode === 'paper' ? h('span', { class: 'chip plum' }, 'Paper test') : null, q.audienceCount ? h('span', { class: 'chip sun' }, 'For ' + q.audienceCount + ' student' + (q.audienceCount === 1 ? '' : 's')) : null,
      q.status !== 'draft' ? h('span', { class: 'chip blue' }, q.mode === 'paper' ? `${q.attempted} of ${q.students} sheets entered` : `${q.attempted} of ${q.students} done`) : null))) : empty('No quizzes yet', 'Make one above.'));
}

async function quizScreen(qid) {
  const quiz = await api('GET', '/quizzes/' + qid);
  const crumbs = [...T(quiz.classId), { label: 'Quizzes', href: `#/t/c/${quiz.classId}/quizzes` }, { label: quiz.title }];
  if (quiz.status === 'draft') {
    page(crumbs, head(quiz.title, 'Draft. Students cannot see it yet. Remove anything you do not like, then publish.'), takeNote(),
      quiz.mode === 'paper' ? h('div', { class: 'note' }, 'Paper test: students do not answer in the app. The letters A to D below must match the order printed on your paper. Check the key, publish, then add each student\'s sheet (photo or typed letters).') : null,
      quiz.audience ? h('div', { class: 'note' }, 'Practice quiz for ' + quiz.audience.length + ' student' + (quiz.audience.length === 1 ? '' : 's') + ' only: ' + quiz.audience.map((s) => s.name).join(', ') + '. No other student will see it. It is a draft: check every question, then publish.') : null,
      quiz.aiKeyCount ? h('div', { class: 'note' }, 'Questions marked "AI-written answer key" have an answer key and mistaken-idea names written by the AI. Check each one yourself before you publish. Number questions are worked out by the computer.') : null,
      quiz.tagList && quiz.tagList.length ? h('div', { class: 'slab', style: 'margin-bottom:16px' }, h('h3', { style: 'margin-bottom:6px' }, 'Mistaken ideas in this quiz'),
        h('p', { class: 'small muted' }, 'The computer counts students by these names. A student is "likely" to hold an idea only when they pick it in 2 or more questions, so the same idea needs the exact same wording.'),
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-top:8px' }, quiz.tagList.map((t) => h('span', { class: 'chip sun' }, t.name + ' (' + t.questions + ')')))) : null,
      h('div', { class: 'slab' }, quiz.questions.map((q) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, q.number),
        h('div', { class: 'grow' }, q.type === 'mcq'
          ? h('div', {}, h('span', { class: 'expr' }, q.text), h('div', { class: 'small', style: 'margin-top:6px' }, q.options.map((o, i) => h('div', { style: 'margin:4px 0' }, h('span', { class: i === q.correct ? 'chip leaf' : 'muted' }, (i === q.correct ? 'Key ' + LETTER[i] + ': ' : LETTER[i] + '. ') + o),
              q.tags && q.tags[i] ? h('span', { class: 'chip sun', style: 'margin-left:8px' }, 'Mistaken idea: ' + q.tags[i]) : null))),
            h('span', { class: q.builtin || q.typed ? 'chip blue' : 'chip plum', style: 'margin-top:6px' }, q.builtin ? 'Built-in question' : q.typed ? 'Typed by you' : 'AI-written answer key'))
          : h('div', {}, h('span', { class: 'expr' }, q.prompt), '  ', h('span', { class: 'chip leaf' }, 'Answer: ' + q.answer + ' (computer)'))),
        btn('Remove', 'ghost', async () => { try { await api('POST', `/quizzes/${qid}/remove-question`, { number: q.number }); route(); } catch (e) { toast(e.message, 'bad'); } }, 'small')))),
      h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' }, quiz.mode === 'paper' ? link('Print question paper', `#/t/q/${qid}/print`, 'ghost') : null,
        btn(quiz.mode === 'paper' ? 'Publish (key is right, ready for sheets)' : quiz.audience ? 'Publish to these students' : 'Publish to every student', 'leaf', async () => { try { await api('POST', `/quizzes/${qid}/publish`); toast('Published. Students can see it now.', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); } }, 'big')));
    return;
  }
  const p = await api('GET', `/quizzes/${qid}/participation`);
  const paper = quiz.mode === 'paper';
  page(crumbs, head(quiz.title, paper ? 'Paper test. Add each student\'s answer sheet; the computer marks it.' : quiz.audienceCount ? 'Practice quiz for ' + quiz.audienceCount + ' student' + (quiz.audienceCount === 1 ? '' : 's') + ' only.' : quiz.status === 'published' ? 'Open for students.' : 'Closed.',
      h('div', { class: 'row' }, paper && quiz.status === 'published' ? link('Add a student\'s sheet', `#/t/q/${qid}/sheet`, 'blue', 'small') : null, paper ? link('Print question paper', `#/t/q/${qid}/print`, 'ghost', 'small') : null,
        quiz.status === 'published' ? btn('Close quiz', 'rose', async () => { try { await api('POST', `/quizzes/${qid}/close`); route(); } catch (e) { toast(e.message, 'bad'); } }, 'small') : null)),
    h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('b', {}, p.attemptedCount), h('span', {}, paper ? 'sheets entered' : 'attempted')), h('div', { class: 'stat' }, h('b', {}, p.absentCount), h('span', {}, paper ? 'sheets missing' : 'not yet')),
      h('div', { class: 'stat' }, h('b', {}, p.averagePct == null ? '-' : p.averagePct + '%'), h('span', {}, 'class average'))),
    h('div', { class: 'slab', style: 'margin-top:22px' }, h('h3', { style: 'margin-bottom:10px' }, 'Students'),
      h('div', { class: 'list' }, p.students.map((s) => h('div', { class: 'item' }, h('strong', { class: 'grow' }, s.name),
        s.attempted ? [h('span', { class: 'chip leaf' }, `${s.score}/${s.total}`), link('Open answers', `#/t/q/${qid}/student/${s.id}`, 'ghost', 'small')]
          : [h('span', { class: 'chip rose' }, paper ? 'Sheet not entered' : 'Absent / not attempted'), paper && quiz.status === 'published' ? link('Add sheet', `#/t/q/${qid}/sheet/${s.id}`, 'blue', 'small') : null])))),
    p.gaps && p.gaps.length ? h('div', { class: 'slab', style: 'margin-top:22px' }, h('h3', { style: 'margin-bottom:6px' }, 'Mistake patterns in this class'),
      h('p', { class: 'small muted' }, 'Likely = picked in 2 or more questions. Suspected = picked once. This is consistent with the answers, not proof; the names were checked by you before publishing.'),
      h('div', { class: 'list', style: 'margin-top:10px' }, p.gaps.map((g) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, g.name),
        g.likely.length ? h('p', { class: 'small' }, 'Likely: ' + g.likely.map((s) => s.name).join(', ')) : null,
        g.suspected.length ? h('p', { class: 'small muted' }, 'Suspected: ' + g.suspected.map((s) => s.name).join(', ')) : null),
        h('span', { class: 'chip ' + (g.likely.length ? 'rose' : 'sun') }, g.likely.length + g.suspected.length + ' student' + (g.likely.length + g.suspected.length === 1 ? '' : 's')),
        g.likely.length ? btn('Send a practice quiz', 'plum', () => practiceFor(qid, g), 'small') : null)))) : null,
    h('div', { class: 'slab', style: 'margin-top:22px' }, h('h3', { style: 'margin-bottom:10px' }, 'How each question went'),
      p.perQuestion.map((q) => hbar('Q' + q.number + ' ' + q.label.slice(0, 40), [{ value: pct(q.correct, q.attempted), color: 'leaf', max: 100 }], `${q.correct}/${q.attempted}`))));
}

// Teacher: make a DRAFT practice quiz for the students who are likely to hold one mistaken idea. They only see it after you publish it.
async function practiceFor(qid, g) {
  const done = busy('Making the practice quiz');
  try {
    const r = await api('POST', `/quizzes/${qid}/practice-quiz`, { tag: g.name });
    done(); pendingNote = r.note || null;
    toast('Draft practice quiz ready for ' + r.audience.length + ' student' + (r.audience.length === 1 ? '' : 's'), 'ok');
    location.hash = '#/t/q/' + r.id;
  } catch (e) { done(); toast(e.message, 'bad'); }
}

async function participationScreen(cid) {
  const [e, iv] = await Promise.all([api('GET', `/classes/${cid}/engagement`), api('GET', `/classes/${cid}/interviews`)]);
  page([...T(cid), { label: 'Participation' }], head('Participation', 'Who is practising, who is not.', btn('Download CSV', 'ghost', () => download(`/classes/${cid}/engagement.csv`, 'participation.csv'), 'small')),
    e.inactive.length ? h('div', { class: 'note' }, 'No activity yet from: ' + e.inactive.join(', ') + '.') : null,
    e.students.length ? h('div', { class: 'list' }, e.students.map((s) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, s.name), h('p', { class: 'muted small' }, s.lastActive ? 'Last active ' + s.lastActive : 'Not active yet')),
      h('span', { class: 'chip blue' }, `Quizzes ${s.quizzes}/${e.classQuizzes}`), h('span', { class: 'chip sun' }, `Homework ${s.homework}/${e.classHomework}`), h('span', { class: 'chip leaf' }, 'Practice ' + s.practiceDone),
      s.streak ? h('span', { class: 'chip plum' }, s.streak + '-day streak') : null))) : empty('No students', 'Add students first.'),
    h('h2', { style: 'margin:30px 0 6px' }, 'Interview practice shared with you'),
    h('p', { class: 'muted small', style: 'margin-bottom:12px' }, 'Only recordings the student chose to share. This is AI coaching feedback, not a grade. No audio is kept.'),
    iv.length ? h('div', { class: 'list' }, iv.map((r) => h('div', { class: 'slab' }, h('strong', {}, r.student), h('p', { class: 'muted small' }, r.question), h('p', { style: 'margin-top:8px' }, r.feedback.summary), feedbackBits(r.feedback)))) : empty('Nothing shared yet', 'Students choose whether to share.'));
}
function feedbackBits(f) {
  return h('div', { class: 'stack', style: 'margin-top:10px' },
    Object.entries(f.rubric).map(([k, r]) => hbar(rubricLabels[k] || k, [{ value: r.score * 20, color: 'plum', max: 100 }], r.score + '/5')),
    f.body ? h('div', { class: 'stack', 'data-testid': 'body-feedback' }, h('strong', {}, 'On camera (from a few snapshots)'),
      Object.entries(f.body).map(([k, r]) => h('div', {}, hbar(rubricLabels[k] || k, [{ value: r.score * 20, color: 'sun', max: 100 }], r.score + '/5'), r.reason ? h('p', { class: 'small muted' }, r.reason) : null))) : null,
    f.bodyNote ? h('p', { class: 'small muted' }, f.bodyNote) : null,
    f.strengths.length ? h('div', {}, h('strong', {}, 'Good: '), f.strengths.join(' ')) : null, f.improve.length ? h('div', {}, h('strong', {}, 'Work on: '), f.improve.join(' ')) : null,
    f.fillers.length ? h('p', { class: 'small muted' }, 'Filler words heard: ' + f.fillers.join(', ')) : null, f.tryThis ? h('p', { class: 'small' }, 'Try opening with: "' + f.tryThis + '"') : null);
}

GM.testActions = (aid, a) => h('div', { class: 'row', style: 'margin-top:22px' },
  btn('Download results (CSV)', 'ghost', () => download(`/assessments/${aid}/results.csv`, 'results.csv'), 'small'),
  a.kind === 'homework' ? h('span', { class: 'chip sun' }, 'Homework' + (a.due ? ' due ' + a.due : '') + ': students hand it in from their own portal') : null);
GM.groupActions = (aid, sig) => h('div', { class: 'row' }, link('Print remedial sheet', `#/t/a/${aid}/print/${enc(sig)}`, 'sun'));

// Printable sheet (teacher). Answer key on its own page.
async function teacherPrint(aid, sig) {
  const s = await api('POST', `/assessments/${aid}/sheet`, { signature: sig });
  sheetPage([{ label: 'Classes', href: '#/t' }, { label: 'Group', href: `#/t/a/${aid}/group/${enc(sig)}` }, { label: 'Print' }], s, true);
}
function sheetPage(crumbs, s, showKey) {
  const key = h('div', { class: 'slab key', style: showKey ? '' : 'display:none' }, h('h3', {}, 'Answer key (worked out by the computer)'), s.answerKey.map((k) => h('p', {}, k.number + '. ' + k.answer)));
  page(crumbs, h('div', { class: 'noprint' }, head('Printable sheet', 'Print it, or save it as PDF from the print window.', btn('Print', 'leaf', () => window.print(), 'big'))),
    h('div', { class: 'slab sheet-print' }, h('h1', { style: 'font-size:1.8rem' }, s.title), s.explanation ? h('p', { class: 'muted', style: 'margin:6px 0 4px' }, s.explanation) : null,
      h('p', { class: 'small' }, 'Name: ______________________    Date: ____________'), h('p', { style: 'margin:12px 0 4px' }, 'Work these out. Write each answer as a fraction or a whole number.'),
      s.questions.map((q) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, q.number), h('span', { class: 'expr' }, q.prompt + ' = ______')))),
    showKey ? key : h('div', { class: 'noprint', style: 'margin-top:16px' }, btn('Show answers', 'ghost', () => { key.style.display = ''; }, 'small'), key));
}

// ================= STUDENT =================
async function hub() {
  const [d, prog, quizzes, hw, notices, att] = await Promise.all([api('GET', '/student/home'), api('GET', '/student/progress'), api('GET', '/student/quizzes'), api('GET', '/student/homework'), api('GET', '/student/notices').catch(() => []), api('GET', '/student/attendance').catch(() => null)]);
  const openQ = quizzes.filter((q) => q.canAttempt && !q.self).length, openHw = hw.filter((x) => !x.done).length;
  page([{ label: 'Home' }], head('Hi, ' + d.name, prog.streak.current ? `${prog.streak.current}-day streak. Keep it going.` : 'Pick something to do.'),
    h('div', { class: 'grid' },
      tile('#/s/report', 'leaf', 'chart', 'My report card', 'Marks, attendance and homework in one page'),
      tile('#/s/results', 'blue', 'report', 'My results', d.results.length ? (d.results[0].problem && d.results[0].problem.kind === 'likely' && d.results[0].likely[0] ? 'Problem found: ' + d.results[0].likely[0].name : d.results[0].problem && d.results[0].problem.wrongCount ? d.results[0].problem.wrongCount + ' to fix' : d.results.length + ' checked') : 'Nothing checked yet'),
      tile('#/s/quizzes', 'sun', 'test', 'Quizzes', openQ ? openQ + ' waiting for you' : 'Class and practice quizzes'),
      tile('#/s/homework', 'teal', 'upload', 'Homework', openHw ? openHw + ' to hand in' : 'Nothing due'),
      tile('#/s/study', 'leaf', 'help', 'Study help', d.gaps.length ? 'Mini lessons for ' + d.gaps.length + ' gap' + (d.gaps.length === 1 ? '' : 's') : 'Appears when a gap is found'),
      tile('#/s/interview', 'plum', 'type', 'Interview practice', 'Speak, get coaching tips'),
      tile('#/s/notices', 'rose', 'bell', 'Notices', notices.length ? notices.length + ' from your teacher' : 'Nothing new'),
      tile('#/s/attendance', 'teal', 'calendar', 'My attendance', att && att.pct !== null ? att.pct + '%' + (att.low ? ' (below ' + att.threshold + '%)' : '') : 'Not marked yet'),
      tile('#/s/calendar', 'sun', 'calendar', 'Coming up', 'Homework due in the next 14 days')),
    h('div', { class: 'slab', style: 'margin-top:30px' }, h('h3', { style: 'margin-bottom:12px' }, 'Badges'),
      h('div', { class: 'pill-list' }, prog.badges.map((b) => h('span', { class: 'chip ' + (b.earned ? 'sun' : ''), title: b.how, style: b.earned ? '' : 'opacity:.5' }, (b.earned ? '' : 'Locked: ') + b.name))),
      note('Badges and streaks only count what you do: practice sets, quizzes, homework and interview practice.')));
}

async function quizzesStudent() {
  const [list] = await Promise.all([api('GET', '/student/quizzes')]);
  const topic = h('input', { id: 'st', placeholder: 'Leave empty to use your own gap, or type a topic' });
  const mine = (self) => list.filter((q) => q.self === self);
  const row = (q) => h('a', { class: 'item', href: '#/s/quiz/' + q.id }, h('div', { class: 'grow' }, h('strong', {}, q.title), h('p', { class: 'muted small' }, q.total + ' questions')),
    q.paper ? h('span', { class: 'chip plum' }, 'Paper test') : null, q.forGroup ? h('span', { class: 'chip sun' }, 'For you') : null,
    q.attempted ? h('span', { class: 'chip leaf' }, `${q.score}/${q.total}`) : q.canAttempt ? h('span', { class: 'chip blue' }, 'Start') : h('span', { class: 'chip' }, 'Closed'));
  page([{ label: 'Home', href: '#/s' }, { label: 'Quizzes' }], head('Quizzes', 'From your teacher, and your own practice quizzes.'),
    h('h2', { style: 'margin-bottom:12px' }, 'From your teacher'), mine(false).length ? h('div', { class: 'list' }, mine(false).map(row)) : empty('No class quiz yet', 'When your teacher publishes one, it shows here.'),
    h('div', { class: 'slab', style: 'margin-top:30px' }, h('h3', { style: 'margin-bottom:6px' }, 'Make my own practice quiz (AI)'),
      h('p', { class: 'muted small', style: 'margin-bottom:10px' }, 'Number questions only. The AI picks the sums, the computer works out the answers. Only the topic is sent. Up to 10 a day.'),
      h('div', { class: 'field' }, h('label', { for: 'st' }, 'Topic'), topic),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Make my quiz', 'plum', async () => {
        const done = busy('Making your quiz');
        try { const r = await api('POST', '/student/quizzes/self', { topic: topic.value }); done(); pendingNote = r.note || null; location.hash = '#/s/quiz/' + r.id; } catch (e) { done(); toast(e.message, 'bad'); } }, 'big'))),
    mine(true).length ? h('div', { style: 'margin-top:26px' }, h('h2', { style: 'margin-bottom:12px' }, 'My practice quizzes'), h('div', { class: 'list' }, mine(true).map(row))) : null);
}
// "Your problem" for a class quiz: only mistaken ideas the answers actually show. Honest wording when nothing is confirmed.
function problemCard(q) {
  const d = q.problem;
  if (!d) return null;
  if (d.kind === 'none') return h('div', { class: 'slab' }, h('h3', {}, 'No mistakes in this quiz'), h('p', { class: 'muted' }, 'Every answer was right.'));
  if (d.kind === 'unclear') return h('div', { class: 'slab' }, h('h3', {}, 'Some answers were not right'),
    h('p', { class: 'muted', style: 'margin-top:6px' }, 'The wrong options you picked do not point to one clear mistaken idea, so the computer will not guess. Look at the right answers below and ask your teacher.'));
  return h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, d.kind === 'likely' ? 'Your problem' : 'A possible problem'),
    h('p', { class: 'small muted' }, d.kind === 'likely' ? 'You picked the same mistaken idea in 2 or more questions.' : 'You picked this mistaken idea once, so it is only suspected.'),
    h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Next step: your teacher may send you a practice quiz for this idea. Look in your Quizzes.'),
    h('div', { class: 'list', style: 'margin-top:10px' }, d.tags.map((t) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, t.name), h('p', { class: 'small muted' }, 'Questions: ' + t.questions.join(', '))),
      h('span', { class: 'chip ' + (t.level === 'likely' ? 'rose' : 'sun') }, t.level === 'likely' ? 'Likely' : 'Suspected'),
      btn('Help me with this', 'plum', () => conceptHelpModal(q.id, t), 'small')))));
}
async function conceptHelpModal(quizId, t) {
  const done = busy('Getting help');
  try {
    const r = await api('POST', `/student/quizzes/${quizId}/help`, { tag: t.name }); done();
    modal({ title: r.name, body: h('div', { class: 'stack' },
      r.lesson ? h('div', {}, h('p', { class: 'small muted' }, 'AI explanation'), h('ol', {}, r.lesson.steps.map((x) => h('li', { style: 'margin:6px 0' }, x))), r.lesson.tip ? h('p', { class: 'note' }, 'Tip: ' + r.lesson.tip) : null) : h('p', { class: 'muted' }, r.lessonMessage),
      h('p', { class: 'small muted' }, r.note),
      r.resources && r.resources.resources && r.resources.resources.length ? h('div', {}, h('h3', { style: 'margin:10px 0 6px' }, 'Where to read more'), r.resources.resources.map((x) => h('p', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title || x.url)))) : h('p', { class: 'small muted' }, (r.resources && r.resources.message) || 'No online links found.')), actions: [{ label: 'Close', color: 'ghost', onclick: (close) => close() }] });
  } catch (e) { done(); toast(e.message, 'bad'); }
}
async function quizStudent(id) {
  const q = await api('GET', '/student/quizzes/' + id);
  const crumbs = [{ label: 'Home', href: '#/s' }, { label: 'Quizzes', href: '#/s/quizzes' }, { label: q.title }];
  if (q.attempted) {
    page(crumbs, head(q.title, q.paper ? `Your teacher marked your paper test: ${q.score} out of ${q.total}.` : `You scored ${q.score} out of ${q.total}.`), problemCard(q), h('div', { class: 'slab' }, q.questions.map(reviewRow)), h('div', { class: 'row', style: 'margin-top:18px' }, link('Back to quizzes', '#/s/quizzes', 'leaf')));
    return;
  }
  if (!q.canAttempt) { page(crumbs, empty('This quiz is closed', 'Ask your teacher if you missed it.', link('Back', '#/s/quizzes', 'blue'))); return; }
  const answers = {};
  page(crumbs, head(q.title, q.self ? 'Your own practice quiz.' : 'You can do this quiz once.'), takeNote(),
    h('div', { class: 'slab' }, q.questions.map((x) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, x.number), h('div', { class: 'grow' }, questionInput(x, answers, false))))),
    h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' }, btn('Submit', 'leaf', async () => {
      try { await api('POST', `/student/quizzes/${id}/submit`, { answers }); route(); } catch (e) { toast(e.message, 'bad'); } }, 'big')));
}

async function homeworkList() {
  const list = await api('GET', '/student/homework');
  page([{ label: 'Home', href: '#/s' }, { label: 'Homework' }], head('Homework', 'Type your answers, or take a photo of your written work.'),
    list.length ? h('div', { class: 'list' }, list.map((x) => h('a', { class: 'item', href: '#/s/homework/' + x.id }, h('div', { class: 'grow' }, h('strong', {}, x.title), h('p', { class: 'muted small' }, x.total + ' questions' + (x.due ? ', due ' + x.due : ''))),
      x.done ? h('span', { class: 'chip leaf' }, `${x.marks}/${x.total}`) : x.draftId ? h('span', { class: 'chip sun' }, 'Photo waiting for you') : x.overdue ? h('span', { class: 'chip rose' }, 'Overdue') : h('span', { class: 'chip blue' }, 'To do')))) : empty('No homework', 'Your teacher has not set any yet.'));
}
async function homeworkScreen(id) {
  const d = await api('GET', '/student/homework/' + id);
  const crumbs = [{ label: 'Home', href: '#/s' }, { label: 'Homework', href: '#/s/homework' }, { label: d.title }];
  if (d.done) {
    const r = d.result;
    page(crumbs, head(d.title, `You got ${r.marks} out of ${r.total}.`), h('div', { class: 'slab' }, r.items.map((it) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, it.q), h('div', { class: 'grow' }, h('span', { class: 'expr' }, it.expression + ' = '), h('span', {}, it.yourAnswer)),
      it.status === 'correct' ? h('span', { class: 'chip leaf' }, 'Right') : h('span', { class: 'chip rose' }, it.status === 'wrong' ? 'Correct answer: ' + it.correct : 'Your teacher will check')))),
      r.reviewCount ? note(r.reviewCount + ' answer(s) could not be read. Your teacher will check them.') : null);
    return;
  }
  const inputs = d.questions.map((q) => h('input', { 'aria-label': 'Answer to ' + q.prompt, placeholder: 'e.g. 3/4', autocomplete: 'off' }));
  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', style: 'display:none', onchange: async () => {
    const f = fileIn.files[0]; if (!f) return; const done = busy('Reading your work');
    try { const fd = new FormData(); fd.append('file', f); const dr = await api('POST', `/student/homework/${id}/photo`, fd, true); done(); draftScreen(dr); } catch (e) { done(); toast(e.message, 'bad'); } } });
  page(crumbs, head(d.title, d.due ? 'Due ' + d.due : 'Hand it in once. It is checked straight away by the computer.'),
    h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, 'Type your answers'), d.questions.map((q, i) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, i + 1), h('div', { class: 'grow' }, h('span', { class: 'expr' }, q.prompt + ' = '), inputs[i]))),
      h('div', { class: 'row', style: 'margin-top:16px;justify-content:flex-end' }, btn('Hand in', 'leaf', async () => {
        const answers = {}; d.questions.forEach((q, i) => { answers[q.id] = inputs[i].value.trim(); });
        try { await api('POST', `/student/homework/${id}/typed`, { answers }); toast('Handed in', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); } }, 'big'))),
    h('div', { class: 'slab', style: 'margin-top:20px' }, h('h3', { style: 'margin-bottom:6px' }, 'Or send a photo or PDF of your written work'),
      h('p', { class: 'muted small', style: 'margin-bottom:10px' }, 'The AI reads your answers twice. Where the two readings differ you type that answer yourself. The AI never marks it.'),
      fileIn, btn('Choose photo or PDF', 'blue', () => fileIn.click())));
}
function draftScreen(dr) {
  const inputs = {};
  page([{ label: 'Home', href: '#/s' }, { label: 'Homework', href: '#/s/homework' }, { label: dr.title }], head('Check what was read', 'Answers the computer was sure about are locked. Type the others yourself. Leave one empty if you did not answer.'),
    h('div', { class: 'slab' }, dr.answers.map((a, i) => { inputs[a.id] = h('input', { 'aria-label': 'Your answer to ' + a.prompt, placeholder: a.agree ? '' : 'type your answer', value: a.value, disabled: a.agree, autocomplete: 'off' });
      return h('div', { class: 'qrow' }, h('div', { class: 'qno' }, i + 1), h('div', { class: 'grow' }, h('span', { class: 'expr' }, a.prompt + ' = '), inputs[a.id]), a.agree ? h('span', { class: 'chip leaf' }, 'Read clearly') : h('span', { class: 'chip sun' }, 'Please type')); })),
    h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' }, btn('Hand in', 'leaf', async () => {
      const answers = {}; dr.answers.forEach((a) => { if (!a.agree) answers[a.id] = inputs[a.id].value.trim(); });
      try { await api('POST', `/student/homework/draft/${dr.submissionId}/confirm`, { answers }); toast('Handed in', 'ok'); location.hash = '#/s/homework/' + dr.assessmentId; route(); } catch (e) { toast(e.message, 'bad'); } }, 'big')));
}

// ---------- interview (voice only, or video with camera snapshots; audio converted to WAV in the browser) ----------
function toWav(audioBuffer) {
  const rate = 16000, len = Math.round(audioBuffer.duration * rate), ch = audioBuffer.numberOfChannels;
  const mono = new Float32Array(audioBuffer.length);
  for (let c = 0; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / ch; }
  const out = new Int16Array(len), ratio = audioBuffer.sampleRate / rate;
  for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, mono[Math.min(mono.length - 1, Math.floor(i * ratio))])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  const buf = new ArrayBuffer(44 + out.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + out.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  let peak = 0; for (let i = 0; i < mono.length; i++) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
  const blob = new Blob([buf], { type: 'audio/wav' }); blob.peak = peak;   // loudest point, 0 to 1: used to catch a silent microphone
  return blob;
}
async function blobToWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try { return toWav(await ctx.decodeAudioData(await blob.arrayBuffer())); } finally { ctx.close && ctx.close(); }
}
async function interviewScreen() {
  const [questions, past] = await Promise.all([api('GET', '/student/interview/questions'), api('GET', '/student/interviews')]);
  const sel = h('select', { id: 'iq' }, questions.map((q) => h('option', { value: q }, q)));
  const custom = h('input', { id: 'ic', placeholder: 'Or type your own question', maxlength: 200 });
  const consent = h('input', { type: 'checkbox', id: 'icons' }), share = h('input', { type: 'checkbox', id: 'ishare' });
  const modeVoice = h('input', { type: 'radio', name: 'imode', id: 'imode-voice', value: 'voice', checked: true });
  const modeVideo = h('input', { type: 'radio', name: 'imode', id: 'imode-video', value: 'video' });
  const consentText = h('span', {}, 'I allow the AI to listen to this recording.');
  const modeNote = h('div', { class: 'note' });
  const setMode = () => {
    const v = modeVideo.checked;
    consentText.textContent = v ? 'I allow the AI to listen to this recording and look at a few pictures from my camera.' : 'I allow the AI to listen to this recording.';
    modeNote.textContent = v
      ? 'Video mode: the camera takes a few small pictures while you speak. The AI coaches your answer and how you come across on camera (looking at the camera, face expression, sitting posture). It only describes what it sees in those pictures. It does not judge your looks, and it is coaching, not a grade. No video is saved: the voice recording and pictures are deleted right after the AI looks at them.'
      : 'Voice only: only your voice recording is used, and only to coach what you say. It is deleted right after the AI listens. The coach does not judge your accent, voice or looks. This is coaching, not a grade.';
  };
  modeVoice.addEventListener('change', setMode); modeVideo.addEventListener('change', setMode); setMode();
  const preview = h('video', { id: 'ipreview', autoplay: true, muted: true, playsinline: true, style: 'display:none;width:100%;max-width:420px;border-radius:14px;margin:10px 0;background:#000;transform:scaleX(-1)' });
  preview.muted = true;
  const status = h('p', { class: 'muted', role: 'status' }, 'Ready.'), out = h('div');
  const levelFill = h('div', { id: 'ilevel-fill', style: 'height:100%;width:0%;background:#43a06f;border-radius:8px;transition:width .08s' });
  const level = h('div', { id: 'ilevel', title: 'Microphone level: it should move when you speak', style: 'display:none;height:10px;width:100%;max-width:420px;background:#dfe9e5;border-radius:8px;margin:8px 0;overflow:hidden' }, levelFill);
  let rec = null, chunks = [], stream = null, timer = null, started = 0, frames = [], snapTimer = null, wasVideo = false, meterCtx = null, meterRaf = 0, loudest = 0;
  const startMeter = (st) => { try {
    const Ctx = window.AudioContext || window.webkitAudioContext; meterCtx = new Ctx(); const an = meterCtx.createAnalyser(); an.fftSize = 512; meterCtx.createMediaStreamSource(st).connect(an);
    const buf = new Uint8Array(an.fftSize); level.style.display = 'block'; loudest = 0;
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128) / 128); loudest = Math.max(loudest, m); levelFill.style.width = Math.min(100, Math.round(m * 220)) + '%'; meterRaf = requestAnimationFrame(tick); };
    tick(); } catch (e) { /* the meter is a help only */ } };
  const stopMeter = () => { cancelAnimationFrame(meterRaf); level.style.display = 'none'; if (meterCtx && meterCtx.close) meterCtx.close(); meterCtx = null; };
  const snap = () => {
    if (!preview.videoWidth) return;
    const c = document.createElement('canvas'), w = Math.min(480, preview.videoWidth); c.width = w; c.height = Math.round(preview.videoHeight * (w / preview.videoWidth));
    c.getContext('2d').drawImage(preview, 0, 0, c.width, c.height);
    c.toBlob((b) => { if (!b) return; frames.push(b); if (frames.length > 8) frames = frames.filter((_, i) => i % 2 === 0); }, 'image/jpeg', 0.7);
  };
  const stopCamera = () => { clearInterval(snapTimer); if (stream) stream.getTracks().forEach((t) => t.stop()); preview.srcObject = null; preview.style.display = 'none'; };
  const recBtn = btn('Start recording', 'rose', async () => {
    if (rec) { rec.stop(); return; }
    if (!consent.checked) { toast('Please tick the permission box first.', 'bad'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser cannot record. Try Chrome.', 'bad'); return; }
    wasVideo = modeVideo.checked; frames = [];
    try { stream = await navigator.mediaDevices.getUserMedia(wasVideo ? { audio: true, video: { facingMode: 'user', width: { ideal: 640 } } } : { audio: true }); }
    catch (e) { toast(wasVideo ? 'Camera or microphone permission was not given. You can choose Voice only instead.' : 'Microphone permission was not given.', 'bad'); return; }
    if (wasVideo) { preview.srcObject = stream; preview.style.display = 'block'; try { await preview.play(); } catch (e) { /* autoplay may already be running */ } }
    chunks = []; rec = new MediaRecorder(new MediaStream(stream.getAudioTracks())); started = Date.now(); startMeter(stream);   // audio only is recorded; video is only sampled into pictures
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearInterval(timer); stopMeter(); if (wasVideo) snap(); await new Promise((r) => setTimeout(r, 150)); stopCamera();
      const was = rec; rec = null; recBtn.textContent = 'Start recording'; recBtn.classList.remove('pulse');
      if (Date.now() - started < 3000) { status.textContent = 'That was too short. Try at least 10 seconds.'; return; }
      const done = busy(wasVideo ? 'Listening and looking at your answer' : 'Listening to your answer');
      try {
        const wav = await blobToWav(new Blob(chunks, { type: was.mimeType || 'audio/webm' }));
        if (wav.peak < 0.02) { done(); out.replaceChildren(errorBox('Your microphone recorded almost silence, so nothing was sent to the AI. Check that the right microphone is chosen in the browser (the icon next to the address bar) and in Windows sound settings, that it is not muted, then try again. The green bar should move while you talk.')); status.textContent = 'Ready.'; return; }
        const fd = new FormData(); fd.append('audio', wav, 'answer.wav'); fd.append('question', custom.value.trim() || sel.value); fd.append('consent', 'true'); fd.append('share', share.checked ? 'true' : 'false');
        fd.append('mode', wasVideo ? 'video' : 'voice');
        if (wasVideo) frames.slice(0, 8).forEach((b, i) => fd.append('frames', b, 'f' + i + '.jpg'));
        const r = await api('POST', '/student/interview', fd, true); done(); showResult(r);
      } catch (e) { done(); out.replaceChildren(errorBox(e.message)); status.textContent = 'Ready.'; }
    };
    rec.start(); recBtn.textContent = 'Stop and get feedback'; recBtn.classList.add('pulse');
    if (wasVideo) { setTimeout(snap, 1200); snapTimer = setInterval(snap, 3000); }
    timer = setInterval(() => { const s = Math.round((Date.now() - started) / 1000); status.textContent = (wasVideo ? 'Camera on, recording... ' : 'Recording... ') + s + 's'; if (s >= 120) rec && rec.stop(); }, 500);
  }, 'big');
  function showResult(r) {
    status.textContent = 'Ready.';
    out.replaceChildren(h('div', { class: 'slab', style: 'margin-top:20px' }, h('h3', {}, 'Your coaching feedback'), h('p', { style: 'margin-top:8px' }, r.feedback.summary), feedbackBits(r.feedback), note(r.note)));
  }
  page([{ label: 'Home', href: '#/s' }, { label: 'Interview practice' }], head('Interview practice', 'Answer out loud. An AI coach gives you tips.'),
    h('div', { class: 'slab' },
      h('div', { class: 'field' }, h('label', { for: 'iq' }, 'Pick a question'), sel), h('div', { class: 'field' }, h('label', { for: 'ic' }, 'Your own question (optional)'), custom),
      h('div', { class: 'field' }, h('label', {}, 'How do you want to practise?'),
        h('div', { class: 'row', style: 'gap:22px;flex-wrap:wrap' },
          h('label', { for: 'imode-voice', style: 'display:flex;gap:8px;align-items:center' }, modeVoice, 'Voice only'),
          h('label', { for: 'imode-video', style: 'display:flex;gap:8px;align-items:center' }, modeVideo, 'Video (camera + voice)'))),
      modeNote,
      h('label', { for: 'icons', style: 'display:flex;gap:10px;align-items:center;margin:12px 0' }, consent, consentText),
      h('label', { for: 'ishare', style: 'display:flex;gap:10px;align-items:center;margin-bottom:14px' }, share, 'Also show the feedback text to my teacher (optional). The teacher never gets the recording or pictures.'),
      preview,
      h('div', { class: 'row' }, recBtn, status), level, out),
    past.length ? h('div', { style: 'margin-top:30px' }, h('h2', { style: 'margin-bottom:12px' }, 'Earlier practice'), h('div', { class: 'list' }, past.map((p) => h('div', { class: 'slab' }, h('strong', {}, p.question), h('p', { style: 'margin-top:6px' }, p.feedback.summary),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'chip ' + (p.shared ? 'leaf' : '') }, p.shared ? 'Shared with teacher' : 'Private'), p.feedback.mode === 'video' ? h('span', { class: 'chip sun' }, 'Video practice') : null,
        btn(p.shared ? 'Stop sharing' : 'Share with teacher', 'ghost', async () => { try { await api('POST', `/student/interviews/${p.id}/share`, { shared: !p.shared }); route(); } catch (e) { toast(e.message, 'bad'); } }, 'small')))))) : null);
}

// ---------- study help ----------
async function studyList() {
  const d = await api('GET', '/student/home');
  page([{ label: 'Home', href: '#/s' }, { label: 'Study help' }], head('Study help', 'A short lesson, a printable sheet and links for each gap your teacher found.'),
    d.gaps.length ? h('div', { class: 'list' }, d.gaps.map((g) => h('a', { class: 'item', href: `#/s/study/${g.assessmentId}/${enc(g.signature)}` }, h('strong', { class: 'grow' }, g.name), h('span', { class: 'chip blue' }, 'Open'))))
      : empty('No gap found yet', 'When your teacher finds a mistake you repeat, help for it shows up here.'));
}
async function studyScreen(aid, sig) {
  const s = await api('POST', '/student/study', { assessmentId: aid, signature: sig });
  const L = s.lesson;
  page([{ label: 'Home', href: '#/s' }, { label: 'Study help', href: '#/s/study' }, { label: s.name }], head(s.name, s.explanation),
    h('div', { class: 'list' },
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:8px' }, 'Mini lesson (AI)'),
        L ? h('div', {}, h('p', { class: 'muted' }, 'Example: ' + L.example + ' = ' + L.answer + ' (answer worked out by the computer)'), h('ol', {}, L.steps.map((x) => h('li', {}, x))), L.tip ? h('p', { style: 'margin-top:8px' }, h('strong', {}, 'Tip: '), L.tip) : null,
          note('Written by AI. If a step does not make sense, ask your teacher.')) : h('p', { class: 'muted' }, s.lessonMessage || 'No lesson available.')),
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:8px' }, 'Printable practice sheet'), h('p', { class: 'muted small', style: 'margin-bottom:10px' }, 'New numbers every time. Answers are checked by the computer.'),
        link('Make a sheet to print', `#/s/sheet/${aid}/${enc(sig)}`, 'sun')),
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:4px' }, 'Learning resources'), h('p', { class: 'muted small', style: 'margin-bottom:8px' }, 'Found online using only the topic name.'),
        s.resources.resources.length ? h('div', { class: 'list' }, s.resources.resources.map((r) => h('a', { class: 'item', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, h('div', {}, h('strong', {}, r.title), r.summary ? h('p', { class: 'muted small' }, r.summary) : null)))) : h('p', { class: 'muted' }, s.resources.message || 'No resources found.'))));
}
async function studentPrint(aid, sig) {
  const s = await api('POST', '/student/sheet', { assessmentId: aid, signature: sig });
  sheetPage([{ label: 'Home', href: '#/s' }, { label: 'Study help', href: `#/s/study/${aid}/${enc(sig)}` }, { label: 'Print' }], s, false);
}

// ---------- routes ----------
const dec = (f) => (a, sig) => f(a, decodeURIComponent(sig));
GM.routes.push(
  [/^\/t\/c\/(\d+)\/quizzes$/, quizzesScreen, 'teacher'],
  [/^\/t\/q\/(\d+)$/, quizScreen, 'teacher'],
  [/^\/t\/c\/(\d+)\/participation$/, participationScreen, 'teacher'],
  [/^\/t\/a\/(\d+)\/print\/(.+)$/, dec(teacherPrint), 'teacher'],
  [/^\/s$/, hub, 'student'],
  [/^\/s\/quizzes$/, quizzesStudent, 'student'],
  [/^\/s\/quiz\/(\d+)$/, quizStudent, 'student'],
  [/^\/s\/homework$/, homeworkList, 'student'],
  [/^\/s\/homework\/(\d+)$/, homeworkScreen, 'student'],
  [/^\/s\/interview$/, interviewScreen, 'student'],
  [/^\/s\/study$/, studyList, 'student'],
  [/^\/s\/study\/(\d+)\/(.+)$/, dec(studyScreen), 'student'],
  [/^\/s\/sheet\/(\d+)\/(.+)$/, dec(studentPrint), 'student'],
);
GM.start();
})();
