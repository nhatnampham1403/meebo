import { daysAgo, daysFromNow, formatDate, type CardContext, type TrelloCard } from './trello';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function escape(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Digest scheduler line — escapes owner names. */
function digestLine(
  name: string,
  url: string,
  listName: string,
  owners: string[],
  suffix: string,
): string {
  const o = owners.length ? ` · <i>${owners.map(escape).join(', ')}</i>` : '';
  return `• <a href="${url}">${escape(name)}</a> [${escape(listName)}]${o} · ${suffix}`;
}

/** Command bullet — does not escape owner names (preserves existing behaviour). */
function commandBullet(
  card: { name: string; shortUrl: string },
  listName: string,
  owners: string[],
  suffix?: string,
): string {
  const ownerStr = owners.length ? ` · <i>${owners.join(', ')}</i>` : '';
  const suffixStr = suffix ? ` · ${suffix}` : '';
  return `• <a href="${card.shortUrl}">${escape(card.name)}</a> [${escape(listName)}]${ownerStr}${suffixStr}`;
}

export type CheckinResponse = 'done' | 'in_progress' | 'blocked';

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

// ─── Scheduler messages ───────────────────────────────────────────────────────

export function formatDigest(
  overdue: CardContext[],
  today: CardContext[],
  week: CardContext[],
): string {
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
            digestLine(
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
            digestLine(card.name, card.shortUrl, listName, ownerNames, formatDate(card.due!)),
          )
          .join('\n'),
    );
  }

  if (week.length) {
    sections.push(
      `\n⏰ <b>Due This Week (${week.length})</b>\n` +
        week
          .map(({ card, listName, ownerNames }) =>
            digestLine(card.name, card.shortUrl, listName, ownerNames, formatDate(card.due!)),
          )
          .join('\n'),
    );
  }

  if (!overdue.length && !today.length && !week.length) {
    sections.push('\n✅ All clear — no overdue or upcoming tasks.');
  }

  return sections.join('\n');
}

export function formatDeadlineAlert(
  card: TrelloCard,
  listName: string,
  ownerNames: string[],
): string {
  const o = ownerNames.length ? ` · <i>${ownerNames.map(escape).join(', ')}</i>` : '';
  const when = daysFromNow(card.due!) <= 1 ? 'TODAY' : 'TOMORROW';
  return (
    `⚠️ <b>Due ${when}</b>\n` +
    `<a href="${card.shortUrl}">${escape(card.name)}</a> [${escape(listName)}]${o}\n` +
    `📅 ${formatDate(card.due!)}`
  );
}

export function formatStaleEmpty(): string {
  return '✅ <b>Stale Cards</b> — No stale cards this week!';
}

export function formatStaleReport(stale: CardContext[]): string {
  const lines = stale.map(({ card, listName, ownerNames }) => {
    const idle = Math.round(daysAgo(card.dateLastActivity));
    const dueStr = card.due ? ` · due ${formatDate(card.due)}` : '';
    const o = ownerNames.length ? ` · <i>${ownerNames.map(escape).join(', ')}</i>` : '';
    return `• <a href="${card.shortUrl}">${escape(card.name)}</a> [${escape(listName)}]${o} · ${idle}d idle${dueStr}`;
  });

  return `🕸 <b>Stale Cards — ${stale.length} card(s) with 7+ days no activity</b>\n\n${lines.join('\n')}`;
}

export function formatVendorFollowup(
  card: TrelloCard,
  listName: string,
  ownerNames: string[],
  externalParty: string,
  idleDays: number,
): string {
  const o = ownerNames.length ? ` · <i>${ownerNames.map(escape).join(', ')}</i>` : '';
  return (
    `📦 <b>Follow-up needed</b>\n` +
    `<a href="${card.shortUrl}">${escape(card.name)}</a> [${escape(listName)}]${o}\n` +
    `Waiting on <b>${escape(externalParty)}</b> · ${idleDays}d no activity`
  );
}

export function formatCheckinPrompt(
  cardName: string,
  listName: string,
  dueFormatted: string,
  memberName: string,
): string {
  return (
    `👋 <b>Check-in: ${escape(cardName)}</b>\n\n` +
    `📁 Project: ${escape(listName)}\n` +
    `📅 Due: ${dueFormatted}\n\n` +
    `How's it going, ${escape(memberName)}?`
  );
}

export function formatCheckinReminder(cardName: string, cardUrl: string): string {
  const cardLink = cardUrl
    ? `<a href="${cardUrl}">${escape(cardName)}</a>`
    : `<code>${escape(cardName)}</code>`;

  return (
    `⏰ <b>Reminder</b>\n\n` +
    `You haven't responded to the check-in for:\n${cardLink}\n\n` +
    `Please tap a button — your team is waiting!`
  );
}

export function formatEscalation(
  memberName: string,
  cardName: string,
  cardUrl: string,
): string {
  const cardLink = cardUrl
    ? `<a href="${cardUrl}">${escape(cardName)}</a>`
    : `<code>${escape(cardName)}</code>`;

  return (
    `⚠️ <b>No response — escalation</b>\n\n` +
    `<b>${escape(memberName)}</b> did not respond to their check-in.\n` +
    `Card: ${cardLink}\n` +
    `Prompted 48h ago — marked as timed out.`
  );
}

export function formatCheckinConfirmation(
  response: CheckinResponse,
  memberName: string,
): string {
  return (
    `${RESPONSE_EMOJI[response]} <b>Recorded: ${escape(RESPONSE_LABEL[response])}</b>\n\n` +
    `Your Trello card has been updated. Thank you, ${escape(memberName)}!`
  );
}

export function formatCheckinCallbackAck(response: CheckinResponse): string {
  return `${RESPONSE_EMOJI[response]} ${RESPONSE_LABEL[response]} — logged!`;
}

export function formatCheckinTrelloComment(
  memberName: string,
  response: CheckinResponse,
  dateStr: string,
): string {
  return `[MeeBo check-in] ${memberName} reported: ${RESPONSE_LABEL[response]} on ${dateStr}`;
}

// ─── Command messages ───────────────────────────────────────────────────────────

export function formatStart(): string {
  return (
    `👋 <b>MeeBo here!</b> I keep the team synced with Trello.\n\n` +
    `<b>Commands:</b>\n` +
    `/overdue — overdue cards\n` +
    `/today — cards due today\n` +
    `/waiting — waiting on external parties\n` +
    `/blocked — blocked cards\n` +
    `/summary — board stats\n` +
    `/capture — paste meeting notes to extract tasks`
  );
}

export function formatOverdueEmpty(): string {
  return '✅ <b>No overdue cards!</b> Great work.';
}

export function formatOverdue(overdue: CardContext[]): string {
  const sorted = [...overdue].sort(
    (a, b) => daysFromNow(a.card.due!) - daysFromNow(b.card.due!),
  );
  const lines = sorted.map(({ card, listName, ownerNames }) => {
    const late = Math.round(daysAgo(card.due!));
    return commandBullet(card, listName, ownerNames, `<b>${late}d late</b>`);
  });
  return `🔴 <b>Overdue Cards (${overdue.length})</b>\n\n${lines.join('\n')}`;
}

export function formatNoItems(): string {
  return '✅ Nothing to report.';
}

export function formatToday(today: CardContext[]): string {
  const lines = today.map(({ card, listName, ownerNames }) =>
    commandBullet(card, listName, ownerNames, formatDate(card.due!)),
  );
  return `📅 <b>Due Today (${today.length})</b>\n\n${lines.join('\n')}`;
}

export function formatWaiting(
  waiting: CardContext[],
  externalPartyByCardId: Map<string, string>,
): string {
  const lines = waiting.map(({ card, listName, ownerNames }) => {
    const idle = Math.round(daysAgo(card.dateLastActivity));
    const ext = externalPartyByCardId.get(card.id) ?? 'external party';
    return commandBullet(card, listName, ownerNames, `waiting on ${escape(ext)} · ${idle}d idle`);
  });
  return `📦 <b>Waiting on External (${waiting.length})</b>\n\n${lines.join('\n')}`;
}

export function formatBlockedEmpty(): string {
  return '✅ <b>No blocked cards.</b>';
}

export function formatBlocked(blocked: CardContext[]): string {
  const lines = blocked.map(({ card, listName, ownerNames }) =>
    commandBullet(card, listName, ownerNames),
  );
  return `🚫 <b>Blocked Cards (${blocked.length})</b>\n\n${lines.join('\n')}`;
}

export interface SummaryStats {
  total: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  stale: number;
  blocked: number;
}

export function formatSummary(stats: SummaryStats): string {
  const lines = [
    `📊 <b>Board Summary</b>`,
    ``,
    `🗂 Total cards: <b>${stats.total}</b>`,
    `🔴 Overdue: <b>${stats.overdue}</b>`,
    `📅 Due today: <b>${stats.dueToday}</b>`,
    `⏰ Due this week: <b>${stats.dueSoon}</b>`,
    `🕸 Stale (7d+ idle): <b>${stats.stale}</b>`,
    `🚫 Blocked: <b>${stats.blocked}</b>`,
  ];
  return lines.join('\n');
}

// ─── Capture messages ───────────────────────────────────────────────────────────

export function formatCapturePrompt(sourceType: 'sprint_meeting' | 'customer_meeting'): string {
  const typeHint =
    sourceType === 'customer_meeting' ? 'customer meeting' : 'sprint meeting';
  return (
    `📋 <b>Capture mode</b> (${typeHint})\n\n` +
    `<b>Reply to this message</b> with your meeting notes or upload a <b>PDF</b>.\n` +
    `(In group chats, reply so the bot receives your message.)\n\n` +
    `<i>Tip: /capture customer or /capture sprint — paste notes in one message, or send a PDF.</i>`
  );
}

export function formatCaptureUnsupportedDocument(): string {
  return 'Please send a PDF file. Other formats are not supported yet.';
}

export function formatCapturePdfExtractFailed(): string {
  return '⚠️ Could not read text from that PDF. Try a text-based PDF or paste the notes instead.';
}

export function formatCaptureProcessing(): string {
  return '⏳ <b>Processing meeting notes…</b> This may take 30–60 seconds.';
}

export function formatCaptureSummary(summary: string, taskCount: number): string {
  const taskWord = taskCount === 1 ? 'task' : 'tasks';
  const preview = escape(summary.slice(0, 800));
  const suffix = summary.length > 800 ? '…' : '';
  return (
    `📝 <b>Meeting summary</b>\n\n${preview}${suffix}\n\n` +
    `Found <b>${taskCount}</b> ${taskWord} — review each below.`
  );
}

export function formatCaptureNoTasks(): string {
  return '📝 <b>Meeting summary saved.</b>\n\nNo actionable tasks were found in these notes.';
}

export interface CaptureTaskLine {
  index: number;
  title: string;
  project: string | null;
  owner: string | null;
  dueDate: string | null;
  needsClarification: boolean;
}

export function formatCaptureTaskLine(task: CaptureTaskLine): string {
  const meta: string[] = [];
  if (task.project) meta.push(escape(task.project));
  if (task.owner) meta.push(escape(task.owner));
  if (task.dueDate) meta.push(escape(task.dueDate));
  const metaStr = meta.length ? `\n<i>${meta.join(' · ')}</i>` : '';
  const flag = task.needsClarification ? '\n⚠️ <b>Needs review on web</b>' : '';
  return `<b>${task.index}.</b> ${escape(task.title)}${metaStr}${flag}`;
}

export function formatCaptureTaskCreated(title: string, cardUrl: string): string {
  return `✅ <b>Created</b> — <a href="${cardUrl}">${escape(title)}</a>`;
}

export function formatCaptureTaskSkipped(title: string): string {
  return `❌ <b>Skipped</b> — ${escape(title)}`;
}

export function formatCaptureApproveAck(): string {
  return '✅ Card created!';
}

export function formatCaptureSkipAck(): string {
  return 'Skipped';
}

export function formatCaptureEditAck(): string {
  return 'Open web editor →';
}

export function formatCaptureEditReply(link: string): string {
  return `✏️ <b>Edit this task on the web:</b>\n<a href="${link}">${escape(link)}</a>`;
}

export function formatCaptureAlreadyApproved(): string {
  return '✅ Already approved';
}

export function formatCaptureAlreadySkipped(): string {
  return 'Already skipped';
}

export function formatCaptureNeedsClarificationBlock(): string {
  return '⚠️ Edit on web first — Approve is disabled for this task';
}

export function formatCaptureDraftNotFound(): string {
  return '❌ Task not found';
}

export function formatCaptureApproveFailed(): string {
  return '⚠️ Could not create card — check worker logs';
}
