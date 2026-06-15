/**
 * Daily Digest — 07:00 every day
 * Sends a single morning briefing: overdue + due-today + due-this-week.
 * Idempotency: one row per (job_name, sent_date) in digest_log.
 */
import { db } from '../lib/db';
import { createBot, requireGroupChatId } from '../lib/telegram';
import { createTrelloClient, daysFromNow, daysAgo, formatDate } from '../lib/trello';

// ─── Idempotency helpers ──────────────────────────────────────────────────────

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

// ─── Member map ───────────────────────────────────────────────────────────────

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function escape(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function line(
  name: string,
  url: string,
  listName: string,
  owners: string[],
  suffix: string,
): string {
  const o = owners.length ? ` · <i>${owners.map(escape).join(', ')}</i>` : '';
  return `• <a href="${url}">${escape(name)}</a> [${escape(listName)}]${o} · ${suffix}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  const sections: string[] = [];

  const dateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  sections.push(`📊 <b>Daily Digest — ${dateStr}</b>`);

  if (overdue.length) {
    const sorted = [...overdue].sort(
      (a, b) => daysFromNow(a.card.due!) - daysFromNow(b.card.due!),
    );
    sections.push(
      `\n🔴 <b>Overdue (${overdue.length})</b>\n` +
        sorted
          .map(({ card, listName, ownerNames }) =>
            line(
              card.name,
              card.shortUrl,
              listName,
              ownerNames,
              `<b>${Math.round(daysAgo(card.due!))}d late</b>`,
            ),
          )
          .join('\n'),
    );
  }

  if (today.length) {
    sections.push(
      `\n📅 <b>Due Today (${today.length})</b>\n` +
        today
          .map(({ card, listName, ownerNames }) =>
            line(card.name, card.shortUrl, listName, ownerNames, formatDate(card.due!)),
          )
          .join('\n'),
    );
  }

  if (week.length) {
    sections.push(
      `\n⏰ <b>Due This Week (${week.length})</b>\n` +
        week
          .map(({ card, listName, ownerNames }) =>
            line(card.name, card.shortUrl, listName, ownerNames, formatDate(card.due!)),
          )
          .join('\n'),
    );
  }

  if (!overdue.length && !today.length && !week.length) {
    sections.push('\n✅ All clear — no overdue or upcoming tasks.');
  }

  const bot = createBot();
  await bot.sendMessage(groupId, sections.join('\n'));
  await markSent(JOB);
  console.log(`[${JOB}] Done`);
}
