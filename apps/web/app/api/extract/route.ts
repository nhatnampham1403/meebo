import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SourceType } from '@trello-optimization/shared';
import { db } from '@/lib/db';
import { TrelloClient } from '@/lib/trello';
import { extractTasksFromNotes } from '@/lib/openai';
import type { TeamContext } from '@/lib/openai';

export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  source_text: z.string().min(10, 'Notes must be at least 10 characters'),
  source_type: SourceType,
});

async function buildTeamContext(trello: TrelloClient): Promise<TeamContext | null> {
  try {
    const { data: members } = await db
      .from('team_members')
      .select('*')
      .eq('is_active', true);

    if (!members || members.length === 0) return null;

    const cardCounts = await trello.getOpenCardCountByMember();

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

  const { source_text, source_type } = parsed.data;

  let trello: TrelloClient;
  try {
    trello = new TrelloClient();
  } catch (err) {
    return NextResponse.json(
      { error: `Trello config error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  let existingProjects: string[];
  let teamContext: TeamContext | null;

  try {
    const [lists, ctx] = await Promise.all([
      trello.getLists(),
      buildTeamContext(trello),
    ]);
    existingProjects = lists.map((l) => l.name);
    teamContext = ctx;
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch Trello data: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  let result;
  try {
    result = await extractTasksFromNotes({
      sourceText: source_text,
      sourceType: source_type,
      existingProjects,
      teamContext,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Extraction failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const teamMembers = teamContext?.members ?? [];

  const rows = result.tasks.map((task) => {
    const matchedMember = teamMembers.find(
      (m) => m.display_name.toLowerCase() === (task.owner ?? '').toLowerCase(),
    );

    return {
      extracted_title: task.extracted_title,
      project: task.project,
      owner: task.owner,
      trello_member_id: null as string | null,
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
      review_status: (task.needs_clarification ? 'needs_clarification' : 'pending') as
        | 'pending'
        | 'needs_clarification',
      _ownerDisplayName: matchedMember?.display_name ?? null,
    };
  });

  if (teamContext) {
    const { data: dbMembers } = await db
      .from('team_members')
      .select('display_name, trello_member_id');

    if (dbMembers) {
      for (const row of rows) {
        const match = dbMembers.find(
          (m) =>
            m.display_name.toLowerCase() ===
            (row._ownerDisplayName ?? '').toLowerCase(),
        );
        if (match) row.trello_member_id = match.trello_member_id;
      }
    }
  }

  const insertRows = rows.map(({ _ownerDisplayName: _ignored, ...rest }) => rest);

  const { data: drafts, error: insertError } = await db
    .from('task_drafts')
    .insert(insertRows)
    .select();

  if (insertError) {
    return NextResponse.json(
      { error: `DB insert failed: ${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ summary: result.summary, drafts });
}
