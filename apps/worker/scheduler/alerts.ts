/**
 * Deadline Alerts — 07:15 every day
 * Sends individual nudges for each card due within the next 48 hours.
 * Idempotency: one digest_log row per card per day (reference_id = card id).
 */
import { db } from '../lib/db';
import { createBot, requireGroupChatId } from '../lib/telegram';
import { createTrelloClient, daysFromNow, formatDate } from '../lib/trello';

async function alreadySentCard(cardId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]!;
  const { data } = await db
    .from('digest_log')
    .select('id')
    .eq('job_name', 'alerts')
    .eq('reference_id', cardId)
    .eq('sent_date', today)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function markCard(cardId: string): Promise<void> {
  await db.from('digest_log').insert({ job_name: 'alerts', reference_id: cardId });
}

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

function escape(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function runAlerts(): Promise<void> {
  const JOB = 'alerts';
  console.log(`[${JOB}] Starting`);

  const groupId = requireGroupChatId();
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const upcoming = ctx.filter(({ card }) => {
    if (!card.due || card.dueComplete) return false;
    const d = daysFromNow(card.due);
    return d >= 0 && d <= 2;
  });

  let sent = 0;

  for (const { card, listName, ownerNames } of upcoming) {
    if (await alreadySentCard(card.id)) continue;

    const o = ownerNames.length ? ` · <i>${ownerNames.map(escape).join(', ')}</i>` : '';
    const when = daysFromNow(card.due!) <= 1 ? 'TODAY' : 'TOMORROW';
    const msg =
      `⚠️ <b>Due ${when}</b>\n` +
      `<a href="${card.shortUrl}">${escape(card.name)}</a> [${escape(listName)}]${o}\n` +
      `📅 ${formatDate(card.due!)}`;

    const bot = createBot();
    await bot.sendMessage(groupId, msg);
    await markCard(card.id);
    sent++;
  }

  console.log(`[${JOB}] Sent ${sent} alert(s)`);
}
