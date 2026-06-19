import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  query: z.string().min(1),
});

interface TrelloMemberResult {
  id: string;
  fullName: string;
  username: string;
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

  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    return NextResponse.json(
      { error: 'Trello credentials not configured' },
      { status: 500 },
    );
  }

  const { query } = parsed.data;
  const url = `https://api.trello.com/1/members/${encodeURIComponent(query)}?key=${key}&token=${token}&fields=id,fullName,username`;

  let member: TrelloMemberResult;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Trello member not found' },
        { status: 404 },
      );
    }
    member = (await res.json()) as TrelloMemberResult;
  } catch (err) {
    return NextResponse.json(
      { error: `Trello lookup failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    trello_member_id: member.id,
    full_name: member.fullName,
    username: member.username,
  });
}
