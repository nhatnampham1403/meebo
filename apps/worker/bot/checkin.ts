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

type CheckinResponse = 'done' | 'in_progress' | 'blocked';

const VALID_RESPONSES = new Set<string>(['done', 'in_progress', 'blocked']);

const RESPONSE_LABEL: Record<CheckinResponse, string> = {
  done: 'Done ✅',
  in_progress: 'In Progress 🔄',
  blocked: 'Blocked ❌',
};

const RESPONSE_EMOJI: Record<CheckinResponse, string> = {
  done: '✅',
  in_progress: '🔄',
  blocked: '❌',
};

function escape(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Parse "checkin:{uuid}:{response}" into its parts.
 * Returns null if the format is invalid.
 */
function parseCallbackData(
  data: string,
): { checkinId: string; response: CheckinResponse } | null {
  const parts = data.split(':');
  if (parts.length !== 3) return null;
  const [prefix, checkinId, rawResponse] = parts as [string, string, string];
  if (prefix !== 'checkin') return null;
  if (!VALID_RESPONSES.has(rawResponse)) return null;
  // Validate UUID shape (basic)
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

  // Load the pending_checkin
  const { data: checkin, error: fetchError } = await db
    .from('pending_checkins')
    .select('id, trello_card_id, member_id, telegram_message_id, status')
    .eq('id', checkinId)
    .single();

  if (fetchError || !checkin) {
    await bot.answerCallbackQuery(callbackQueryId, '❌ Check-in not found');
    return;
  }

  // Already settled — idempotent guard
  if (checkin.status === 'resolved') {
    await bot.answerCallbackQuery(callbackQueryId, '✅ Already answered — thanks!');
    return;
  }
  if (checkin.status === 'timed_out') {
    await bot.answerCallbackQuery(callbackQueryId, '⏱ This check-in has expired');
    return;
  }

  // Load the team member for display name + DM chat id
  const { data: member } = await db
    .from('team_members')
    .select('display_name, telegram_user_id')
    .eq('id', checkin.member_id)
    .single();

  const memberName = member?.display_name ?? 'Team member';

  // Resolve the row atomically — ignore conflict if somehow already resolved
  const { error: updateError } = await db
    .from('pending_checkins')
    .update({
      status: 'resolved',
      response,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', checkinId)
    .in('status', ['awaiting', 'reminded']); // only update if still open

  if (updateError) {
    console.error('[checkin] Failed to update pending_checkin:', updateError);
    await bot.answerCallbackQuery(callbackQueryId, '⚠️ Could not save response');
    return;
  }

  // Post Trello comment
  try {
    const trello = createTrelloWriteClient();
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    await trello.addComment(
      checkin.trello_card_id,
      `[MeeBo check-in] ${memberName} reported: ${RESPONSE_LABEL[response]} on ${dateStr}`,
    );
  } catch (err) {
    // Non-fatal — log and continue
    console.error('[checkin] Failed to post Trello comment:', err);
  }

  // Edit original DM to confirm and remove buttons
  if (checkin.telegram_message_id && member?.telegram_user_id) {
    const editText =
      `${RESPONSE_EMOJI[response]} <b>Recorded: ${escape(RESPONSE_LABEL[response])}</b>\n\n` +
      `Your Trello card has been updated. Thank you, ${escape(memberName)}!`;
    try {
      await bot.editMessageText(
        member.telegram_user_id,
        Number(checkin.telegram_message_id),
        editText,
      );
    } catch (err) {
      // Editing can fail if the message is too old or already edited — non-fatal
      console.warn('[checkin] Could not edit prompt message:', err);
    }
  }

  // Acknowledge the button tap
  await bot.answerCallbackQuery(
    callbackQueryId,
    `${RESPONSE_EMOJI[response]} ${RESPONSE_LABEL[response]} — logged!`,
  );

  console.log(
    `[checkin] ${memberName} responded: ${response} for card ${checkin.trello_card_id}`,
  );
}
