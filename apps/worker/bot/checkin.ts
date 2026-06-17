/**
 * Check-in callback handler.
 * Called from webhook.ts when callback_data starts with "checkin:".
 *
 * callback_data format: "checkin:{uuid}:{done|in_progress|blocked}"
 * UUID uses hyphens — no colons — so splitting on ":" is safe (3 parts exactly).
 */
import type { TelegramBot } from '../lib/telegram';
import { createTrelloWriteClient } from '../lib/trello';
import { db } from '../lib/db';
import {
  type CheckinResponse,
  formatCheckinConfirmation,
  formatCheckinCallbackAck,
  formatCheckinTrelloComment,
} from '../lib/messages';

const VALID_RESPONSES = new Set<string>(['done', 'in_progress', 'blocked']);

function parseCallbackData(
  data: string,
): { checkinId: string; response: CheckinResponse } | null {
  const parts = data.split(':');
  if (parts.length !== 3) return null;
  const [prefix, checkinId, rawResponse] = parts as [string, string, string];
  if (prefix !== 'checkin') return null;
  if (!VALID_RESPONSES.has(rawResponse)) return null;
  if (!/^[0-9a-f-]{36}$/.test(checkinId)) return null;
  return { checkinId, response: rawResponse as CheckinResponse };
}

export async function handleCheckinCallback(
  bot: TelegramBot,
  callbackQueryId: string,
  data: string,
): Promise<void> {
  const parsed = parseCallbackData(data);
  if (!parsed) {
    await bot.answerCallbackQuery(callbackQueryId, '❌ Invalid response');
    return;
  }

  const { checkinId, response } = parsed;

  const { data: checkin, error: fetchError } = await db
    .from('pending_checkins')
    .select('id, trello_card_id, member_id, telegram_message_id, status')
    .eq('id', checkinId)
    .single();

  if (fetchError || !checkin) {
    await bot.answerCallbackQuery(callbackQueryId, '❌ Check-in not found');
    return;
  }

  if (checkin.status === 'resolved') {
    await bot.answerCallbackQuery(callbackQueryId, '✅ Already answered — thanks!');
    return;
  }
  if (checkin.status === 'timed_out') {
    await bot.answerCallbackQuery(callbackQueryId, '⏱ This check-in has expired');
    return;
  }

  const { data: member } = await db
    .from('team_members')
    .select('display_name, telegram_user_id')
    .eq('id', checkin.member_id)
    .single();

  const memberName = member?.display_name ?? 'Team member';

  const { error: updateError } = await db
    .from('pending_checkins')
    .update({
      status: 'resolved',
      response,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', checkinId)
    .in('status', ['awaiting', 'reminded']);

  if (updateError) {
    console.error('[checkin] Failed to update pending_checkin:', updateError);
    await bot.answerCallbackQuery(callbackQueryId, '⚠️ Could not save response');
    return;
  }

  try {
    const trello = createTrelloWriteClient();
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    await trello.addComment(
      checkin.trello_card_id,
      formatCheckinTrelloComment(memberName, response, dateStr),
    );
  } catch (err) {
    console.error('[checkin] Failed to post Trello comment:', err);
  }

  if (checkin.telegram_message_id && member?.telegram_user_id) {
    try {
      await bot.editMessageText(
        member.telegram_user_id,
        Number(checkin.telegram_message_id),
        formatCheckinConfirmation(response, memberName),
      );
    } catch (err) {
      console.warn('[checkin] Could not edit prompt message:', err);
    }
  }

  await bot.answerCallbackQuery(callbackQueryId, formatCheckinCallbackAck(response));

  console.log(
    `[checkin] ${memberName} responded: ${response} for card ${checkin.trello_card_id}`,
  );
}
