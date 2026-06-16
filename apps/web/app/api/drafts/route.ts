import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await db
    .from('task_drafts')
    .select('*')
    .order('extracted_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch drafts: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(data);
}
