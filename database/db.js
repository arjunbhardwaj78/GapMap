const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'gapmap.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const raw = new DatabaseSync(dbPath);
raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Older database files lack the newer columns. Add them once; safe to run every start.
function addColumn(table, column, ddl) {
  const have = raw.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!have) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('assessments', 'kind', "TEXT NOT NULL DEFAULT 'test'");   // 'test' | 'homework'
addColumn('assessments', 'due', 'TEXT');                             // optional date, YYYY-MM-DD
addColumn('assessments', 'subject', 'TEXT');                         // e.g. Maths (the photo-sheet engine checks number sums only)
addColumn('submissions', 'source', "TEXT NOT NULL DEFAULT 'teacher'"); // 'teacher' | 'student' (student's own homework)
addColumn('practice_sets', 'done_at', 'TEXT');
addColumn('quizzes', 'mode', "TEXT NOT NULL DEFAULT 'online'");    // 'online' (students answer in the app) | 'paper' (teacher enters the answer sheet)
addColumn('quizzes', 'audience_json', 'TEXT');                       // NULL = whole class, else JSON array of student ids (a practice quiz for one group)
addColumn('quizzes', 'subject', 'TEXT');                             // any subject: Biology, History, English...

// Older database files only allow the roles teacher and student. SQLite cannot change a CHECK, so rebuild the users table once.
(function allowParentRole() {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row || /'parent'/.test(row.sql)) return;
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.exec('BEGIN');
  try {
    raw.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher','student','parent')),
      salt TEXT NOT NULL, hash TEXT NOT NULL, student_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    raw.exec('INSERT INTO users_new (id, username, name, role, salt, hash, student_id, created_at) SELECT id, username, name, role, salt, hash, student_id, created_at FROM users');
    raw.exec('DROP TABLE users');
    raw.exec('ALTER TABLE users_new RENAME TO users');
    raw.exec('COMMIT');
  } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { raw.exec('PRAGMA foreign_keys = ON'); }
})();

module.exports = {
  raw,
  all: (sql, p = []) => raw.prepare(sql).all(...p),
  get: (sql, p = []) => raw.prepare(sql).get(...p),
  run: (sql, p = []) => raw.prepare(sql).run(...p), // { lastInsertRowid, changes }
};
