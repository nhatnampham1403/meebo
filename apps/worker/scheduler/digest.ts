/**
 * Daily Digest — 07:00 every day
 * Sends a single morning briefing: overdue + due-today + due-this-week.
 * Idempotency: one row per (job_name, sent_date) in digest_log.
 */
import { db } from '../lib/db';
import { createBot, requireGroupChatId } from '../lib/telegram';
import { createTrelloClient, daysFromNow } from '../lib/trello';
import { formatDigest } from '../lib/messages';

async function alreadySentToday(jobName: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]!;
  const { data } = await db
    .from('digest_log')
    .select('id')
    .eq('job_name', jobName)
    .eq('sent_date', today)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function markSent(jobName: string): Promise<void> {
  await db.from('digest_log').insert({ job_name: jobName });
}

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

export async function runDigest(): Promise<void> {
  const JOB = 'digest';
  console.log(`[${JOB}] Starting`);

  if (await alreadySentToday(JOB)) {
    console.log(`[${JOB}] Already sent today — skipping`);
    return;
  }

  const groupId = requireGroupChatId();
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const overdue = ctx.filter(
    ({ card }) => card.due && !card.dueComplete && daysFromNow(card.due) < 0,
  );
  const today = ctx.filter(({ card }) => {
    if (!card.due || card.dueComplete) return false;
    const d = daysFromNow(card.due);
    return d >= -0.5 && d <= 1;
  });
  const week = ctx.filter(({ card }) => {
    if (!card.due || card.dueComplete) return false;
    const d = daysFromNow(card.due);
    return d > 1 && d <= 7;
  });

  const bot = createBot();
  await bot.sendMessage(groupId, formatDigest(overdue, today, week));
  await markSent(JOB);
  console.log(`[${JOB}] Done`);
}
