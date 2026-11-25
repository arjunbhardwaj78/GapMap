/* GapMap Milestone 10 frontend: multiple-choice PAPER tests (any subject).
   Loaded after app.js and BEFORE extras.js (extras.js calls GM.start()). All server text goes in with h() (textContent), never innerHTML.
   The teacher enters each student's sheet (photo, camera, PDF, or typed letters). The computer marks it. The AI never marks. */
(() => {
'use strict';
const GM = window.GM;
const { h, api, state, toast, busy, btn, link, page, head, empty, errorBox, icon, route, modal } = GM;
const LETTER = ['A', 'B', 'C', 'D'];
const T = (cid) => [{ label: 'Classes', href: '#/t' }, { label: 'Class', href: '#/t/c/' + cid }];
const enc = encodeURIComponent;

// ---------- the Tests page: list of this class's paper tests ----------
GM.paperTestsBlock = async (cid) => {
  try {
    const all = await api('GET', `/classes/${cid}/quizzes`);
    const list = all.filter((q) => q.mode === 'paper');
    if (!list.length) return null;
    return h('div', { style: 'margin-top:26px' }, h('h2', { style: 'margin-bottom:12px' }, 'Multiple-choice paper tests'),
      h('div', { class: 'list' }, list.map((q) => h('a', { class: 'item', href: '#/t/q/' + q.id }, h('div', { class: 'grow' }, h('strong', {}, q.title), h('p', { class: 'muted small' }, (q.subject ? q.subject + ': ' : '') + q.topic)),
        h('span', { class: 'chip ' + (q.status === 'published' ? 'leaf' : q.status === 'draft' ? 'sun' : '') }, q.status === 'draft' ? 'Draft' : q.status === 'published' ? 'Open' : 'Closed'),
        q.status !== 'draft' ? h('span', { class: 'chip blue' }, `${q.attempted} of ${q.students} sheets entered`) : null))));
  } catch (e) { return null; }
};

// ---------- builder ----------
async function builder(cid, subjectName) {
  const title = h('input', { id: 'pt', placeholder: 'e.g. Cells check', value: '' });
  const subject = h('input', { id: 'ps', list: 'pSubjList', placeholder: 'e.g. Science', value: subjectName ? decodeURIComponent(subjectName) : '' });
  const block = h('textarea', { id: 'pm', rows: 12, placeholder: 'Which part of the cell makes energy?\n*Mitochondria\nNucleus | Thinks the nucleus does every job\nRibosome | Mixes up making protein with making energy\nChloroplast\n\n(blank line, then the next question)' });
  const aiLevel = h('input', { id: 'pl', placeholder: 'e.g. Class 7' });
  const aiCount = h('input', { id: 'pc', type: 'number', min: 1, max: 10, value: 5, style: 'max-width:90px' });
  const err = h('div');
  const make = async (body, msg) => {
    const done = busy(msg);
    try { const q = await api('POST', `/classes/${cid}/paper-tests`, body); done(); GM.setNote && GM.setNote(q.note || null); toast('Draft paper test ready to check', 'ok'); location.hash = '#/t/q/' + q.id; }
    catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  };
  page([...T(cid), { label: 'Tests', href: `#/t/c/${cid}/tests` }, { label: 'New multiple-choice test' }],
    head('New multiple-choice test', 'Any subject. Students answer on paper. You check the answer key, then add each student\'s sheet.'),
    h('div', { class: 'slab' }, err,
      h('div', { class: 'field' }, h('label', { for: 'pt' }, 'Test name'), title),
      h('div', { class: 'field' }, h('label', { for: 'ps' }, 'Subject'), subject, h('datalist', { id: 'pSubjList' }, ['Science', 'Biology', 'Physics', 'Chemistry', 'Social Science', 'History', 'Geography', 'English', 'Hindi', 'Computer Science', 'Maths'].map((x) => h('option', { value: x })))),
      h('h3', { style: 'margin:14px 0 6px' }, 'Type your questions (no AI needed)'),
      h('p', { class: 'hint' }, 'Line 1: the question. Next 4 lines: the options, in the same order as on your paper (A, B, C, D). Put * in front of the correct one. After a | write the mistaken idea a student has if they pick that option (optional, but it is what lets the computer find patterns). Leave a blank line between questions. Use the exact same wording when two questions share the same mistaken idea.'),
      h('div', { class: 'field' }, h('label', { for: 'pm' }, 'Questions'), block),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Make the draft', 'blue', () => make({ topic: title.value || subject.value || 'Paper test', title: title.value || undefined, subject: subject.value, typedMcq: block.value }, 'Making the draft'), 'big')),
      h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:22px 0' }),
      h('h3', { style: 'margin-bottom:6px' }, 'Or let the AI draft the questions'),
      h('p', { class: 'hint' }, 'Uses the test name as the topic. The AI-written answer key and mistaken-idea names can be wrong, so check every one before you publish.'),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'pl' }, 'Level'), aiLevel), h('div', { class: 'field' }, h('label', { for: 'pc' }, 'How many questions (1 to 10)'), aiCount)),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Draft with AI', 'plum', () => make({ topic: title.value, title: title.value || undefined, subject: subject.value, level: aiLevel.value, count: aiCount.value }, 'Drafting the questions'), 'big'))));
}

// ---------- printable question paper (no answer key) ----------
async function printPaper(qid) {
  const q = await api('GET', '/quizzes/' + qid);
  page([...T(q.classId), { label: q.title, href: '#/t/q/' + qid }, { label: 'Question paper' }],
    h('div', { class: 'noprint' }, head('Question paper', 'Print this and give it to the students. It has no answer key.', h('div', { class: 'row' }, btn('Print', 'blue', () => window.print(), 'small')))),
    h('div', { class: 'slab' }, h('h2', {}, q.title), q.subject ? h('p', { class: 'muted' }, q.subject) : null,
      h('p', { class: 'small', style: 'margin:8px 0 14px' }, 'Name: ____________________    Roll no: ________    Circle one letter for each question.'),
      q.questions.filter((x) => x.type === 'mcq').map((x) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, x.number),
        h('div', { class: 'grow' }, h('span', { class: 'expr' }, x.text), h('div', { style: 'margin-top:6px' }, x.options.map((o, i) => h('div', { style: 'margin:4px 0;white-space:pre-wrap' }, LETTER[i] + '.  ' + o))))))));
}

// ---------- pick a student ----------
async function pickStudent(qid) {
  const [q, p] = await Promise.all([api('GET', '/quizzes/' + qid), api('GET', `/quizzes/${qid}/participation`)]);
  page([...T(q.classId), { label: q.title, href: '#/t/q/' + qid }, { label: 'Add a sheet' }], head('Whose sheet is it?', q.title),
    h('div', { class: 'list' }, p.students.map((s) => h('a', { class: 'item', href: `#/t/q/${qid}/sheet/${s.id}` }, h('strong', { class: 'grow' }, s.name),
      s.attempted ? h('span', { class: 'chip leaf' }, `Entered ${s.score}/${s.total}`) : h('span', { class: 'chip rose' }, 'Sheet not entered')))));
}

// ---------- add one student's sheet ----------
function cameraModal(onFile) {
  const video = h('video', { class: 'cam', autoplay: true, playsinline: true, muted: true });
  const err = h('div');
  let stream = null;
  const m = modal({ title: 'Take a photo of the sheet', onClose: () => stream && stream.getTracks().forEach((t) => t.stop()), body: h('div', {}, err, video, h('p', { class: 'hint' }, 'Hold the sheet flat, in good light, so every circled letter is in view.')),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Take photo', color: 'plum', onclick: (close) => {
      if (!stream) return;
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => { close(); onFile(new File([b], 'camera.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.9);
    } }] });
  navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => { stream = s; video.srcObject = s; }, () => err.replaceChildren(errorBox('The camera is blocked or not available. Allow camera access, or upload a photo instead.')));
  if (!navigator.mediaDevices) err.replaceChildren(errorBox('This browser cannot use the camera here. Upload a photo instead.'));
  return m;
}
async function sheetMethod(qid, sid) {
  const [q, p, health] = await Promise.all([api('GET', '/quizzes/' + qid), api('GET', `/quizzes/${qid}/participation`), api('GET', '/health')]);
  const st = p.students.find((s) => String(s.id) === String(sid));
  if (!st) { location.hash = `#/t/q/${qid}/sheet`; return; }
  const ai = health.aiReading;
  const err = h('div');
  const typedBox = h('div');
  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', style: 'display:none', onchange: () => { if (fileIn.files[0]) send(fileIn.files[0]); } });
  const send = async (file) => {
    const done = busy('Reading the sheet twice');
    try { const fd = new FormData(); fd.append('studentId', sid); fd.append('file', file); const d = await api('POST', `/quizzes/${qid}/sheet`, fd, true); done(); location.hash = '#/t/p/' + d.sheetId; }
    catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  };
  const letters = h('input', { id: 'lt', placeholder: 'e.g. BACDB', autocomplete: 'off', style: 'max-width:260px;letter-spacing:.2em;text-transform:uppercase' });
  const showTyped = () => {
    typedBox.replaceChildren(h('div', { class: 'slab', style: 'margin-top:18px' }, h('h3', { style: 'margin-bottom:6px' }, 'Type the letters'),
      h('p', { class: 'hint' }, `One letter per question, in order (${q.questions.length} questions). Use - for a question the student left blank.`),
      h('div', { class: 'field' }, h('label', { for: 'lt' }, 'Letters'), letters),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Mark it', 'leaf', async () => {
        const done = busy('Marking');
        try { await api('POST', `/quizzes/${qid}/sheet/typed`, { studentId: Number(sid), letters: letters.value }); done(); location.hash = `#/t/q/${qid}/student/${sid}`; }
        catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
      }, 'big'))));
    letters.focus();
  };
  page([...T(q.classId), { label: q.title, href: '#/t/q/' + qid }, { label: 'Add a sheet', href: `#/t/q/${qid}/sheet` }, { label: st.name }],
    head('How do you want to add it?', st.name + (st.attempted ? '. This will replace the earlier sheet.' : '')),
    ai ? null : h('div', { class: 'err' }, 'Sheet reading is not set up on this computer, so only typing is available. Add GEMINI_API_KEY to the .env file to turn it on.'), err,
    h('div', { class: 'grid' },
      h('button', { class: 'tile', disabled: !ai, onclick: () => fileIn.click() }, h('div', { class: 'ico blue' }, icon('upload')), h('h2', {}, 'Upload a photo or PDF'), h('p', { class: 'muted' }, 'JPG, PNG, WEBP or PDF, up to 10 MB')),
      h('button', { class: 'tile', disabled: !ai, onclick: () => cameraModal(send) }, h('div', { class: 'ico plum' }, icon('camera')), h('h2', {}, 'Take a photo'), h('p', { class: 'muted' }, 'Use this computer or phone camera')),
      h('button', { class: 'tile', onclick: showTyped }, h('div', { class: 'ico sun' }, icon('type')), h('h2', {}, 'Type the letters'), h('p', { class: 'muted' }, 'No photo needed'))),
    typedBox, fileIn);
}

// ---------- check the reading (draft) or show the result ----------
async function paperSheetScreen(sheetId) {
  const s = await api('GET', '/paper-sheets/' + sheetId);
  if (s.status === 'final') { location.hash = `#/t/q/${s.quizId}/student/${s.student.id}`; return; }
  const d = s.draft;
  const q = await api('GET', '/quizzes/' + d.quizId);
  const p = await api('GET', `/quizzes/${d.quizId}/participation`);
  const st = p.students.find((x) => x.id === d.studentId) || { name: 'Student' };
  const chosen = d.answers.map((a) => (a.value === null || a.value === undefined ? null : a.value));
  const rows = d.answers.map((a, i) => {
    const btns = [0, 1, 2, 3].map((k) => h('button', { type: 'button', class: 'lbtn', 'aria-label': 'Option ' + LETTER[k] }, LETTER[k]));
    const none = h('button', { type: 'button', class: 'lbtn none', 'aria-label': 'No answer' }, 'None');
    const refresh = () => { btns.forEach((b, k) => b.classList.toggle('on', chosen[i] === k)); none.classList.toggle('on', chosen[i] === null); };
    btns.forEach((b, k) => { b.onclick = () => { chosen[i] = k; refresh(); }; });
    none.onclick = () => { chosen[i] = null; refresh(); };
    refresh();
    return h('div', { class: 'qrow' + (a.agree ? '' : ' warn') }, h('div', { class: 'qno' }, a.number),
      h('div', { class: 'grow' }, h('span', { class: 'expr' }, a.text), h('div', { class: 'small muted', style: 'margin-top:4px' }, a.options.map((o, k) => LETTER[k] + ' ' + o).join('   ')),
        a.agree ? null : h('div', { class: 'note' }, 'The two readings differed (reading 1: ' + a.readA + ', reading 2: ' + a.readB + '). Look at the sheet and choose the letter yourself.')),
      h('div', { class: 'lgroup' }, btns, none));
  });
  const img = h('div');
  if (d.hasFile) {
    fetch(`/api/paper-sheets/${sheetId}/file`, { headers: { Authorization: 'Bearer ' + state.token } }).then((r) => r.ok ? r.blob() : null).then((b) => {
      if (!b) return; const url = URL.createObjectURL(b);
      img.replaceChildren(b.type === 'application/pdf' ? h('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn ghost small' }, 'Open the PDF') : h('img', { class: 'sheet-img', src: url, alt: 'The uploaded answer sheet' }));
    }).catch(() => {});
  }
  const flagged = d.answers.filter((a) => !a.agree).length;
  page([...T(q.classId), { label: q.title, href: '#/t/q/' + q.id }, { label: st.name }], head('Check the reading', `${st.name}. The sheet was read twice by the computer's reader.`),
    flagged ? h('div', { class: 'err' }, `${flagged} answer${flagged > 1 ? 's' : ''} could not be read the same way both times. They are left empty: please choose the letter you see on the sheet.`) : h('div', { class: 'chip leaf', style: 'margin-bottom:16px' }, 'Both readings agree on every answer'),
    h('div', { class: 'pair' }, h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:8px' }, 'Sheet'), img),
      h('div', { class: 'slab' }, rows)),
    h('div', { class: 'row', style: 'margin-top:26px;justify-content:flex-end' }, btn('Confirm and mark', 'leaf', async () => {
      const answers = {}; chosen.forEach((v, i) => { if (v !== null) answers[d.answers[i].number] = LETTER[v]; });
      const done = busy('Marking');
      try { await api('POST', `/paper-sheets/${sheetId}/confirm`, { answers }); done(); location.hash = `#/t/q/${d.quizId}/student/${d.studentId}`; }
      catch (e) { done(); toast(e.message, 'bad'); }
    }, 'big')));
}

// ---------- one student's result (teacher view) ----------
async function studentResult(qid, sid) {
  const r = await api('GET', `/quizzes/${qid}/student/${sid}`);
  const q = await api('GET', '/quizzes/' + qid);
  const d = r.problem;
  const img = h('div');
  if (r.sheetId && r.hasFile) {
    fetch(`/api/paper-sheets/${r.sheetId}/file`, { headers: { Authorization: 'Bearer ' + state.token } }).then((x) => x.ok ? x.blob() : null).then((b) => {
      if (!b) return; const url = URL.createObjectURL(b);
      img.replaceChildren(b.type === 'application/pdf' ? h('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn ghost small' }, 'Open the PDF') : h('img', { class: 'sheet-img', src: url, alt: 'The uploaded answer sheet' }));
    }).catch(() => {});
  }
  const paper = r.mode === 'paper';
  let problem;
  if (d.kind === 'none') problem = h('div', { class: 'slab' }, h('h3', {}, 'No mistakes'), h('p', { class: 'muted' }, 'Every answer was right.'));
  else if (d.kind === 'unclear') problem = h('div', { class: 'slab' }, h('h3', {}, 'Some answers were wrong, but no clear idea'),
    h('p', { class: 'muted', style: 'margin-top:6px' }, 'The wrong options picked (or blanks) do not point to a mistaken idea you recorded, so the computer will not guess. Needs teacher review.'));
  else problem = h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, d.kind === 'likely' ? 'Likely mistaken idea' : 'Suspected mistaken idea'),
    h('p', { class: 'small muted' }, 'Likely = picked in 2 or more questions. Suspected = picked once. This is consistent with the answers, not proof. It is only as good as the idea names you checked before publishing.'),
    h('div', { class: 'list', style: 'margin-top:10px' }, d.tags.map((t) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, t.name), h('p', { class: 'small muted' }, 'Questions: ' + t.questions.join(', '))),
      h('span', { class: 'chip ' + (t.level === 'likely' ? 'rose' : 'sun') }, t.level === 'likely' ? 'Likely' : 'Suspected')))));
  page([...T(q.classId), { label: r.title, href: '#/t/q/' + qid }, { label: r.student.name }],
    head(r.student.name, `${r.title}: ${r.score}/${r.total}`, h('div', { class: 'row' }, paper && q.status === 'published' ? link('Replace this sheet', `#/t/q/${qid}/sheet/${sid}`, 'ghost', 'small') : null)),
    r.hasFile ? h('div', { class: 'slab', style: 'margin-bottom:16px' }, h('h3', { style: 'margin-bottom:8px' }, 'The sheet'), img) : null,
    problem,
    h('div', { class: 'slab', style: 'margin-top:16px' }, r.questions.map((x) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, x.number),
      h('div', { class: 'grow' }, h('span', { class: 'expr' }, x.text),
        h('p', { class: 'small muted' }, x.yourIndex == null ? 'No answer. ' : `Chose ${LETTER[x.yourIndex]}: ${x.options[x.yourIndex]}. `, `Key ${LETTER[x.correctIndex]}: ${x.options[x.correctIndex]}`),
        x.yourTag ? h('p', { class: 'small' }, 'Looks like: ' + x.yourTag) : null),
      h('span', { class: 'chip ' + (x.correct ? 'leaf' : 'rose') }, x.correct ? 'Right' : 'Wrong')))),
    h('div', { class: 'row', style: 'margin-top:18px' }, link('Back to the test', '#/t/q/' + qid, 'leaf')));
}

GM.routes.push(
  [/^\/t\/c\/(\d+)\/paper\/new$/, builder, 'teacher'],
  [/^\/t\/c\/(\d+)\/paper\/new\/([^/]+)$/, builder, 'teacher'],
  [/^\/t\/q\/(\d+)\/print$/, printPaper, 'teacher'],
  [/^\/t\/q\/(\d+)\/sheet$/, pickStudent, 'teacher'],
  [/^\/t\/q\/(\d+)\/sheet\/(\d+)$/, sheetMethod, 'teacher'],
  [/^\/t\/p\/(\d+)$/, paperSheetScreen, 'teacher'],
  [/^\/t\/q\/(\d+)\/student\/(\d+)$/, studentResult, 'teacher'],
);
})();
