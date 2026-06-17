/**
 * Vendor Follow-up — 08:30 every day
 * Lists approved cards sourced from customer meetings where the
 * linked Trello card has had no activity in 3+ days.
 * Idempotency: one digest_log row per card per day.
 */
import { db } from '../lib/db';
import { createBot, requireGroupChatId } from '../lib/telegram';
import { createTrelloClient, daysAgo } from '../lib/trello';
import { formatVendorFollowup } from '../lib/messages';

async function alreadySentCard(cardId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]!;
  const { data } = await db
    .from('digest_log')
    .select('id')
    .eq('job_name', 'vendor')
    .eq('reference_id', cardId)
    .eq('sent_date', today)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function markCard(cardId: string): Promise<void> {
  await db.from('digest_log').insert({ job_name: 'vendor', reference_id: cardId });
}

async function loadMemberMap(): Promise<Map<string, string>> {
  const { data } = await db.from('team_members').select('trello_member_id, display_name');
  const map = new Map<string, string>();
  for (const m of data ?? []) map.set(m.trello_member_id, m.display_name);
  return map;
}

export async function runVendor(): Promise<void> {
  const JOB = 'vendor';
  console.log(`[${JOB}] Starting`);

  const { data: drafts } = await db
    .from('task_drafts')
    .select('trello_card_id, external_party, extracted_title')
    .not('trello_card_id', 'is', null)
    .not('external_party', 'is', null)
    .eq('review_status', 'approved');

  if (!drafts || drafts.length === 0) {
    console.log(`[${JOB}] No vendor-tracked cards found`);
    return;
  }

  const externalMap = new Map(drafts.map((d) => [d.trello_card_id!, d.external_party!]));
  const waitingIds = new Set(externalMap.keys());

  const groupId = requireGroupChatId();
  const trello = createTrelloClient();
  const memberMap = await loadMemberMap();
  const ctx = await trello.buildContext(memberMap);

  const waiting = ctx.filter(
    ({ card }) => waitingIds.has(card.id) && daysAgo(card.dateLastActivity) >= 3,
  );

  let sent = 0;
  const bot = createBot();

  for (const { card, listName, ownerNames } of waiting) {
    if (await alreadySentCard(card.id)) continue;

    const ext = externalMap.get(card.id) ?? 'external party';
    const idle = Math.round(daysAgo(card.dateLastActivity));

    await bot.sendMessage(
      groupId,
      formatVendorFollowup(card, listName, ownerNames, ext, idle),
    );
    await markCard(card.id);
    sent++;
  }

  console.log(`[${JOB}] Sent ${sent} vendor follow-up(s)`);
}
