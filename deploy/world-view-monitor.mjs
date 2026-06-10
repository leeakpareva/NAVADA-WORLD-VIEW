#!/usr/bin/env node
// NAVADA World View watchdog — runs on EC2, checks the public site + API,
// alerts Lee on Telegram after consecutive failures. No npm dependencies.

const CHECKS = [
  { name: 'Site (public HTTPS)', url: 'https://navada-world-view.xyz/', method: 'GET' },
  {
    name: 'API (earthquakes RPC)',
    url: 'https://navada-world-view.xyz/api/seismology/v1/list-earthquakes',
    method: 'POST',
    body: '{}',
    validate: (text) => text.includes('"earthquakes"'),
  },
  { name: 'ASUS container (Tailscale)', url: 'http://100.88.118.128:4173/', method: 'GET' },
];

const INTERVAL_MS = 5 * 60 * 1000;
const FAIL_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '6920669447';

let consecutiveFailures = 0;
let lastAlertAt = 0;
let recoveredPending = false;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function check({ name, url, method, body, validate }) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { name, ok: false, detail: `HTTP ${res.status}` };
    if (validate && !validate(await res.text())) return { name, ok: false, detail: 'bad payload' };
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, detail: err.message };
  }
}

async function telegram(text) {
  if (!TELEGRAM_TOKEN) { log('No TELEGRAM_BOT_TOKEN; alert skipped'); return; }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(15000),
    });
    log('Telegram alert sent');
  } catch (err) {
    log(`Telegram send failed: ${err.message}`);
  }
}

async function run() {
  const results = await Promise.all(CHECKS.map(check));
  const failed = results.filter(r => !r.ok);
  if (failed.length === 0) {
    if (consecutiveFailures >= FAIL_THRESHOLD && recoveredPending) {
      await telegram('✅ NAVADA World View recovered — all checks passing.');
      recoveredPending = false;
    }
    consecutiveFailures = 0;
    log('All checks OK');
    return;
  }
  consecutiveFailures += 1;
  log(`FAIL ${consecutiveFailures}/${FAIL_THRESHOLD}: ${failed.map(f => `${f.name} (${f.detail})`).join('; ')}`);
  if (consecutiveFailures >= FAIL_THRESHOLD && Date.now() - lastAlertAt > ALERT_COOLDOWN_MS) {
    lastAlertAt = Date.now();
    recoveredPending = true;
    await telegram(`🚨 NAVADA World View DOWN (${consecutiveFailures} consecutive failures)\n${failed.map(f => `• ${f.name}: ${f.detail}`).join('\n')}\nhttps://navada-world-view.xyz`);
  }
}

log(`World View watchdog started — ${CHECKS.length} checks every ${INTERVAL_MS / 60000}min`);
run();
setInterval(run, INTERVAL_MS);
