import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { draftToTrelloCard } from '@trello-optimization/shared';
import type { Database } from '@trello-optimization/shared';
import { db } from '@/lib/db';
import { TrelloClient } from '@/lib/trello';

export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  draft_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { draft_id } = parsed.data;

  const { data: draft, error: draftError } = await db
    .from('task_drafts')
    .select('*')
    .eq('id', draft_id)
    .single();

  if (draftError || !draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  if (draft.review_status === 'approved' && draft.trello_card_id) {
    return NextResponse.json(
      { status: 'already_approved', card_url: draft.trello_card_url },
      { status: 200 },
    );
  }

  let trello: TrelloClient;
  try {
    trello = new TrelloClient();
  } catch (err) {
    return NextResponse.json(
      { error: `Trello config error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Resolve ALL owners to team_members. Members not found are skipped with a
  // warning (approval still proceeds). Falls back to the legacy single
  // owner/trello_member_id when the owners array is empty.
  type MemberRow = Database['public']['Tables']['team_members']['Row'];
  const resolvedMembers: MemberRow[] = [];
  const seenMemberIds = new Set<string>();

  function addMember(m: MemberRow | null) {
    if (m && m.trello_member_id && !seenMemberIds.has(m.trello_member_id)) {
      seenMemberIds.add(m.trello_member_id);
      resolvedMembers.push(m);
    }
  }

  const ownerNames: string[] =
    draft.owners && draft.owners.length > 0
      ? draft.owners
      : draft.owner
        ? [draft.owner]
        : [];

  for (const name of ownerNames) {
    const { data: memberRow } = await db
      .from('team_members')
      .select('*')
      .ilike('display_name', name)
      .maybeSingle();
    if (memberRow) {
      addMember(memberRow);
    } else {
      console.warn(`[approve] Owner "${name}" not found in team_members — skipping assignment`);
    }
  }

  // Legacy fallback: if the draft carried a trello_member_id but no name matched.
  if (resolvedMembers.length === 0 && draft.trello_member_id) {
    const { data: memberRow } = await db
      .from('team_members')
      .select('*')
      .eq('trello_member_id', draft.trello_member_id)
      .maybeSingle();
    addMember(memberRow);
  }

  const member = resolvedMembers.length > 0 ? resolvedMembers : null;

  let listId: string;
  try {
    const projectName = draft.project ?? draft.suggested_list ?? 'Inbox';
    listId = await trello.resolveOrCreateList(projectName);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to resolve Trello list: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const cardFields = draftToTrelloCard(draft, member);
  const cardPayload = { ...cardFields, idList: listId };

  let card;
  try {
    card = await trello.createCard(cardPayload);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create Trello card: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  if (draft.checklist && draft.checklist.length > 0) {
    try {
      await trello.addChecklist(card.id, 'Subtasks', draft.checklist);
    } catch {
      // Non-fatal: card was created, checklist is nice-to-have
    }
  }

  // Idempotent write-back: only update if trello_card_id is still NULL
  const { data: updated } = await db
    .from('task_drafts')
    .update({
      trello_card_id: card.id,
      trello_card_url: card.shortUrl,
      review_status: 'approved',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', draft_id)
    .is('trello_card_id', null)
    .select()
    .single();

  if (!updated) {
    // Race condition: another request approved this draft first
    // Archive the card we just created to avoid a duplicate
    try {
      await trello.archiveCard(card.id);
    } catch {
      // Log-worthy but don't fail the response
    }
    return NextResponse.json(
      { status: 'already_approved', card_url: draft.trello_card_url },
      { status: 200 },
    );
  }

  return NextResponse.json({
    status: 'approved',
    card_url: card.shortUrl,
    card_id: card.id,
  });
}
