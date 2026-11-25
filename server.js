require('dotenv').config();
const express = require('express');
const path = require('path');
const { buildRouter } = require('./routes');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {   // basic browser protections
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', buildRouter());
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// Broken JSON from a client used to come back as an HTML error page. Always answer in JSON.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 400 ? 'That request was not valid.' : 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GapMap running at http://localhost:${PORT}`);
    require('./services/scheduler').start();      // reminders and daily alert checks (only when the real server runs, not in tests)
    console.log('AI reading:', require('./services/gemini').configured() ? 'on' + (process.env.OPENROUTER_API_KEY ? ' (OpenRouter backup ready)' : '') : 'OFF (set GEMINI_API_KEY or OPENROUTER_API_KEY in .env; quizzes still work from the built-in bank)');
  });
}
module.exports = app;
