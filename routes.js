// All HTTP routes in one file. Every response is plain JSON; errors are { error: "message" }.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const auth = require('./services/auth');
const core = require('./services/core');
const engine = require('./services/engine');
const gemini = require('./services/gemini');
const extras = require('./services/extras');
const studyai = require('./services/studyai');
const choice = require('./services/choice');
const alerts = require('./services/alerts');
const reports = require('./services/reports');
const contacts = require('./services/contacts');
const summary = require('./services/summary');
const chat = require('./services/chat');
const family = require('./services/family');
const features = require('./services/features');
const notify = require('./services/notify');

const defaultAi = { configured: gemini.configured, readSheetTwice: engine.readSheetTwice, describeRule: engine.describeRuleWithAI, tips: engine.teachingTipsWithAI, hint: engine.hintWithAI,
  quiz: studyai.quizWithAI, lesson: studyai.lessonWithAI, conceptLesson: studyai.conceptLessonWithAI, interview: studyai.interviewWithAI, readChoiceSheetTwice: studyai.readChoiceSheetTwice };

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const MIMES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, 'sheet-' + crypto.randomBytes(8).toString('hex') + (MIMES[file.mimetype] || '')),
  }),
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => (MIMES[file.mimetype] ? cb(null, true) : cb(new auth.HttpError(400, 'Only JPG, PNG, WEBP or PDF files are allowed.'))),
});

// Interview recordings: audio only, small, deleted right after analysis (see extras.submitInterview)
const AUDIO = { 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg' };
// Video mode also sends a few small JPEG snapshots (field "frames"). The server never stores a video.
const uploadAudio = multer({
  storage: multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => cb(null, (file.fieldname === 'frames' ? 'frame-' : 'audio-') + crypto.randomBytes(8).toString('hex') + (file.fieldname === 'frames' ? '.jpg' : AUDIO[file.mimetype] || '')) }),
  limits: { fileSize: 8 * 1024 * 1024, files: 9 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'frames') return file.mimetype === 'image/jpeg' ? cb(null, true) : cb(new auth.HttpError(400, 'Camera pictures must be JPEG.'));
    return AUDIO[file.mimetype] ? cb(null, true) : cb(new auth.HttpError(400, 'Recording must be WAV, MP3 or OGG audio.'));
  },
}).fields([{ name: 'audio', maxCount: 1 }, { name: 'frames', maxCount: 8 }]);
const csv = (res, f) => { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`); res.send(f.text); };

function buildRouter(ai = defaultAi) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
  // Same as wrap, but if the request fails the uploaded photo is deleted (no leftover pictures of children's work).
  const wrapFile = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); })
    .catch((e) => { [req.file, ...(req.files ? Object.values(req.files).flat() : [])].forEach((f) => f && core.forget(f.path)); next(e); });
  const teacher = auth.requireRole('teacher'), student = auth.requireRole('student'), parent = auth.requireRole('parent');
  const id = (req, name = 'id') => parseInt(req.params[name], 10);

  // ----- health and presets -----
  r.get('/health', (req, res) => res.json({ ok: true, aiReading: ai.configured(), tinyfish: Boolean((process.env.TINYFISH_API_KEY || '').trim()) }));
  r.get('/presets', teacher, (req, res) => res.json(core.PRESETS));

  // ----- sign in -----
  r.post('/auth/signup', wrap((req) => {   // teachers only; students get their login from the teacher
    auth.createUser({ ...req.body, role: 'teacher' });
    return auth.login(req.body.username, req.body.password, 'teacher');
  }));
  r.post('/auth/login', wrap((req) => auth.login(req.body.username, req.body.password, req.body.role)));
  r.post('/auth/logout', auth.requireRole(), wrap((req) => { auth.logout(req.token); return { ok: true }; }));
  r.get('/me', auth.requireRole(), (req, res) => res.json(auth.publicUser(req.user)));

  // ----- teacher: classes and students -----
  r.get('/classes', teacher, wrap((req) => core.listClasses(req.user)));
  r.post('/classes', teacher, wrap((req) => core.createClass(req.user, req.body.name)));
  r.get('/classes/:id/students', teacher, wrap((req) => core.listStudents(req.user, id(req))));
  r.post('/classes/:id/students', teacher, wrap((req) => core.addStudent(req.user, id(req), req.body)));
  r.post('/students/:id/set-pin', teacher, wrap((req) => core.setPin(req.user, id(req), req.body.pin)));
  r.post('/samples/class', teacher, wrap((req) => core.createSampleClass(req.user, ai)));
  r.post('/students/:id/reset-pin', teacher, wrap((req) => core.resetPin(req.user, id(req))));
  r.get('/classes/:id/history', teacher, wrap((req) => core.classHistory(req.user, id(req))));

  // ----- teacher: assessments -----
  r.get('/classes/:id/assessments', teacher, wrap((req) => core.listAssessments(req.user, id(req))));
  r.post('/classes/:id/assessments', teacher, wrap((req) => core.createAssessment(req.user, id(req), req.body)));
  r.get('/assessments/:id', teacher, wrap((req) => core.getAssessment(req.user, id(req))));

  // upload a sheet (JPG/PNG/WEBP/PDF, camera photo is just a JPG) -> two reads -> draft for the teacher to check
  r.post('/assessments/:id/sheets', teacher, upload.single('file'), wrapFile((req) =>
    core.readSubmission(req.user, ai, id(req), parseInt(req.body.studentId, 10), req.file)));
  // typed answers, no sheet
  r.post('/assessments/:id/typed', teacher, wrap((req) =>
    core.manualSubmission(req.user, ai, id(req), parseInt(req.body.studentId, 10), req.body.answers)));
  // teacher accepts or corrects the draft -> check, verify, save
  r.post('/sheets/:id/confirm', teacher, wrap((req) => core.confirmSubmission(req.user, ai, id(req), req.body.answers || {})));
  r.get('/sheets/:id', teacher, wrap((req) => core.getSheet(req.user, id(req))));
  r.get('/sheets/:id/file', teacher, (req, res, next) => {
    try { const f = core.submissionFile(req.user, id(req)); res.type(f.mime).sendFile(path.resolve(f.path)); } catch (e) { next(e); }
  });

  // ----- teacher: results, groups, kit -----
  r.get('/assessments/:id/report', teacher, wrap((req) => core.getReport(req.user, id(req))));
  r.get('/assessments/:id/overview', teacher, wrap((req) => core.getOverview(req.user, id(req))));
  r.post('/assessments/:id/kit/tips', teacher, wrap((req) => core.getTips(req.user, ai, id(req), req.body.signature)));
  r.post('/assessments/:id/groups/rename', teacher, wrap((req) => core.renameGroup(req.user, id(req), req.body.signature, req.body.name)));
  r.post('/assessments/:id/kit', teacher, wrap((req) => core.getKit(req.user, id(req), req.body.signature)));
  r.post('/assessments/:id/practice/assign', teacher, wrap((req) => core.assignPractice(req.user, id(req), req.body.signature)));

  // ----- student portal -----
  r.get('/student/home', student, wrap((req) => core.studentHome(req.user)));
  r.post('/student/change-pin', student, wrap((req) => core.changeOwnPin(req.user, req.body.oldPin, req.body.newPin)));
  r.post('/student/practice/new', student, wrap((req) => core.newPractice(req.user, parseInt(req.body.assessmentId, 10), req.body.signature)));
  r.post('/student/practice/:id/hint', student, wrap((req) => core.practiceHint(req.user, ai, id(req), req.body.number)));
  r.get('/student/practice/:id', student, wrap((req) => core.getPractice(req.user, id(req))));
  r.post('/student/practice/:id/submit', student, wrap((req) => core.submitPractice(req.user, id(req), req.body.answers)));

  // ----- Milestone 5: teacher -----
  r.get('/classes/:id/quizzes', teacher, wrap((req) => extras.listQuizzes(req.user, id(req))));
  r.post('/classes/:id/quizzes', teacher, wrap((req) => extras.createQuiz(req.user, ai, id(req), req.body)));
  r.get('/quizzes/:id', teacher, wrap((req) => extras.getQuiz(req.user, id(req))));
  r.get('/quizzes/:id/participation', teacher, wrap((req) => extras.quizParticipation(req.user, id(req))));
  r.post('/quizzes/:id/remove-question', teacher, wrap((req) => extras.removeQuizQuestion(req.user, id(req), req.body.number)));
  r.post('/quizzes/:id/publish', teacher, wrap((req) => extras.publishQuiz(req.user, id(req))));
  r.post('/quizzes/:id/close', teacher, wrap((req) => extras.closeQuiz(req.user, id(req))));

  // ----- teacher: multiple-choice PAPER tests (any subject). The teacher enters each student's sheet; code marks it. -----
  r.post('/classes/:id/paper-tests', teacher, wrap((req) => choice.createPaperTest(req.user, ai, id(req), req.body)));
  r.post('/quizzes/:id/sheet', teacher, upload.single('file'), wrapFile((req) => choice.readPaperSheet(req.user, ai, id(req), parseInt(req.body.studentId, 10), req.file)));
  r.post('/quizzes/:id/sheet/typed', teacher, wrap((req) => choice.typedPaperSheet(req.user, id(req), parseInt(req.body.studentId, 10), req.body.letters)));
  r.post('/paper-sheets/:id/confirm', teacher, wrap((req) => choice.confirmPaperSheet(req.user, id(req), req.body.answers || {})));
  r.get('/paper-sheets/:id', teacher, wrap((req) => choice.getPaperSheet(req.user, id(req))));
  r.get('/paper-sheets/:id/file', teacher, (req, res, next) => {
    try { const f = choice.paperSheetFile(req.user, id(req)); res.type(f.mime).sendFile(path.resolve(f.path)); } catch (e) { next(e); }
  });
  r.get('/quizzes/:id/student/:studentId', teacher, wrap((req) => choice.attemptView(req.user, id(req), id(req, 'studentId'))));
  r.post('/quizzes/:id/practice-quiz', teacher, wrap((req) => choice.groupPracticeQuiz(req.user, ai, id(req), req.body.tag, { includeSuspected: Boolean(req.body.includeSuspected) })));
  r.get('/classes/:id/engagement', teacher, wrap((req) => extras.engagement(req.user, id(req))));
  r.get('/classes/:id/engagement.csv', teacher, (req, res, next) => { try { csv(res, extras.engagementCsv(req.user, id(req))); } catch (e) { next(e); } });
  r.get('/classes/:id/interviews', teacher, wrap((req) => extras.classInterviews(req.user, id(req))));
  r.get('/assessments/:id/results.csv', teacher, (req, res, next) => { try { csv(res, extras.assessmentCsv(req.user, id(req))); } catch (e) { next(e); } });
  r.post('/assessments/:id/sheet', teacher, wrap((req) => extras.teacherSheet(req.user, id(req), req.body.signature)));

  // ----- Milestone 5: student -----
  r.get('/student/progress', student, wrap((req) => extras.studentProgress(req.user)));
  r.get('/student/quizzes', student, wrap((req) => extras.studentQuizzes(req.user)));
  r.post('/student/quizzes/self', student, wrap((req) => extras.selfQuiz(req.user, ai, req.body)));
  r.get('/student/quizzes/:id', student, wrap((req) => extras.getQuizForStudent(req.user, id(req))));
  r.post('/student/quizzes/:id/help', student, wrap((req) => extras.conceptHelp(req.user, ai, id(req), req.body.tag)));
  r.post('/student/quizzes/:id/submit', student, wrap((req) => extras.submitQuiz(req.user, id(req), req.body.answers)));
  r.get('/student/homework', student, wrap((req) => extras.listHomework(req.user)));
  r.get('/student/homework/:id', student, wrap((req) => extras.homeworkDetail(req.user, id(req))));
  r.post('/student/homework/:id/typed', student, wrap((req) => extras.homeworkTyped(req.user, ai, id(req), req.body.answers)));
  r.post('/student/homework/:id/photo', student, upload.single('file'), wrapFile((req) => extras.homeworkPhoto(req.user, ai, id(req), req.file)));
  r.post('/student/homework/draft/:id/confirm', student, wrap((req) => extras.homeworkConfirm(req.user, ai, id(req), req.body.answers)));
  r.get('/student/interview/questions', student, (req, res) => res.json(extras.INTERVIEW_QUESTIONS));
  r.post('/student/interview', student, uploadAudio, wrap((req) => extras.submitInterview(req.user, ai, req.body, (req.files?.audio || [])[0], req.files?.frames || [])));
  r.get('/student/interviews', student, wrap((req) => extras.myInterviews(req.user)));
  r.post('/student/interviews/:id/share', student, wrap((req) => extras.shareInterview(req.user, id(req), req.body.shared === true || req.body.shared === 'true')));
  r.post('/student/study', student, wrap((req) => extras.studyHelp(req.user, ai, parseInt(req.body.assessmentId, 10), req.body.signature)));
  r.post('/student/sheet', student, wrap((req) => extras.studentSheet(req.user, parseInt(req.body.assessmentId, 10), req.body.signature)));

  // ----- family: parent logins, attendance, notices (teacher) -----
  r.get('/students/:id/parents', teacher, wrap((req) => family.listParents(req.user, id(req))));
  r.post('/students/:id/parents', teacher, wrap((req) => family.addParent(req.user, id(req), req.body || {})));
  r.post('/students/:id/parents/:userId/reset', teacher, wrap((req) => family.resetParentPassword(req.user, id(req), id(req, 'userId'))));
  r.delete('/students/:id/parents/:userId', teacher, wrap((req) => family.unlinkParent(req.user, id(req), id(req, 'userId'))));
  r.get('/classes/:id/attendance', teacher, wrap((req) => family.attendanceDay(req.user, id(req), req.query.date)));
  r.post('/classes/:id/attendance', teacher, wrap((req) => family.markAttendance(req.user, id(req), req.body.date, req.body.marks)));
  r.get('/classes/:id/attendance-summary', teacher, wrap((req) => family.attendanceSummary(req.user, id(req))));
  r.get('/classes/:id/attendance.csv', teacher, (req, res, next) => { try { csv(res, family.attendanceCsv(req.user, id(req))); } catch (e) { next(e); } });
  r.get('/classes/:id/notices', teacher, wrap((req) => family.listNotices(req.user, id(req))));
  r.post('/classes/:id/notices', teacher, wrap((req) => family.postNotice(req.user, id(req), req.body || {})));
  r.delete('/notices/:id', teacher, wrap((req) => family.deleteNotice(req.user, id(req))));

  // ----- family: parent portal (a parent sees only their own linked children) -----
  r.get('/parent/children', parent, wrap((req) => family.children(req.user)));
  r.get('/parent/children/:id', parent, wrap((req) => family.childReport(req.user, id(req))));
  r.post('/parent/children/:id/message', parent, wrap((req) => family.sendMessage(req.user, id(req), req.body.body)));
  r.post('/parent/change-password', parent, wrap((req) => auth.changePassword(req.user, req.body.oldPassword, req.body.newPassword)));

  // ----- family: what the student sees -----
  r.get('/student/notices', student, wrap((req) => family.studentNotices(req.user)));
  r.get('/student/attendance', student, wrap((req) => family.studentAttendance(req.user)));

  // ----- notifications (every role sees only its own rows) -----
  const anyone = auth.requireRole();
  // ----- class settings and the Alert centre (teacher) -----
  r.get('/classes/:id/settings', teacher, wrap((req) => alerts.getSettings(req.user, id(req))));
  r.put('/classes/:id/settings', teacher, wrap((req) => alerts.putSettings(req.user, id(req), req.body || {})));
  r.get('/classes/:id/alerts', teacher, wrap((req) => alerts.listAlerts(req.user, id(req), req.query.status)));
  r.post('/classes/:id/alerts/preview', teacher, wrap((req) => alerts.previewAlerts(req.user, id(req), (req.body || {}).overrides || {})));
  r.post('/classes/:id/alerts/run', teacher, wrap((req) => alerts.runNow(req.user, id(req))));
  r.put('/alerts/:id', teacher, wrap((req) => alerts.updateAlert(req.user, id(req), req.body || {})));

  // ----- contact numbers (consent first: a number is shown to the other side only if its owner switched sharing on) -----
  r.get('/me/contact', anyone, wrap((req) => contacts.getMine(req.user)));
  r.put('/me/contact', anyone, wrap((req) => contacts.putMine(req.user, req.body || {})));
  r.get('/parent/children/:id/summary', parent, wrap((req) => summary.summaryFor(req.user, id(req), req.query || {})));
  r.post('/parent/children/:id/chat', parent, wrap((req) => chat.chatFor(req.user, id(req), req.body || {}, ai)));
  r.get('/parent/summary', parent, wrap((req) => summary.summaryAll(req.user, req.query || {})));
  r.get('/parent/children/:id/teacher-contact', parent, wrap((req) => contacts.forParent(req.user, id(req))));
  r.get('/classes/:id/contacts', teacher, wrap((req) => contacts.forTeacherClass(req.user, id(req))));

  // ----- report cards (teacher: own class, student: own, parent: own children; anyone else gets 404) -----
  const anyRole = auth.requireRole();
  const scopeQ = (req) => ({ scope: req.query.scope, from: req.query.from, to: req.query.to });
  r.get('/reports/student/:id', anyRole, wrap((req) => reports.getReport(req.user, id(req), scopeQ(req))));
  r.put('/reports/student/:id/remarks', anyRole, wrap((req) => reports.putRemarks(req.user, id(req), scopeQ(req), (req.body || {}).text)));
  r.post('/reports/student/:id/seen', anyRole, wrap((req) => reports.markSeen(req.user, id(req), scopeQ(req))));
  r.get('/classes/:id/reports', teacher, wrap((req) => reports.classReports(req.user, id(req), scopeQ(req))));
  r.get('/classes/:id/charts', teacher, wrap((req) => reports.classCharts(req.user, id(req), scopeQ(req))));
  r.get('/classes/:id/reports.csv', teacher, (req, res, next) => { try { csv(res, reports.classCsv(req.user, id(req), scopeQ(req))); } catch (e) { next(e); } });
  r.get('/notifications', anyone, wrap((req) => notify.list(req.user, { limit: req.query.limit })));
  r.get('/notifications/unread-count', anyone, wrap((req) => ({ unread: notify.unreadCount(req.user) })));
  r.post('/notifications/read', anyone, wrap((req) => notify.markRead(req.user, req.body || {})));
  r.get('/notifications/prefs', anyone, wrap((req) => notify.getPrefs(req.user)));
  r.put('/notifications/prefs', anyone, wrap((req) => notify.setPrefs(req.user, (req.body || {}).muted)));
  r.get('/classes/:id/sent-notifications', teacher, wrap((req) => notify.sentLog(req.user, id(req))));

  // ----- step 6: leave requests, read receipts, meeting slots -----
  r.post('/parent/children/:id/leave', parent, wrap((req) => features.requestLeave(req.user, id(req), req.body || {})));
  r.get('/parent/children/:id/leave', parent, wrap((req) => features.myLeaves(req.user, id(req))));
  r.delete('/parent/children/:id/leave/:leaveId', parent, wrap((req) => features.cancelLeave(req.user, id(req), id(req, 'leaveId'))));
  r.get('/classes/:id/leave', teacher, wrap((req) => features.classLeaves(req.user, id(req), req.query.status)));
  r.post('/leave/:id/decision', teacher, wrap((req) => features.decideLeave(req.user, id(req), (req.body || {}).decision)));
  r.post('/parent/notices/:id/seen', parent, wrap((req) => features.markNoticeSeen(req.user, id(req))));
  r.get('/classes/:id/meetings', teacher, wrap((req) => features.listSlots(req.user, id(req))));
  r.post('/classes/:id/meetings', teacher, wrap((req) => features.postSlots(req.user, id(req), req.body || {})));
  r.delete('/meetings/:id', teacher, wrap((req) => features.removeSlot(req.user, id(req))));
  r.get('/parent/children/:id/meetings', parent, wrap((req) => features.slotsForParent(req.user, id(req))));
  r.post('/parent/children/:id/meetings/:slotId/book', parent, wrap((req) => features.bookSlot(req.user, id(req), id(req, 'slotId'))));
  r.delete('/parent/children/:id/meetings/:slotId', parent, wrap((req) => features.cancelBooking(req.user, id(req), id(req, 'slotId'))));

  r.get('/student/calendar', student, wrap((req) => features.studentUpcoming(req.user)));
  r.get('/parent/children/:id/calendar', parent, wrap((req) => features.parentUpcoming(req.user, id(req))));
  r.get('/classes/:id/alerts.csv', teacher, (req, res, next) => { try { csv(res, features.alertsCsv(req.user, id(req))); } catch (e) { next(e); } });
  r.get('/classes/:id/sent-notifications.csv', teacher, (req, res, next) => { try { csv(res, features.notificationsCsv(req.user, id(req))); } catch (e) { next(e); } });

  r.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  r.use((err, req, res, next) => {
    // AI problems (quota, key, network...) carry a plain-language message: show it instead of a vague server error
    if (err && err.reason && !err.status && err.name !== 'HttpError') { console.error('[ai]', req.method, req.url, err.reason); return res.status(503).json({ error: err.message }); }
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
    if (status === 500) console.error('[error]', req.method, req.url, err.message);
    res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message });
  });
  return r;
}

module.exports = { buildRouter };
