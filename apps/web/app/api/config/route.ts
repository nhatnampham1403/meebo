import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { TrelloClient } from '@/lib/trello';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [{ data: teamMembers, error: membersError }, trelloLists, { data: config, error: configError }] =
    await Promise.all([
      db.from('team_members').select('*').order('display_name'),
      (async () => {
        try {
          const trello = new TrelloClient();
          return await trello.getLists();
        } catch {
          return [];
        }
      })(),
      db.from('trello_config').select('*'),
    ]);

  if (membersError) {
    return NextResponse.json(
      { error: `Failed to fetch team members: ${membersError.message}` },
      { status: 500 },
    );
  }
  if (configError) {
    return NextResponse.json(
      { error: `Failed to fetch config: ${configError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    teamMembers: teamMembers ?? [],
    trelloLists,
    config: config ?? [],
  });
}

const UpdateMemberSchema = z.object({
  type: z.literal('team_member'),
  id: z.string().uuid().optional(),
  display_name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  role: z.string().min(1),
  skills: z.array(z.string()),
  trello_member_id: z.string().optional(),
  is_active: z.boolean().optional(),
});

const DeleteMemberSchema = z.object({
  type: z.literal('delete_team_member'),
  id: z.string().uuid(),
});

const UpdateConfigSchema = z.object({
  type: z.literal('trello_config'),
  key: z.string().min(1),
  value: z.string(),
});

const PutSchema = z.discriminatedUnion('type', [
  UpdateMemberSchema,
  DeleteMemberSchema,
  UpdateConfigSchema,
]);

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const data = parsed.data;

  if (data.type === 'team_member') {
    const { type: _t, id, ...fields } = data;
    if (id) {
      const { data: updated, error } = await db
        .from('team_members')
        .update(fields)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json(updated);
    } else {
      const insertData = {
        display_name: fields.display_name,
        email: fields.email ?? null,
        role: fields.role,
        skills: fields.skills,
        trello_member_id: fields.trello_member_id ?? '',
        is_active: fields.is_active ?? true,
      };
      const { data: created, error } = await db
        .from('team_members')
        .insert(insertData)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json(created, { status: 201 });
    }
  }

  if (data.type === 'delete_team_member') {
    const { error } = await db
      .from('team_members')
      .update({ is_active: false })
      .eq('id', data.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (data.type === 'trello_config') {
    const { error } = await db
      .from('trello_config')
      .upsert({ key: data.key, value: data.value });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
}
