import type { TelegramBot } from '../lib/telegram';
import { createTrelloClient, daysFromNow, daysAgo, formatDate, hasLabel } from '../lib/trello';
import { db } from '../lib/db';

// ─── Member map ──────────────────────────────────────────────────────────────

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function bullet(
  card: { name: string; shortUrl: string; due?: string | null },
  listName: string,
  owners: string[],
  suffix?: string,
): string {
  const ownerStr = owners.length ? ` · <i>${owners.join(', ')}</i>` : '';
  const suffixStr = suffix ? ` · ${suffix}` : '';
  return `• <a href="${card.shortUrl}">${escape(card.name)}</a> [${escape(listName)}]${ownerStr}${suffixStr}`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function noItems(): string {
  return '✅ Nothing to report.';
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function cmdOverdue(bot: TelegramBot, chatId: number): Promise<void> {
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const overdue = ctx.filter(
    ({ card }) => card.due && !card.dueComplete && daysFromNow(card.due) < 0,
  );

  if (!overdue.length) {
    await bot.sendMessage(chatId, '✅ <b>No overdue cards!</b> Great work.');
    return;
  }

  overdue.sort((a, b) => {
    const da = daysFromNow(a.card.due!);
    const db2 = daysFromNow(b.card.due!);
    return da - db2;
  });

  const lines = overdue.map(({ card, listName, ownerNames }) => {
    const late = Math.round(daysAgo(card.due!));
    return bullet(card, listName, ownerNames, `<b>${late}d late</b>`);
  });

  await bot.sendMessage(
    chatId,
    `🔴 <b>Overdue Cards (${overdue.length})</b>\n\n${lines.join('\n')}`,
  );
}

async function cmdToday(bot: TelegramBot, chatId: number): Promise<void> {
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const today = ctx.filter(({ card }) => {
    if (!card.due || card.dueComplete) return false;
    const d = daysFromNow(card.due);
    return d >= -0.5 && d <= 1;
  });

  if (!today.length) {
    await bot.sendMessage(chatId, noItems());
    return;
  }

  const lines = today.map(({ card, listName, ownerNames }) =>
    bullet(card, listName, ownerNames, formatDate(card.due!)),
  );

  await bot.sendMessage(chatId, `📅 <b>Due Today (${today.length})</b>\n\n${lines.join('\n')}`);
}

async function cmdWaiting(bot: TelegramBot, chatId: number): Promise<void> {
  // Cards from customer_meeting extractions with external_party set that haven't
  // had Trello activity in 3+ days
  const { data: drafts } = await db
    .from('task_drafts')
    .select('trello_card_id, external_party, extracted_title')
    .not('trello_card_id', 'is', null)
    .not('external_party', 'is', null)
    .eq('review_status', 'approved');

  if (!drafts || drafts.length === 0) {
    await bot.sendMessage(chatId, noItems());
    return;
  }

  const waitingIds = new Set(drafts.map((d) => d.trello_card_id!));
  const externalMap = new Map(drafts.map((d) => [d.trello_card_id!, d.external_party!]));

  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const waiting = ctx.filter(
    ({ card }) => waitingIds.has(card.id) && daysAgo(card.dateLastActivity) >= 3,
  );

  if (!waiting.length) {
    await bot.sendMessage(chatId, noItems());
    return;
  }

  const lines = waiting.map(({ card, listName, ownerNames }) => {
    const idle = Math.round(daysAgo(card.dateLastActivity));
    const ext = externalMap.get(card.id) ?? 'external party';
    return bullet(card, listName, ownerNames, `waiting on ${escape(ext)} · ${idle}d idle`);
  });

  await bot.sendMessage(
    chatId,
    `📦 <b>Waiting on External (${waiting.length})</b>\n\n${lines.join('\n')}`,
  );
}

async function cmdBlocked(bot: TelegramBot, chatId: number): Promise<void> {
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const blocked = ctx.filter(({ card }) => hasLabel(card, 'Blocked', 'blocked', 'BLOCKED'));

  if (!blocked.length) {
    await bot.sendMessage(chatId, '✅ <b>No blocked cards.</b>');
    return;
  }

  const lines = blocked.map(({ card, listName, ownerNames }) =>
    bullet(card, listName, ownerNames),
  );

  await bot.sendMessage(
    chatId,
    `🚫 <b>Blocked Cards (${blocked.length})</b>\n\n${lines.join('\n')}`,
  );
}

async function cmdSummary(bot: TelegramBot, chatId: number): Promise<void> {
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const total = ctx.length;
  const overdue = ctx.filter(
    ({ card }) => card.due && !card.dueComplete && daysFromNow(card.due) < 0,
  ).length;
  const dueToday = ctx.filter(({ card }) => {
    if (!card.due || card.dueComplete) return false;
    const d = daysFromNow(card.due);
    return d >= -0.5 && d <= 1;
  }).length;
  const dueSoon = ctx.filter(({ card }) => {
    if (!card.due || card.dueComplete) return false;
    const d = daysFromNow(card.due);
    return d > 1 && d <= 7;
  }).length;
  const stale = ctx.filter(({ card }) => daysAgo(card.dateLastActivity) >= 7).length;
  const blocked = ctx.filter(({ card }) => hasLabel(card, 'Blocked')).length;

  const lines = [
    `📊 <b>Board Summary</b>`,
    ``,
    `🗂 Total cards: <b>${total}</b>`,
    `🔴 Overdue: <b>${overdue}</b>`,
    `📅 Due today: <b>${dueToday}</b>`,
    `⏰ Due this week: <b>${dueSoon}</b>`,
    `🕸 Stale (7d+ idle): <b>${stale}</b>`,
    `🚫 Blocked: <b>${blocked}</b>`,
  ];

  await bot.sendMessage(chatId, lines.join('\n'));
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleCommand(
  bot: TelegramBot,
  chatId: number,
  command: string,
  fromName: string,
): Promise<void> {
  console.log(`[commands] /${command} from ${fromName} in chat ${chatId}`);

  try {
    switch (command) {
      case 'start':
        await bot.sendMessage(
          chatId,
          `👋 <b>MeeBo here!</b> I keep the team synced with Trello.\n\n` +
            `<b>Commands:</b>\n` +
            `/overdue — overdue cards\n` +
            `/today — cards due today\n` +
            `/waiting — waiting on external parties\n` +
            `/blocked — blocked cards\n` +
            `/summary — board stats`,
        );
        break;
      case 'overdue':
        await cmdOverdue(bot, chatId);
        break;
      case 'today':
        await cmdToday(bot, chatId);
        break;
      case 'waiting':
        await cmdWaiting(bot, chatId);
        break;
      case 'blocked':
        await cmdBlocked(bot, chatId);
        break;
      case 'summary':
        await cmdSummary(bot, chatId);
        break;
      default:
        // Unknown command — silently ignore in group chats to avoid noise
        break;
    }
  } catch (err) {
    console.error(`[commands] /${command} error:`, err);
    await bot
      .sendMessage(chatId, '⚠️ Something went wrong. Check worker logs.')
      .catch(() => undefined);
  }
}
