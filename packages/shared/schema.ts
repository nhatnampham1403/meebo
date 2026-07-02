import { z } from 'zod';

export const SourceType = z.enum(['sprint_meeting', 'customer_meeting']);
export const Priority   = z.enum(['low', 'medium', 'high']);
export const Confidence = z.enum(['high', 'medium', 'low']);

export const TaskDraftSchema = z.object({
  extracted_title:      z.string().min(1),
  project:              z.string().nullable().catch(null),
  owners:               z.array(z.string()).catch([]),
  owner:                z.string().nullable().catch(null),
  due_date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  priority:             Priority.catch('medium'),
  source_type:          SourceType,
  external_party:       z.string().nullable().catch(null),
  context:              z.string().catch(''),
  definition_of_done:   z.string().catch(''),
  suggested_list:       z.string().nullable().catch(null),
  checklist:            z.array(z.string()).nullable().catch(null),
  decision_needed:      z.boolean().catch(false),
  confidence:           Confidence.catch('medium'),
  needs_clarification:  z.boolean().catch(false),
  original_source_text: z.string().catch(''),
}).transform((task) => {
  // Backward compat: keep single `owner` in sync with the `owners` array.
  // If the model returned only `owner`, seed `owners` from it. Otherwise
  // set `owner` to owners[0] (or null when empty).
  const owners =
    task.owners.length > 0
      ? task.owners
      : task.owner
        ? [task.owner]
        : [];
  return { ...task, owners, owner: owners[0] ?? null };
});

export type TaskDraft = z.infer<typeof TaskDraftSchema>;

export const ExtractionResponse = z.object({
  summary: z.string(),
  tasks:   z.array(TaskDraftSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResponse>;
