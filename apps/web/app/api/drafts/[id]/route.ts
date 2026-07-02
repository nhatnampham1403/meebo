import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Priority } from '@trello-optimization/shared';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  extracted_title: z.string().min(1).optional(),
  project: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  owners: z.array(z.string()).optional(),
  trello_member_id: z.string().nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: Priority.optional(),
  review_status: z.enum(['pending', 'needs_clarification', 'rejected']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await db
    .from('task_drafts')
    .update(parsed.data)
    .eq('id', id)
    .neq('review_status', 'approved')
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Update failed: ${error.message}` },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: 'Draft not found or already approved' },
      { status: 404 },
    );
  }

  // Implicit review: if a manager edits a needs_clarification draft so that it
  // now has an owner and a due date, treat that edit as "I've reviewed this"
  // and flip it back to pending so the Approve button unlocks. Never
  // auto-approve, and never touch drafts the caller explicitly re-statused.
  const hasOwner = (data.owners && data.owners.length > 0) || data.owner != null;
  const hasDueDate = data.due_date != null;
  const callerSetStatus = parsed.data.review_status !== undefined;

  if (
    !callerSetStatus &&
    data.review_status === 'needs_clarification' &&
    hasOwner &&
    hasDueDate
  ) {
    const { data: promoted, error: promoteError } = await db
      .from('task_drafts')
      .update({ review_status: 'pending' })
      .eq('id', id)
      .eq('review_status', 'needs_clarification')
      .select()
      .single();

    if (!promoteError && promoted) {
      return NextResponse.json(promoted);
    }
  }

  return NextResponse.json(data);
}
