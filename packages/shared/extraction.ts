import OpenAI from 'openai';
import { z } from 'zod';
import { ExtractionResponse, SourceType } from './schema';
import type { ExtractionResult } from './schema';

const SYSTEM_PROMPT = `You are MeeBo, a task-extraction assistant for a sports-tech team that manages
projects and third-party contracts on a Trello board.

ALWAYS respond in ENGLISH, even if the meeting notes are in another language
(e.g. Vietnamese). Translate as needed.

You will be given:
1. Meeting notes (sprint or customer meeting).
2. A list of EXISTING project names already on the Trello board.
3. (Optional) Current team members with their skills and workload.

Return ONLY a valid JSON object with this exact shape — no prose, no markdown:
{
  "summary": "<3-5 sentence English summary of the meeting>",
  "tasks": [ { ...TaskDraft fields... } ]
}

PROJECT DETECTION (critical):
- Each task belongs to a PROJECT (a third-party contract or initiative,
  e.g. "MKV x Happyland", "PlaSight", "Peekaboo").
- Set "project" to the project the task belongs to.
- If the project matches one of the EXISTING project names provided (even with
  minor spelling differences), use the EXISTING name exactly as given.
- If it is genuinely a new project, use a clean new name.
- "suggested_list" must equal "project".

TASK FIELDS:
- extracted_title: concise English action title
- owner: person responsible if named, else null
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
- owner not mentioned or ambiguous
- no due date can be inferred
- involves pricing, contracts, legal, or sensitive financial data
- requires boss/management approval before proceeding
- it is an idea or discussion point, not an actionable task

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
