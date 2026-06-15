import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { webhookRouter } from './bot/webhook';
import { runDigest } from './scheduler/digest';
import { runAlerts } from './scheduler/alerts';
import { runStale } from './scheduler/stale';
import { runVendor } from './scheduler/vendor';
import { runCheckinSend } from './scheduler/checkin-send';
import { runCheckinTimeout } from './scheduler/checkin-timeout';
import { createBot } from './lib/telegram';

const app = express();
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── Telegram webhook ─────────────────────────────────────────────────────────
app.use('/webhook', webhookRouter);

// ─── Manual trigger endpoints (dev/testing — POST /trigger/:job) ──────────────
const JOBS: Record<string, () => Promise<void>> = {
  digest: runDigest,
  alerts: runAlerts,
  stale: runStale,
  vendor: runVendor,
  'checkin-send': runCheckinSend,
  'checkin-timeout': runCheckinTimeout,
};

app.post('/trigger/:job', (req, res) => {
  const { job } = req.params;
  const runner = JOBS[job];
  if (!runner) {
    res.status(404).json({ error: `Unknown job "${job}". Available: ${Object.keys(JOBS).join(', ')}` });
    return;
  }
  res.json({ ok: true, message: `Job "${job}" started — watch worker logs` });
  // Run async after responding so the client isn't blocked
  runner().catch((err: unknown) => console.error(`[trigger/${job}] Error:`, err));
});

// ─── Cron schedule ────────────────────────────────────────────────────────────
// Timezone: adjust TZ env var if your team is not in UTC
cron.schedule('0 7 * * *',   () => void runDigest(),         { name: 'digest' });
cron.schedule('15 7 * * *',  () => void runAlerts(),         { name: 'alerts' });
cron.schedule('0 8 * * 1',   () => void runStale(),          { name: 'stale' });          // Monday
cron.schedule('30 8 * * *',  () => void runVendor(),         { name: 'vendor' });
cron.schedule('0 9 * * *',   () => void runCheckinSend(),    { name: 'checkin-send' });
cron.schedule('0 10 * * *',  () => void runCheckinTimeout(), { name: 'checkin-timeout' });

// ─── Boot ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, async () => {
  console.log(`[worker] Listening on port ${PORT}`);
  console.log('[worker] Cron schedule:');
  console.log('  digest          → 07:00 daily');
  console.log('  alerts          → 07:15 daily');
  console.log('  stale           → 08:00 Monday');
  console.log('  vendor          → 08:30 daily');
  console.log('  checkin-send    → 09:00 daily');
  console.log('  checkin-timeout → 10:00 daily');

  // Auto-register Telegram webhook if WEBHOOK_URL is provided
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const bot = createBot();
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
      await bot.registerWebhook(`${webhookUrl}/webhook/telegram`, secret);
    } catch (err) {
      console.error('[worker] Failed to register webhook:', err);
    }
  } else {
    console.warn('[worker] WEBHOOK_URL not set — Telegram webhook not registered');
    console.warn('[worker] Run: cloudflared tunnel --url http://localhost:4000');
    console.warn('[worker] Then add WEBHOOK_URL=<tunnel-url> to apps/worker/.env and restart');
  }

  // Log missing env vars so they're visible on startup
  if (!process.env.TELEGRAM_GROUP_CHAT_ID) {
    console.warn('[worker] ⚠️  TELEGRAM_GROUP_CHAT_ID not set — scheduler jobs will throw');
  }
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn('[worker] ⚠️  TELEGRAM_WEBHOOK_SECRET not set — webhook header validation disabled');
  }
});
