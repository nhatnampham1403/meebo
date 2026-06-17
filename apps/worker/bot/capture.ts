/**
 * /capture flow — transcript intake, extraction, draft posting (P6.T2 + P6.T3).
 * In-memory sessions reset on worker restart.
 */
import type { ExtractionResult, TeamContext } from '@trello-optimization/shared';
import type { Database } from '@trello-optimization/shared';
import { extractTasksFromNotes } from '@trello-optimization/shared';
import type { TelegramBot, InlineButton } from '../lib/telegram';
import { db } from '../lib/db';
import { createTrelloClient } from '../lib/trello';
import type { TrelloWorkerClient } from '../lib/trello';
import {
  formatCaptureNoTasks,
  formatCaptureProcessing,
  formatCapturePrompt,
  formatCaptureSummary,
  formatCaptureTaskLine,
} from '../lib/messages';

const MIN_TRANSCRIPT_LENGTH = 10;
const DEFAULT_TIMEOUT_MINUTES = 10;

type SourceType = 'sprint_meeting' | 'customer_meeting';
type TaskDraftInsert = Database['public']['Tables']['task_drafts']['Insert'];
type TaskDraftRow = Database['public']['Tables']['task_drafts']['Row'];

interface CaptureSession {
  userId: number;
  sourceType: SourceType;
  timeoutId: ReturnType<typeof setTimeout>;
}

const sessions = new Map<number, CaptureSession>();

function timeoutMs(): number {
  const minutes = Number(process.env.CAPTURE_TIMEOUT_MINUTES ?? DEFAULT_TIMEOUT_MINUTES);
  return Math.max(1, minutes) * 60 * 1000;
}

function clearSession(chatId: number): void {
  const session = sessions.get(chatId);
  if (session) {
    clearTimeout(session.timeoutId);
    sessions.delete(chatId);
  }
}

export function isAwaitingCapture(chatId: number): boolean {
  return sessions.has(chatId);
}

async function buildTeamContext(trello: TrelloWorkerClient): Promise<TeamContext | null> {
  try {
    const { data: members } = await db
      .from('team_members')
      .select('*')
      .eq('is_active', true);

    if (!members || members.length === 0) return null;

    const cards = await trello.getCardsOnBoard();
    const cardCounts: Record<string, number> = {};
    for (const card of cards) {
      for (const memberId of card.idMembers) {
        cardCounts[memberId] = (cardCounts[memberId] ?? 0) + 1;
      }
    }

    return {
      members: members.map((m) => ({
        display_name: m.display_name,
        role: m.role,
        skills: m.skills,
        openCardCount: cardCounts[m.trello_member_id] ?? 0,
      })),
    };
  } catch {
    return null;
  }
}

function buildDraftInsertRows(
  result: ExtractionResult,
  meetingId: string,
  teamContext: TeamContext | null,
): TaskDraftInsert[] {
  const teamMembers = teamContext?.members ?? [];

  return result.tasks.map((task) => {
    const matchedMember = teamMembers.find(
      (m) => m.display_name.toLowerCase() === (task.owner ?? '').toLowerCase(),
    );

    return {
      extracted_title: task.extracted_title,
      project: task.project,
      owner: task.owner,
      trello_member_id: null,
      due_date: task.due_date,
      priority: task.priority,
      source_type: task.source_type,
      external_party: task.external_party,
      context: task.context,
      definition_of_done: task.definition_of_done,
      suggested_list: task.suggested_list,
      checklist: task.checklist,
      decision_needed: task.decision_needed,
      confidence: task.confidence,
      needs_clarification: task.needs_clarification,
      original_source_text: task.original_source_text,
      meeting_summary: result.summary,
      meeting_id: meetingId,
      source_channel: 'telegram',
      review_status: task.needs_clarification ? 'needs_clarification' : 'pending',
      _ownerDisplayName: matchedMember?.display_name ?? null,
    };
  }) as (TaskDraftInsert & { _ownerDisplayName: string | null })[];
}

async function resolveTrelloMemberIds(
  rows: (TaskDraftInsert & { _ownerDisplayName?: string | null })[],
): Promise<TaskDraftInsert[]> {
  const { data: dbMembers } = await db
    .from('team_members')
    .select('display_name, trello_member_id');

  if (!dbMembers) {
    return rows.map(({ _ownerDisplayName: _ignored, ...rest }) => rest);
  }

  return rows.map((row) => {
    const { _ownerDisplayName, ...rest } = row;
    if (_ownerDisplayName) {
      const match = dbMembers.find(
        (m) => m.display_name.toLowerCase() === _ownerDisplayName.toLowerCase(),
      );
      if (match) rest.trello_member_id = match.trello_member_id;
    }
    return rest;
  });
}

function buildTaskButtons(draft: TaskDraftRow): InlineButton[][] {
  const id = draft.id;
  if (draft.needs_clarification) {
    return [
      [
        { text: '✏️ Edit', callback_data: `capture:${id}:edit` },
        { text: '❌ Skip', callback_data: `capture:${id}:skip` },
      ],
    ];
  }
  return [
    [
      { text: '✅ Approve', callback_data: `capture:${id}:approve` },
      { text: '✏️ Edit', callback_data: `capture:${id}:edit` },
      { text: '❌ Skip', callback_data: `capture:${id}:skip` },
    ],
  ];
}

async function postCaptureDrafts(
  bot: TelegramBot,
  chatId: number,
  summary: string,
  drafts: TaskDraftRow[],
): Promise<void> {
  if (drafts.length === 0) {
    await bot.sendMessage(chatId, formatCaptureNoTasks());
    return;
  }

  await bot.sendMessage(chatId, formatCaptureSummary(summary, drafts.length));

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]!;
    await bot.sendInlineKeyboard(
      chatId,
      formatCaptureTaskLine({
        index: i + 1,
        title: draft.extracted_title,
        project: draft.project,
        owner: draft.owner,
        dueDate: draft.due_date,
        needsClarification: draft.needs_clarification,
      }),
      buildTaskButtons(draft),
    );
  }
}

export async function startCapture(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  sourceType: SourceType,
): Promise<void> {
  clearSession(chatId);

  const timeoutId = setTimeout(() => {
    if (!sessions.has(chatId)) return;
    clearSession(chatId);
    console.log(`[capture] Session timed out for chat ${chatId}`);
    void bot
      .sendMessage(
        chatId,
        `⏱ <b>Capture timed out.</b> Send /capture again when you're ready.`,
      )
      .catch(() => undefined);
  }, timeoutMs());

  sessions.set(chatId, { userId, sourceType, timeoutId });
  console.log(`[capture] Awaiting transcript from user ${userId} in chat ${chatId}`);

  await bot.sendMessage(chatId, formatCapturePrompt(sourceType), 'HTML', {
    forceReply: true,
  });
}

export async function handleCaptureCommand(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  fromName: string,
  args: string,
): Promise<void> {
  const trimmed = args.trim();
  let sourceType: SourceType = 'sprint_meeting';
  let transcriptCandidate = trimmed;

  if (/^(customer|customer_meeting)\b/i.test(trimmed)) {
    sourceType = 'customer_meeting';
    transcriptCandidate = trimmed.replace(/^(customer|customer_meeting)\s*/i, '').trim();
  } else if (/^(sprint|sprint_meeting)\b/i.test(trimmed)) {
    sourceType = 'sprint_meeting';
    transcriptCandidate = trimmed.replace(/^(sprint|sprint_meeting)\s*/i, '').trim();
  }

  if (transcriptCandidate.length >= MIN_TRANSCRIPT_LENGTH) {
    await processTranscript(bot, chatId, userId, fromName, transcriptCandidate, sourceType);
    return;
  }

  await startCapture(bot, chatId, userId, sourceType);
}

export async function handleCaptureTranscript(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  fromName: string,
  text: string,
): Promise<void> {
  const session = sessions.get(chatId);
  if (!session) return;

  if (session.userId !== userId) {
    await bot.sendMessage(
      chatId,
      '⏳ Someone else started a capture here — only they can paste the notes.',
    );
    return;
  }

  clearSession(chatId);
  await processTranscript(bot, chatId, userId, fromName, text, session.sourceType);
}

async function processTranscript(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  fromName: string,
  transcript: string,
  sourceType: SourceType,
): Promise<void> {
  if (transcript.length < MIN_TRANSCRIPT_LENGTH) {
    await bot.sendMessage(
      chatId,
      `⚠️ Notes are too short (need at least ${MIN_TRANSCRIPT_LENGTH} characters). Try /capture again.`,
    );
    return;
  }

  console.log(`[capture] Processing transcript from ${fromName} (${userId}), ${transcript.length} chars`);

  await bot.sendMessage(chatId, formatCaptureProcessing()).catch(() => undefined);

  let trello;
  try {
    trello = createTrelloClient();
  } catch (err) {
    console.error('[capture] Trello config error:', err);
    await bot.sendMessage(chatId, '⚠️ Trello is not configured. Check worker logs.');
    return;
  }

  let existingProjects: string[];
  let teamContext: TeamContext | null;

  try {
    const [lists, ctx] = await Promise.all([
      trello.getLists(),
      buildTeamContext(trello),
    ]);
    existingProjects = lists.filter((l) => !l.closed).map((l) => l.name);
    teamContext = ctx;
  } catch (err) {
    console.error('[capture] Failed to fetch Trello context:', err);
    await bot.sendMessage(chatId, '⚠️ Could not load Trello board data. Try again later.');
    return;
  }

  const { data: meeting, error: meetingInsertError } = await db
    .from('meetings')
    .insert({
      source_type: sourceType,
      source_channel: 'telegram',
      raw_transcript: transcript,
    })
    .select('id')
    .single();

  if (meetingInsertError || !meeting) {
    console.error('[capture] Failed to save meeting:', meetingInsertError);
    await bot.sendMessage(chatId, '⚠️ Could not save meeting. Check worker logs.');
    return;
  }

  let result: ExtractionResult;
  try {
    result = await extractTasksFromNotes({
      sourceText: transcript,
      sourceType,
      existingProjects,
      teamContext,
    });
  } catch (err) {
    console.error('[capture] Extraction failed:', err);
    await bot.sendMessage(
      chatId,
      `⚠️ Extraction failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return;
  }

  const { error: meetingUpdateError } = await db
    .from('meetings')
    .update({ summary: result.summary })
    .eq('id', meeting.id);

  if (meetingUpdateError) {
    console.error('[capture] Failed to update meeting summary:', meetingUpdateError);
  }

  const draftRows = await resolveTrelloMemberIds(
    buildDraftInsertRows(result, meeting.id, teamContext),
  );

  const { data: drafts, error: insertError } = await db
    .from('task_drafts')
    .insert(draftRows)
    .select();

  if (insertError) {
    console.error('[capture] Failed to insert task drafts:', insertError);
    await bot.sendMessage(chatId, '⚠️ Could not save extracted tasks. Check worker logs.');
    return;
  }

  console.log('[capture] Posted drafts:', {
    meeting_id: meeting.id,
    chat_id: chatId,
    task_count: drafts?.length ?? 0,
  });

  try {
    await postCaptureDrafts(bot, chatId, result.summary, drafts ?? []);
  } catch (err) {
    console.error('[capture] Failed to post task messages:', err);
    await bot.sendMessage(chatId, '⚠️ Tasks were saved but could not be posted to Telegram.');
  }
}
