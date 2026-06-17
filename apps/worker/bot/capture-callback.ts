/**
 * Capture review callbacks — Approve / Edit / Skip (P6.T4).
 * callback_data format: "capture:{draft_uuid}:{approve|edit|skip}"
 */
import { draftToTrelloCard } from '@trello-optimization/shared';
import type { Database } from '@trello-optimization/shared';
import type { TelegramBot } from '../lib/telegram';
import { createTrelloWriteClient } from '../lib/trello';
import { db } from '../lib/db';
import {
  formatCaptureApproveAck,
  formatCaptureApproveFailed,
  formatCaptureAlreadyApproved,
  formatCaptureAlreadySkipped,
  formatCaptureDraftNotFound,
  formatCaptureEditAck,
  formatCaptureEditReply,
  formatCaptureNeedsClarificationBlock,
  formatCaptureSkipAck,
  formatCaptureTaskCreated,
  formatCaptureTaskSkipped,
} from '../lib/messages';

type TaskDraftRow = Database['public']['Tables']['task_drafts']['Row'];
type TeamMemberRow = Database['public']['Tables']['team_members']['Row'];
type CaptureAction = 'approve' | 'edit' | 'skip';

const VALID_ACTIONS = new Set<string>(['approve', 'edit', 'skip']);

function parseCallbackData(
  data: string,
): { draftId: string; action: CaptureAction } | null {
  const parts = data.split(':');
  if (parts.length !== 3) return null;
  const [prefix, draftId, rawAction] = parts as [string, string, string];
  if (prefix !== 'capture') return null;
  if (!VALID_ACTIONS.has(rawAction)) return null;
  if (!/^[0-9a-f-]{36}$/.test(draftId)) return null;
  return { draftId, action: rawAction as CaptureAction };
}

function buildWebDraftLink(draftId: string): string | null {
  const rawBase = process.env.VERCEL_URL ?? process.env.WEB_APP_URL;
  const secret = process.env.APP_SECRET;
  if (!rawBase || !secret) return null;
  const base = rawBase.startsWith('http') ? rawBase.replace(/\/$/, '') : `https://${rawBase}`;
  return `${base}/?key=${encodeURIComponent(secret)}&draft=${draftId}`;
}

async function loadMemberForDraft(draft: TaskDraftRow): Promise<TeamMemberRow | null> {
  if (draft.trello_member_id) {
    const { data } = await db
      .from('team_members')
      .select('*')
      .eq('trello_member_id', draft.trello_member_id)
      .maybeSingle();
    return data;
  }
  if (draft.owner) {
    const { data } = await db
      .from('team_members')
      .select('*')
      .ilike('display_name', draft.owner)
      .maybeSingle();
    return data;
  }
  return null;
}

async function handleApprove(
  bot: TelegramBot,
  callbackQueryId: string,
  draft: TaskDraftRow,
  chatId: number,
  messageId: number,
): Promise<void> {
  if (draft.needs_clarification || draft.review_status === 'needs_clarification') {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureNeedsClarificationBlock());
    return;
  }

  if (draft.review_status === 'approved' && draft.trello_card_id) {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureAlreadyApproved());
    if (draft.trello_card_url) {
      try {
        await bot.editMessageText(
          chatId,
          messageId,
          formatCaptureTaskCreated(draft.extracted_title, draft.trello_card_url),
          'HTML',
          { clearKeyboard: true },
        );
      } catch {
        // Non-fatal
      }
    }
    return;
  }

  if (draft.review_status === 'rejected') {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureAlreadySkipped());
    return;
  }

  let trello;
  try {
    trello = createTrelloWriteClient();
  } catch (err) {
    console.error('[capture-callback] Trello config error:', err);
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureApproveFailed());
    return;
  }

  let member: TeamMemberRow | null;
  try {
    member = await loadMemberForDraft(draft);
  } catch (err) {
    console.error('[capture-callback] Member lookup failed:', err);
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureApproveFailed());
    return;
  }

  let listId: string;
  try {
    const projectName = draft.project ?? draft.suggested_list ?? 'Inbox';
    listId = await trello.resolveOrCreateList(projectName);
  } catch (err) {
    console.error('[capture-callback] resolveOrCreateList failed:', err);
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureApproveFailed());
    return;
  }

  const cardFields = draftToTrelloCard(draft, member);
  const cardPayload = { ...cardFields, idList: listId };

  let card;
  try {
    card = await trello.createCard(cardPayload);
  } catch (err) {
    console.error('[capture-callback] createCard failed:', err);
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureApproveFailed());
    return;
  }

  if (draft.checklist && draft.checklist.length > 0) {
    try {
      await trello.addChecklist(card.id, 'Subtasks', draft.checklist);
    } catch (err) {
      console.warn('[capture-callback] addChecklist failed (non-fatal):', err);
    }
  }

  const { data: updated, error: updateError } = await db
    .from('task_drafts')
    .update({
      trello_card_id: card.id,
      trello_card_url: card.shortUrl,
      review_status: 'approved',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', draft.id)
    .is('trello_card_id', null)
    .select()
    .single();

  if (updateError) {
    console.error('[capture-callback] DB write-back failed:', updateError);
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureApproveFailed());
    return;
  }

  if (!updated) {
    try {
      await trello.archiveCard(card.id);
    } catch (err) {
      console.warn('[capture-callback] archiveCard failed after race:', err);
    }
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureAlreadyApproved());
    return;
  }

  try {
    await bot.editMessageText(
      chatId,
      messageId,
      formatCaptureTaskCreated(draft.extracted_title, card.shortUrl),
      'HTML',
      { clearKeyboard: true },
    );
  } catch (err) {
    console.warn('[capture-callback] Could not edit task message:', err);
  }

  await bot.answerCallbackQuery(callbackQueryId, formatCaptureApproveAck());
  console.log(`[capture-callback] Approved draft ${draft.id} → card ${card.id}`);
}

async function handleSkip(
  bot: TelegramBot,
  callbackQueryId: string,
  draft: TaskDraftRow,
  chatId: number,
  messageId: number,
): Promise<void> {
  if (draft.review_status === 'rejected') {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureAlreadySkipped());
    return;
  }

  if (draft.review_status === 'approved' && draft.trello_card_id) {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureAlreadyApproved());
    return;
  }

  const { data: updated, error: updateError } = await db
    .from('task_drafts')
    .update({
      review_status: 'rejected',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', draft.id)
    .in('review_status', ['pending', 'needs_clarification'])
    .select()
    .single();

  if (updateError) {
    console.error('[capture-callback] Skip update failed:', updateError);
    await bot.answerCallbackQuery(callbackQueryId, '⚠️ Could not skip');
    return;
  }

  if (!updated) {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureAlreadySkipped());
    return;
  }

  try {
    await bot.editMessageText(
      chatId,
      messageId,
      formatCaptureTaskSkipped(draft.extracted_title),
      'HTML',
      { clearKeyboard: true },
    );
  } catch (err) {
    console.warn('[capture-callback] Could not edit task message:', err);
  }

  await bot.answerCallbackQuery(callbackQueryId, formatCaptureSkipAck());
  console.log(`[capture-callback] Skipped draft ${draft.id}`);
}

async function handleEdit(
  bot: TelegramBot,
  callbackQueryId: string,
  draft: TaskDraftRow,
  chatId: number,
): Promise<void> {
  const link = buildWebDraftLink(draft.id);
  if (!link) {
    console.error('[capture-callback] VERCEL_URL/WEB_APP_URL or APP_SECRET not set');
    await bot.answerCallbackQuery(callbackQueryId, '⚠️ Web editor not configured');
    return;
  }

  try {
    await bot.sendMessage(chatId, formatCaptureEditReply(link));
  } catch (err) {
    console.error('[capture-callback] Failed to send edit link:', err);
    await bot.answerCallbackQuery(callbackQueryId, '⚠️ Could not send link');
    return;
  }

  await bot.answerCallbackQuery(callbackQueryId, formatCaptureEditAck());
}

export async function handleCaptureCallback(
  bot: TelegramBot,
  callbackQueryId: string,
  data: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  const parsed = parseCallbackData(data);
  if (!parsed) {
    await bot.answerCallbackQuery(callbackQueryId, '❌ Invalid response');
    return;
  }

  const { draftId, action } = parsed;

  const { data: draft, error: fetchError } = await db
    .from('task_drafts')
    .select('*')
    .eq('id', draftId)
    .single();

  if (fetchError || !draft) {
    await bot.answerCallbackQuery(callbackQueryId, formatCaptureDraftNotFound());
    return;
  }

  switch (action) {
    case 'approve':
      await handleApprove(bot, callbackQueryId, draft, chatId, messageId);
      break;
    case 'skip':
      await handleSkip(bot, callbackQueryId, draft, chatId, messageId);
      break;
    case 'edit':
      await handleEdit(bot, callbackQueryId, draft, chatId);
      break;
  }
}
