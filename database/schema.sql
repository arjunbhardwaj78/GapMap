PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher','student','parent')),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  student_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
-- A student is a display name / roll number chosen by the teacher. Never sent to Gemini or TinyFish.
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  roll TEXT
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  questions_json TEXT NOT NULL,        -- [{id:"Q1", expression:"1/2+1/3"}]
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- One sheet per student per assessment. status: read (waiting for teacher) | final
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  file_path TEXT,
  mime_type TEXT,
  read_a_json TEXT,
  read_b_json TEXT,
  status TEXT NOT NULL DEFAULT 'read',
  result_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (assessment_id, student_id)
);
-- Teacher-chosen names for a pattern (signature = the verified rule text)
CREATE TABLE IF NOT EXISTS group_names (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (assessment_id, signature)
);
CREATE TABLE IF NOT EXISTS practice_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  title TEXT NOT NULL,
  questions_json TEXT NOT NULL,        -- [{number, expression, prompt, answer}] answers computed by code
  score INTEGER,
  total INTEGER,
  attempt_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- AI teaching ideas per group (text only, written from the group name and explanation, never student data)
CREATE TABLE IF NOT EXISTS group_tips (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  tips_json TEXT NOT NULL,
  PRIMARY KEY (assessment_id, signature)
);

-- ===== Milestone 5 =====
-- Quizzes. student_id NULL = teacher quiz for the whole class. student_id set = private practice quiz a student made for themselves.
CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  questions_json TEXT NOT NULL,        -- calc: {number,type,expression,prompt,answer(code)}  mcq: {number,type,text,options,correct}
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quiz_id, student_id)
);
-- Interview practice: only the AI feedback is kept. The audio is deleted right after it is analysed.
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  feedback_json TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,   -- 1 = the student chose to show this to the teacher
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Study help caches (topic only, no student data)
CREATE TABLE IF NOT EXISTS resource_cache (topic TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS gap_lessons (key TEXT PRIMARY KEY, json TEXT NOT NULL);

-- ===== Milestone 10: multiple-choice paper tests =====
-- One row per student per paper test: the photo/PDF (optional) and the two AI reads of the circled letters.
CREATE TABLE IF NOT EXISTS paper_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  file_path TEXT,
  mime_type TEXT,
  read_a_json TEXT,
  read_b_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft (teacher still checking) | final
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quiz_id, student_id)
);

-- ===== Family / school features =====
-- A parent or guardian login linked to one or more students (brothers and sisters share one login).
CREATE TABLE IF NOT EXISTS parent_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'Parent',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, student_id)
);
-- One mark per student per day. present | absent | late | leave
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                      -- YYYY-MM-DD (India time)
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','leave')),
  UNIQUE (student_id, day)
);
-- Notice board. student_id NULL = whole class. kind: notice | praise | concern | from_parent
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'notice',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ===== Milestone 12: notifications =====
-- One row per recipient user (a student, a parent or a teacher). The same event never notifies the same user twice (dedupe_key).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,   -- which child it is about (a parent may have several)
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,                                                      -- hash route such as #/s/quizzes or #/p/c/12
  event_key TEXT NOT NULL,                                        -- the event itself (same for every recipient): used to group a teacher's log
  dedupe_key TEXT NOT NULL,                                       -- event_key + child, so a parent of two children gets one message per child
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, read_at, id);
-- Parents (and students) may mute LOW-priority types. Important types (alerts, missed items) can never be muted.
CREATE TABLE IF NOT EXISTS notif_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted_json TEXT NOT NULL DEFAULT '[]'
);
-- Honest extension point for SMS / WhatsApp / email. Only the "console" dry-run adapter exists: it records a row and sends nothing.
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  to_user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,                                           -- dry-run | sent | failed
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ===== Milestone 12 step 2: class settings and alerts =====
-- Thresholds and the academic year for one class. The JSON holds the FULL settings object (defaults filled in by code).
CREATE TABLE IF NOT EXISTS class_settings (
  class_id INTEGER PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- One row per alert that was really sent (dry-run previews write nothing). numbers_json = the numbers behind it, text = what the teacher reads.
CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  numbers_json TEXT NOT NULL DEFAULT '{}',
  severity REAL NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','done')),
  note TEXT,
  sent_on TEXT NOT NULL,                  -- YYYY-MM-DD (India time)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  seen_at TEXT,
  sent_students INTEGER NOT NULL DEFAULT 0,
  sent_parents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_log_student_type ON alert_log (student_id, type, id);

-- ===== Milestone 12: report remarks =====
-- One teacher remark per student per report scope (till / year / term1 / term2 / custom:from:to). seen_on = day a parent tapped "I have seen this report".
CREATE TABLE IF NOT EXISTS report_remarks (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  seen_on TEXT,
  PRIMARY KEY (student_id, scope_key)
);

-- Milestone 12 step 5: optional contact numbers. Digits only (10-digit Indian mobile, no +91). share = 0 by default.
-- A number is shown to the other side ONLY when its owner switched sharing on. Never shown to students, other families or printed reports.
CREATE TABLE IF NOT EXISTS contact_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  share INTEGER NOT NULL DEFAULT 0,
  preferred_time TEXT,
  language TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ===== Milestone 12 step 6: leave requests, notice read receipts, meeting slots =====
-- A parent asks for leave for a date range; the teacher approves or rejects. Approved days are marked "leave" in attendance.
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_day TEXT NOT NULL,
  to_day TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_student ON leave_requests (student_id, status);
-- "I have seen this": one row per parent per notice.
CREATE TABLE IF NOT EXISTS notice_seen (
  notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notice_id, user_id)
);
-- Parent-teacher meeting slots. student_id NULL = free; a parent books one slot per child.
CREATE TABLE IF NOT EXISTS meeting_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                 -- YYYY-MM-DD
  start_time TEXT NOT NULL,          -- HH:MM (India time)
  minutes INTEGER NOT NULL DEFAULT 10,
  note TEXT NOT NULL DEFAULT '',
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  booked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (class_id, day, start_time)
);

CREATE TABLE IF NOT EXISTS chat_use (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
