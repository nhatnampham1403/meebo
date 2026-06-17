import type { TelegramBot } from '../lib/telegram';
import { createTrelloClient, daysFromNow, daysAgo, hasLabel } from '../lib/trello';
import { db } from '../lib/db';
import {
  formatStart,
  formatOverdue,
  formatOverdueEmpty,
  formatToday,
  formatNoItems,
  formatWaiting,
  formatBlocked,
  formatBlockedEmpty,
  formatSummary,
} from '../lib/messages';

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

async function cmdOverdue(bot: TelegramBot, chatId: number): Promise<void> {
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const overdue = ctx.filter(
    ({ card }) => card.due && !card.dueComplete && daysFromNow(card.due) < 0,
  );

  if (!overdue.length) {
    await bot.sendMessage(chatId, formatOverdueEmpty());
    return;
  }

  await bot.sendMessage(chatId, formatOverdue(overdue));
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
    await bot.sendMessage(chatId, formatNoItems());
    return;
  }

  await bot.sendMessage(chatId, formatToday(today));
}

async function cmdWaiting(bot: TelegramBot, chatId: number): Promise<void> {
  const { data: drafts } = await db
    .from('task_drafts')
    .select('trello_card_id, external_party, extracted_title')
    .not('trello_card_id', 'is', null)
    .not('external_party', 'is', null)
    .eq('review_status', 'approved');

  if (!drafts || drafts.length === 0) {
    await bot.sendMessage(chatId, formatNoItems());
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
    await bot.sendMessage(chatId, formatNoItems());
    return;
  }

  await bot.sendMessage(chatId, formatWaiting(waiting, externalMap));
}

async function cmdBlocked(bot: TelegramBot, chatId: number): Promise<void> {
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const blocked = ctx.filter(({ card }) => hasLabel(card, 'Blocked', 'blocked', 'BLOCKED'));

  if (!blocked.length) {
    await bot.sendMessage(chatId, formatBlockedEmpty());
    return;
  }

  await bot.sendMessage(chatId, formatBlocked(blocked));
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

  await bot.sendMessage(
    chatId,
    formatSummary({ total, overdue, dueToday, dueSoon, stale, blocked }),
  );
}

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
        await bot.sendMessage(chatId, formatStart());
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
        break;
    }
  } catch (err) {
    console.error(`[commands] /${command} error:`, err);
    await bot
      .sendMessage(chatId, '⚠️ Something went wrong. Check worker logs.')
      .catch(() => undefined);
  }
}
