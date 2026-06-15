# Build Brief — AI-Assisted Trello Task Capture

## 1. Purpose

The team already uses Trello/Jira-style boards to track work, but many tasks still originate outside the board: team discussions, vendor/customer messages, boss instructions, meeting notes, Zalo/WhatsApp/WeChat threads, and informal follow-ups.

The goal is to build a lightweight assistant that helps convert those discussions into clean Trello-ready task drafts.

This should support the existing board workflow. It should not become a separate project-management system.

## 2. Operating principle

Trello stays the source of truth for task execution.

The assistant acts as a capture and cleanup layer:

**Raw discussion → AI extracts candidate tasks → human reviews → approved card is created in Trello → Telegram sends reminders/digest**

V1 should keep a human approval step before any Trello card is created. This prevents noisy, vague, or politically sensitive cards from entering the board.

## 3. Actual team workflow to support

Tasks usually come from several channels:

| Source | Typical Content | Capture Need |
|---|---|---|
| Team discussions | Internal coordination, project updates, blockers, assignments | Extract tasks, owners, due dates, blockers |
| Vendor/customer discussions | Promised documents, unanswered questions, meeting follow-ups, technical clarifications | Create follow-up cards with external party and deadline |
| Boss discussions | New instructions, urgency changes, priority shifts, review requests | Separate real tasks from comments, concerns, and ideas |
| Zalo / WhatsApp / WeChat | Fast informal messages, screenshots, reminders, vendor replies | Convert messy context into structured task drafts |
| Email threads | Vendor confirmations, document requests, commercial/legal/import steps | Preserve source context and create follow-up cards |
| Meeting notes | Decisions, action items, open questions, dependencies | Generate clean post-meeting task list |
| Installation/testing work | Equipment checks, setup steps, missing parts, test results | Create checklists and issue cards |

The assistant should help reduce manual task entry and prevent follow-up loss.

## 4. Trello model to understand first

Before building, research Trello’s basic object model:

| Trello Object | Meaning in Our Workflow |
|---|---|
| Board | Project or team workspace |
| List | Workflow stage: Backlog, To Do, Doing, Waiting, Done, etc. |
| Card | Main task |
| Description | Context, source text, definition of done |
| Checklist | Subtasks or step-by-step execution |
| Member | Owner / responsible person |
| Label | Project, priority, risk, external/internal, etc. |
| Due date | Commitment or review deadline |
| Comment | Follow-up history and updates |
| Attachment | Screenshot, email export, document, link |
| Custom field | Useful if available: source, external party, confidence, decision needed |

Trello supports cards, descriptions, checklists, due dates, labels, comments, attachments, and mobile/email capture flows. Atlassian also documents email-to-card creation through board or Inbox email addresses, and Trello supports automation/integrations through its platform. :contentReference[oaicite:0]{index=0}

## 5. Research tasks

### A. Trello usage research

Research:

• How Trello boards, lists, cards, labels, checklists, members, due dates, and comments work  
• How email-to-card works  
• How Trello automation works  
• How Trello API authentication works  
• How to create cards through Trello API  
• How to add labels, members, descriptions, due dates, and checklists through API  
• Whether attachments or source links can be added through API  
• Whether we can safely test on a dummy board first  

Where to look:

• Atlassian Trello support docs  
• Atlassian Developer / Trello REST API docs  
• Trello automation docs  
• Trello community examples  
• GitHub examples using Trello API  
• Official API reference before using third-party snippets  

### B. Team workflow research

Interview or observe the team workflow:

• How tasks currently enter Trello  
• Which tasks are often forgotten  
• Which discussions create the most manual follow-up  
• Which projects are most painful to track  
• What information must be included for a task to be actionable  
• What kinds of cards should not be created automatically  
• Who needs to approve task creation  

### C. AI task extraction research

Research how AI can convert text into structured action items:

• Meeting notes → action items  
• Vendor message → follow-up task  
• Boss instruction → task / decision / context separation  
• Long discussion → tasks, blockers, owners, due dates  
• Screenshot text → task draft, if text can be copied or transcribed  
• Ambiguous instruction → mark as “needs clarification” instead of guessing  

## 6. Technical blueprint

### V1 — Manual input + task draft table

Build a simple interface where the user can paste raw text.

Input examples:

• Meeting notes  
• Vendor message  
• Customer discussion  
• Boss instruction  
• Copied Zalo/WhatsApp/WeChat text  
• Email excerpt  

Output:

A review table of candidate tasks.

Each candidate task should include:

| Field | Meaning |
|---|---|
| Task title | Clear verb + object |
| Project | Which project this belongs to |
| Owner | Responsible person, if known |
| Due date | Extracted or suggested |
| Priority | Low / medium / high |
| Source type | Meeting, vendor, customer, boss, internal, email, chat |
| External party | Vendor/customer/person involved |
| Context | Short explanation |
| Definition of done | What completion means |
| Suggested Trello list | Backlog, To Do, Waiting, etc. |
| Checklist | Subtasks if available |
| Decision needed | Yes/no and who decides |
| Confidence | High / medium / low |
| Original source text | Preserved for traceability |

No card is created in V1 without review.

### V2 — Approved Trello card creation

After a human approves selected task drafts, create Trello cards automatically.

Card creation should map fields clearly:

| Extracted Field | Trello Destination |
|---|---|
| Task title | Card title |
| Context + source + definition of done | Card description |
| Owner | Member |
| Due date | Due date |
| Project / priority / source type | Labels |
| Subtasks | Checklist |
| Original source | Description or attachment/link |
| Confidence | Description or custom field |
| Decision needed | Label or description section |

### V3 — Telegram digest

Add a Telegram bot to send task reminders and summaries.

Telegram should be used for:

• Daily morning digest  
• Overdue tasks  
• Tasks due today  
• Tasks due in 48 hours  
• Waiting-on-vendor items  
• Blocked tasks  
• Items requiring boss / management decision  
• Weekly summary of new tasks and unresolved follow-ups  

Telegram should not replace Trello. It should make Trello harder to ignore.

### V4 — Optional AI summary layer

Once V1–V3 are stable, add AI summaries:

• “What changed since yesterday?”  
• “Which tasks are blocked?”  
• “Which vendor follow-ups are stale?”  
• “Which items need management decision?”  
• “Which projects have the highest execution risk this week?”  

## 7. Suggested stack

Use a simple stack first.

| Layer | Suggested Tool | Purpose |
|---|---|---|
| Frontend | Simple web app / React / Next.js | Paste input, review task drafts, approve cards |
| Backend | Node.js / Python / serverless function | Process input, call AI, call Trello API |
| Database | Supabase | Store extracted drafts, review status, logs, source text |
| AI coding assistant | Claude Code | Build integration, inspect API docs, generate/refactor code, write tests |
| AI model | OpenAI / Claude API depending access | Extract structured task candidates |
| Task board | Trello | Execution source of truth |
| Notification | Telegram Bot API | Daily digest and reminders |
| Deployment | Local first, then lightweight cloud if needed | Keep test cycle fast |

## 8. How to use Claude Code

Claude Code should be used for implementation work, not vague research.

Good Claude Code tasks:

• Read Trello API docs and propose API wrapper functions  
• Create a minimal project structure  
• Build a Trello client module  
• Build a Supabase schema and migration draft  
• Create task extraction JSON schema  
• Build the review table UI  
• Write function to create Trello cards from approved drafts  
• Add tests with sample meeting notes  
• Add error handling for missing owner, due date, board/list ID, or API failure  
• Refactor messy code after prototype works  
• Generate README and setup instructions  

Do not use Claude Code to make strategic decisions about workflow. Use it to build, test, document, and refactor.

## 9. Trello API research checklist

Find and document:

• How to generate Trello API key/token  
• How authentication works  
• How to get board ID  
• How to get list IDs  
• How to create a card  
• How to update card description  
• How to add members  
• How to add labels  
• How to set due date  
• How to create checklist and checklist items  
• How to add comments  
• How rate limits work  
• How to handle errors  
• How to use a dummy board for testing  

Deliverable: one short technical note with links to official docs and a few tested API calls.

## 10. Data model draft

Suggested Supabase tables:

### `task_drafts`

| Field | Type | Note |
|---|---|---|
| id | uuid | Primary key |
| source_text | text | Raw pasted input |
| source_type | text | meeting / vendor / customer / boss / chat / email |
| extracted_title | text | Proposed card title |
| project | text | Project name |
| owner | text | Suggested owner |
| due_date | date | Nullable |
| priority | text | low / medium / high |
| external_party | text | Vendor/customer/contact |
| context | text | Short context |
| definition_of_done | text | Completion condition |
| checklist | jsonb | Subtasks |
| decision_needed | boolean | True/false |
| confidence | text | low / medium / high |
| suggested_list | text | Trello list |
| review_status | text | pending / approved / rejected / needs clarification |
| trello_card_id | text | Filled after card creation |
| created_at | timestamp | Auto |
| reviewed_at | timestamp | Nullable |

### `trello_config`

| Field | Type | Note |
|---|---|---|
| board_id | text | Trello board |
| list_id | text | Target list |
| label_map | jsonb | Project/priority/source labels |
| member_map | jsonb | Team member to Trello member ID |

### `digest_log`

| Field | Type | Note |
|---|---|---|
| id | uuid | Primary key |
| digest_date | date | Digest date |
| digest_text | text | Telegram message |
| sent_status | text | sent / failed |
| created_at | timestamp | Auto |

## 11. Human review rules

The assistant should mark items as “needs clarification” when:

• Owner is unclear  
• Due date is unclear  
• Instruction sounds like an idea rather than a task  
• The task involves strategic partner sensitivity  
• The task mentions pricing, contracts, legal, finance, or external commitment  
• The task may require boss approval  
• The source text is ambiguous  

For sensitive items, the tool should draft the card but avoid auto-posting until reviewed.

## 12. Card format standard

Use this Trello card structure:

```md
## Context
[Short background]

## Source
[Meeting / vendor / customer / boss / chat / email]

## Original Instruction
[Preserved source text or summary]

## Definition of Done
[What must be true for this card to be complete]

## Dependencies
[People, vendor, document, decision, equipment]

## Decision Needed
[Yes/no — who decides]

## Strategic Sensitivity
[None / partner-sensitive / pricing-sensitive / customer-sensitive / internal-only]

## Confidence
[High / medium / low]