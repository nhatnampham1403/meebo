/**
 * Stale Card Report — 08:00 every Monday
 * Lists cards with no Trello activity in 7+ days.
 * Idempotency: keyed on ISO week (YYYY-Www).
 */
import { db } from '../lib/db';
import { createBot, requireGroupChatId } from '../lib/telegram';
import { createTrelloClient, daysAgo } from '../lib/trello';
import { formatStaleEmpty, formatStaleReport } from '../lib/messages';

function isoWeek(): string {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const week = Math.ceil(
    ((now.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7,
  );
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function alreadySentThisWeek(): Promise<boolean> {
  const ref = isoWeek();
  const { data } = await db
    .from('digest_log')
    .select('id')
    .eq('job_name', 'stale')
    .eq('reference_id', ref)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function markSent(): Promise<void> {
  await db.from('digest_log').insert({ job_name: 'stale', reference_id: isoWeek() });
}

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

export async function runStale(): Promise<void> {
  const JOB = 'stale';
  console.log(`[${JOB}] Starting (week ${isoWeek()})`);

  if (await alreadySentThisWeek()) {
    console.log(`[${JOB}] Already sent this week — skipping`);
    return;
  }

  const groupId = requireGroupChatId();
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const stale = ctx
    .filter(({ card }) => daysAgo(card.dateLastActivity) >= 7)
    .sort((a, b) => daysAgo(b.card.dateLastActivity) - daysAgo(a.card.dateLastActivity));

  const bot = createBot();

  if (!stale.length) {
    await bot.sendMessage(groupId, formatStaleEmpty());
    await markSent();
    return;
  }

  await bot.sendMessage(groupId, formatStaleReport(stale));
  await markSent();
  console.log(`[${JOB}] Done — reported ${stale.length} stale card(s)`);
}
