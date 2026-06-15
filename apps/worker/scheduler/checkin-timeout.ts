/**
 * Check-in Timeout — 10:00 every day
 *
 * Pass 1 — 24 h: send a reminder DM to anyone who hasn't responded, flip
 *   status → 'reminded', record reminder_sent_at.
 *
 * Pass 2 — 48 h: mark remaining open prompts as 'timed_out' and post an
 *   escalation alert to the manager group.
 */
import { db } from '../lib/db';
import { createBot, requireGroupChatId } from '../lib/telegram';
import { createTrelloWriteClient } from '../lib/trello';

function escape(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export async function runCheckinTimeout(): Promise<void> {
  const JOB = 'checkin-timeout';
  console.log(`[${JOB}] Starting`);

  const bot = createBot();
  const now = new Date().toISOString();

  // ── Pass 1: 24 h reminders ────────────────────────────────────────────────
  const { data: toRemind } = await db
    .from('pending_checkins')
    .select('id, trello_card_id, member_id')
    .eq('status', 'awaiting')
    .lt('prompted_at', hoursAgo(24));

  let reminded = 0;

  for (const checkin of toRemind ?? []) {
    const { data: member } = await db
      .from('team_members')
      .select('display_name, telegram_user_id')
      .eq('id', checkin.member_id)
      .single();

    if (!member?.telegram_user_id) {
      // Still mark as reminded so we don't keep processing it
      await db
        .from('pending_checkins')
        .update({ status: 'reminded', reminder_sent_at: now })
        .eq('id', checkin.id);
      continue;
    }

    // Fetch card details for a helpful reminder
    let cardName = checkin.trello_card_id;
    let cardUrl = '';
    try {
      const trello = createTrelloWriteClient();
      const card = await trello.getCard(checkin.trello_card_id);
      cardName = card.name;
      cardUrl = card.shortUrl;
    } catch {
      // Non-fatal — use card ID as fallback
    }

    const cardLink = cardUrl
      ? `<a href="${cardUrl}">${escape(cardName)}</a>`
      : `<code>${escape(cardName)}</code>`;

    const text =
      `⏰ <b>Reminder</b>\n\n` +
      `You haven't responded to the check-in for:\n${cardLink}\n\n` +
      `Please tap a button — your team is waiting!`;

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
        .update({
          status: 'reminded',
          reminder_sent_at: now,
          telegram_message_id: String(msg.message_id),
        })
        .eq('id', checkin.id);

      console.log(`[${JOB}] Reminder sent to ${member.display_name}`);
      reminded++;
    } catch (err) {
      console.error(`[${JOB}] Failed to remind ${member.display_name}:`, err);
    }
  }

  // ── Pass 2: 48 h escalations ──────────────────────────────────────────────
  const { data: toTimeout } = await db
    .from('pending_checkins')
    .select('id, trello_card_id, member_id')
    .in('status', ['awaiting', 'reminded'])
    .lt('prompted_at', hoursAgo(48));

  let timedOut = 0;
  let groupId: string | undefined;

  try {
    groupId = requireGroupChatId();
  } catch {
    console.warn(`[${JOB}] TELEGRAM_GROUP_CHAT_ID not set — escalations will be logged only`);
  }

  for (const checkin of toTimeout ?? []) {
    // Mark timed out first (so a concurrent run won't double-process)
    await db
      .from('pending_checkins')
      .update({ status: 'timed_out', resolved_at: now })
      .eq('id', checkin.id);

    const { data: member } = await db
      .from('team_members')
      .select('display_name')
      .eq('id', checkin.member_id)
      .single();

    const memberName = member?.display_name ?? 'Unknown member';

    let cardName = checkin.trello_card_id;
    let cardUrl = '';
    try {
      const trello = createTrelloWriteClient();
      const card = await trello.getCard(checkin.trello_card_id);
      cardName = card.name;
      cardUrl = card.shortUrl;
    } catch {
      // Non-fatal
    }

    console.warn(
      `[${JOB}] ESCALATION: ${memberName} timed out on card "${cardName}" (${checkin.trello_card_id})`,
    );

    if (groupId) {
      const cardLink = cardUrl
        ? `<a href="${cardUrl}">${escape(cardName)}</a>`
        : `<code>${escape(cardName)}</code>`;

      try {
        await bot.sendMessage(
          groupId,
          `⚠️ <b>No response — escalation</b>\n\n` +
            `<b>${escape(memberName)}</b> did not respond to their check-in.\n` +
            `Card: ${cardLink}\n` +
            `Prompted 48h ago — marked as timed out.`,
        );
      } catch (err) {
        console.error(`[${JOB}] Failed to send group escalation:`, err);
      }
    }

    timedOut++;
  }

  console.log(
    `[${JOB}] Done — ${reminded} reminder(s) sent, ${timedOut} check-in(s) escalated`,
  );
}
