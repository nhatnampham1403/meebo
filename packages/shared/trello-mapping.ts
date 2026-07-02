import type { Database } from './supabase-types';

type TaskDraftRow = Database['public']['Tables']['task_drafts']['Row'];
type TeamMemberRow = Database['public']['Tables']['team_members']['Row'];

export interface TrelloCardFields {
  name: string;
  desc: string;
  idMembers: string[];
  due: string | null;
}

function formatSourceType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function draftToTrelloCard(
  draft: TaskDraftRow,
  member: TeamMemberRow | TeamMemberRow[] | null,
): TrelloCardFields {
  const members = Array.isArray(member) ? member : member ? [member] : [];
  const idMembers = Array.from(
    new Set(members.map((m) => m.trello_member_id).filter(Boolean)),
  );
  const lines: string[] = [
    '## Context',
    draft.context,
    '',
    '## Definition of Done',
    draft.definition_of_done,
    '',
    '## Details',
    `- **Source:** ${formatSourceType(draft.source_type)}`,
    `- **Priority:** ${draft.priority}`,
  ];

  if (draft.due_date) {
    lines.push(`- **Due:** ${draft.due_date}`);
  }
  if (draft.external_party) {
    lines.push(`- **External Party:** ${draft.external_party}`);
  }
  if (draft.decision_needed) {
    lines.push('- **Decision Required:** Yes — confirm before starting');
  }

  lines.push('', '---', '*Extracted from meeting notes by MeeBo*');

  return {
    name: draft.extracted_title,
    desc: lines.join('\n'),
    idMembers,
    due: draft.due_date ?? null,
  };
}
