// Delivery channels for the outbox. ONE adapter works today: "console" (dry run: it records a row and sends nothing).
// Real SMS / WhatsApp / email providers are OFF. To add one: write an adapter with send(to, text) -> { ok }, register it here,
// and list it in NOTIFY_CHANNELS in .env. Nothing here claims a real message was delivered.
const consoleAdapter = { name: 'console', real: false, async send() { return { ok: true, status: 'dry-run' }; } };
const adapters = { console: consoleAdapter };
const active = () => (process.env.NOTIFY_CHANNELS || 'console').split(',').map((s) => s.trim()).filter((n) => adapters[n]);
module.exports = { adapters, active };
