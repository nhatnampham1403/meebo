/**
 * /capture flow — awaiting-transcript state + extraction (P6.T2).
 * In-memory sessions reset on worker restart.
 */
import type { TelegramBot } from '../lib/telegram';
import { extractTasksFromNotes, type TeamContext } from '@trello-optimization/shared';
import { db } from '../lib/db';
import { createTrelloClient } from '../lib/trello';
import type { TrelloWorkerClient } from '../lib/trello';

const MIN_TRANSCRIPT_LENGTH = 10;
const DEFAULT_TIMEOUT_MINUTES = 10;

type SourceType = 'sprint_meeting' | 'customer_meeting';

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

function formatCapturePrompt(sourceType: SourceType): string {
  const typeHint =
    sourceType === 'customer_meeting'
      ? 'customer meeting'
      : 'sprint meeting';
  return (
    `📋 <b>Capture mode</b> (${typeHint})\n\n` +
    `Paste your meeting notes in your next message.\n\n` +
    `<i>Tip: use /capture customer for customer meetings, /capture sprint for sprint (default).</i>`
  );
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

  await bot.sendMessage(chatId, formatCapturePrompt(sourceType));
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

  let result;
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

  console.log('[capture] Extraction result:', JSON.stringify({
    meeting_id: meeting.id,
    chat_id: chatId,
    user_id: userId,
    source_type: sourceType,
    summary: result.summary,
    task_count: result.tasks.length,
    tasks: result.tasks.map((t) => ({
      title: t.extracted_title,
      project: t.project,
      owner: t.owner,
      needs_clarification: t.needs_clarification,
    })),
  }));

  const taskWord = result.tasks.length === 1 ? 'task' : 'tasks';
  await bot.sendMessage(
    chatId,
    `✅ <b>Captured.</b> Found ${result.tasks.length} ${taskWord}.\n\n` +
      `<b>Summary:</b> ${result.summary.slice(0, 500)}${result.summary.length > 500 ? '…' : ''}\n\n` +
      `<i>Meeting saved (${meeting.id.slice(0, 8)}…). Task review coming in a future update.</i>`,
  );
}
