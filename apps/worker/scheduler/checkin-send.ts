/**
 * Check-in Sender — 09:00 every day
 * For every Trello card due within 48 hours, DM each assigned team member
 * with ✅/🔄/❌ inline buttons.
 * Enforces ONE open prompt per (trello_card_id, member_id) pair.
 */
import { db } from '../lib/db';
import { createBot } from '../lib/telegram';
import { createTrelloClient, daysFromNow, formatDate } from '../lib/trello';
import { formatCheckinPrompt } from '../lib/messages';

export async function runCheckinSend(): Promise<void> {
  const JOB = 'checkin-send';
  console.log(`[${JOB}] Starting`);

  const trello = createTrelloClient();
  const [cards, lists] = await Promise.all([
    trello.getCardsOnBoard(),
    trello.getLists(),
  ]);

  const listMap = new Map(lists.map((l) => [l.id, l.name]));

  const dueSoon = cards.filter((card) => {
    if (!card.due || card.dueComplete || card.idMembers.length === 0) return false;
    const d = daysFromNow(card.due);
    return d >= 0 && d <= 2;
  });

  if (!dueSoon.length) {
    console.log(`[${JOB}] No due-soon cards with assignees`);
    return;
  }

  const { data: members } = await db
    .from('team_members')
    .select('id, display_name, trello_member_id, telegram_user_id')
    .not('telegram_user_id', 'is', null);

  if (!members || members.length === 0) {
    console.warn(`[${JOB}] No team members have telegram_user_id set — skipping`);
    return;
  }

  const memberByTrelloId = new Map(members.map((m) => [m.trello_member_id, m]));
  const bot = createBot();
  let sent = 0;

  for (const card of dueSoon) {
    for (const trelloMemberId of card.idMembers) {
      const member = memberByTrelloId.get(trelloMemberId);
      if (!member?.telegram_user_id) continue;

      const { data: existing } = await db
        .from('pending_checkins')
        .select('id')
        .eq('trello_card_id', card.id)
        .eq('member_id', member.id)
        .in('status', ['awaiting', 'reminded'])
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[${JOB}] Open prompt already exists for ${member.display_name} / ${card.name}`);
        continue;
      }

      const { data: checkin, error } = await db
        .from('pending_checkins')
        .insert({ trello_card_id: card.id, member_id: member.id })
        .select('id')
        .single();

      if (error || !checkin) {
        console.error(`[${JOB}] Failed to insert pending_checkin:`, error);
        continue;
      }

      const listName = listMap.get(card.idList) ?? 'Unknown';
      const text = formatCheckinPrompt(
        card.name,
        listName,
        formatDate(card.due!),
        member.display_name,
      );

      try {
        const msg = await bot.sendInlineKeyboard(
          member.telegram_user_id,
          text,
          [
            [
              { text: '✅ Done', callback_data: `checkin:${checkin.id}:done` },
              { text: '🔄 In Progress', callback_data: `checkin:${checkin.id}:in_progress` },
              { text: '❌ Blocked', callback_data: `checkin:${checkin.id}:blocked` },
            ],
          ],
        );

        await db
          .from('pending_checkins')
          .update({ telegram_message_id: String(msg.message_id) })
          .eq('id', checkin.id);

        console.log(`[${JOB}] Prompted ${member.display_name} for "${card.name}"`);
        sent++;
      } catch (err) {
        console.error(`[${JOB}] Failed to DM ${member.display_name}:`, err);
        await db.from('pending_checkins').delete().eq('id', checkin.id);
      }
    }
  }

  console.log(`[${JOB}] Done — sent ${sent} prompt(s)`);
}
