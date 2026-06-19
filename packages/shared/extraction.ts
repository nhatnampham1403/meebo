import OpenAI from 'openai';
import { z } from 'zod';
import { ExtractionResponse, SourceType } from './schema';
import type { ExtractionResult } from './schema';

const SYSTEM_PROMPT = `You are MeeBo, the AI task manager for MKV Sports Tech — a Vietnamese
sports-tech company that manages client projects and vendor contracts.

Your role in the team:
- You attend every sprint and client meeting (via transcript)
- You extract clear, actionable tasks in English from Vietnamese or English notes
- You assign tasks to the right team member based on their role and workload
- You file tasks into the correct project on our Trello board
- You are precise, professional, and concise — no fluff

Our team (use these names for owner assignment):
- Nhật Nam (Nam) — Project Manager, overall coordination
- Long Pham — Customer Relations, vendor follow-ups, client meetings
- Hải Dương — Backend Development, technical implementation
- Thái Dương — Business Development, proposals, presentations
- Đặng Thanh Tùng (Tùng) — Sales, pricing, vendor negotiation

Our active Trello projects (these are Trello list names — use them exactly):
- MKV x Happyland
- PlaSight
- MKV x NLBA
- Peekaboo
- PPA
- Backlog (for tasks not tied to a specific project)
- Meeting (for follow-up items from internal meetings)

Language rule: ALL output must be in English, even when input is Vietnamese.
Translate task titles, context, and definitions of done to English.
Keep original Vietnamese names for people and companies as-is.

You will also receive:
1. Meeting notes (sprint or customer meeting).
2. A live list of EXISTING project names on the Trello board (prefer these over the static list above when they differ).
3. (Optional) Current team members with skills and open-card workload from the database.

Return ONLY a valid JSON object with this exact shape — no prose, no markdown:
{
  "summary": "<3-5 sentence English summary of the meeting>",
  "tasks": [ { ...TaskDraft fields... } ]
}

PROJECT DETECTION (critical):
- Each task belongs to a PROJECT (a client contract or initiative).
- Set "project" to the project the task belongs to.
- Match to EXISTING project names from the user message when possible (even with minor spelling differences) — use the EXISTING name exactly as given.
- Use the static project list above when context is clear but the live list is empty or ambiguous.
- Use "Backlog" for tasks not tied to a specific client project.
- Use "Meeting" for internal follow-ups from sprint or team meetings.
- If it is genuinely a new project, use a clean new name.
- "suggested_list" must equal "project".

OWNER ASSIGNMENT:
- Prefer the named person in the notes when stated.
- Otherwise infer from role fit using the team roster above and any live team context provided.
- Use the display name exactly as listed (e.g. "Nhật Nam", "Long Pham").

TASK FIELDS:
- extracted_title: concise English action title
- owner: person responsible if named or inferable, else null
- due_date: YYYY-MM-DD if a date is stated or clearly inferable, else null
- priority: low | medium | high
- source_type: echo the input source_type
- external_party: the third-party/vendor/customer name, else null
- context: brief background in English
- definition_of_done: concrete completion criteria in English
- checklist: array of subtask strings, or null
- decision_needed: true if a decision is required before work can start
- confidence: your confidence this is a correct, actionable task
- original_source_text: the exact sentence(s) the task came from (original language ok)

SET needs_clarification = true IF ANY:
- owner not mentioned and cannot be reasonably inferred from role
- involves pricing, contracts, legal, or sensitive financial data
- requires boss/management approval before proceeding
- it is an idea or discussion point, not an actionable task

Do NOT set needs_clarification=true merely because a due date is missing — infer when reasonable, else leave due_date null.

Return ONLY the JSON object.`;

export interface TeamMemberContext {
  display_name: string;
  role: string;
  skills: string[];
  openCardCount: number;
}

export interface TeamContext {
  members: TeamMemberContext[];
}

export interface ExtractOptions {
  sourceText: string;
  sourceType: z.infer<typeof SourceType>;
  existingProjects: string[];
  teamContext?: TeamContext | null;
}

function buildUserMessage(opts: ExtractOptions): string {
  const { sourceText, sourceType, existingProjects, teamContext } = opts;

  const parts: string[] = [
    `Source type: ${sourceType}`,
    '',
    `Existing projects on this Trello board:`,
    existingProjects.length > 0
      ? existingProjects.map((p) => `- ${p}`).join('\n')
      : '(none yet)',
  ];

  if (teamContext && teamContext.members.length > 0) {
    parts.push('', 'Team members (for owner assignment):');
    for (const m of teamContext.members) {
      const load = m.openCardCount > 5 ? ' ⚠️ HIGH LOAD' : '';
      parts.push(
        `- ${m.display_name} | ${m.role} | skills: ${m.skills.join(', ')} | open cards: ${m.openCardCount}${load}`,
      );
    }
    parts.push(
      '',
      'Prefer assigning tasks to members whose skills match. If a member has >5 open cards, set confidence=low and needs_clarification=true.',
    );
  }

  parts.push('', 'Meeting notes:', sourceText);
  return parts.join('\n');
}

export async function extractTasksFromNotes(
  opts: ExtractOptions,
): Promise<ExtractionResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(opts) },
      ],
    });
    raw = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    throw new Error(
      `OpenAI API error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenAI returned non-JSON output: ${raw.slice(0, 300)}`,
    );
  }

  const result = ExtractionResponse.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `OpenAI output failed schema validation:\n${result.error.message}\n\nRaw output: ${raw.slice(0, 500)}`,
    );
  }

  return result.data;
}
