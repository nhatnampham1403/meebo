# MeeBo — Phase 6: Telegram-Native Capture (/capture)

> Lets the team paste meeting notes directly into Telegram instead of the web app. Reuses Phase 4/5 button machinery. Companion to BLUEPRINT.md v2.

---

## Goal

A user types `/capture` then pastes (or sends) meeting notes to the bot. The bot extracts tasks with OpenAI (same logic as web), posts the summary + task list with per-task **[✅ Approve] [✏️ Edit] [❌ Skip]** buttons. Approve creates the Trello card; Edit deep-links to the web app; Skip discards.

---

## Settled decisions

| # | Decision | Choice |
|---|----------|--------|
| C1 | Trigger | `/capture` command, then the next message (or same message after the command) is treated as the transcript. |
| C2 | Review | Per-task buttons in Telegram: Approve / Edit / Skip. |
| C3 | Web app | **Kept.** Telegram is primary input; web becomes the editor for the ✏️ Edit path. NOT deleted. |
| C4 | Edit button | Deep-links to the web app for that specific draft (Telegram can't edit structured fields well). |
| C5 | needs_clarification tasks | Visually flagged; their Approve is disabled — must Edit (web) first, same rule as web app. |

---

## Why keep the web app (rationale for C3/C4)

Telegram cannot render an editable form. Editing a task's owner/due/priority in chat would require clunky Q&A or error-prone free-text. So:
- **Telegram** handles the fast 90%: capture + Approve + Skip.
- **Web** handles the precision 10%: editing a task that needs fixing.
- ✏️ Edit deep-links to `web/?key=SECRET&draft=<id>` focused on that draft.

This gives phone-first speed without building a bad editor in Telegram.

---

## Flow

```
User: /capture
Bot:  "📋 Send me the meeting notes (sprint or customer)."
User: <pastes transcript>
Bot:  → calls OpenAI extraction (existing logic) with existing project list + team context
      → inserts drafts to task_drafts (same as web /extract)
      → posts:
          "📝 Summary: <English summary>
           Found N tasks:"
        then per task a compact block:
          "1. <title> [project] · <owner> · <due>   [✅][✏️][❌]"
          (needs_clarification tasks marked ⚠️, Approve disabled)

Tap ✅ Approve → resolveOrCreateList + createCard + assign → edit line to "✅ Created"
Tap ✏️ Edit   → reply with web deep-link for that draft → user edits + approves on web
Tap ❌ Skip    → mark draft rejected → edit line to "❌ Skipped"
```

---

## Architecture note — share the extraction logic

`extractTasksFromNotes()` currently lives in `apps/web/lib/openai.ts`. For the worker to use it, **move it to `packages/shared`** (or duplicate carefully). Cleanest: extract the OpenAI call + prompt into `packages/shared/extraction.ts` so BOTH web and worker import the same function. This keeps one source of truth for the prompt (still English output, per blueprint).

---

## Database

Reuse `task_drafts` exactly as-is. Add one column to track input origin (optional but useful):
```sql
ALTER TABLE task_drafts ADD COLUMN IF NOT EXISTS source_channel text DEFAULT 'web';
-- 'web' | 'telegram'
```
Per-task button state maps to existing `review_status` (pending → approved/rejected). No new table strictly required, though a lightweight `capture_session` table helps group a batch (optional).

---

## Build tickets

### P6.T1 — Share extraction logic
Move `extractTasksFromNotes()` + system prompt into `packages/shared/extraction.ts`. Update web's `/api/extract` to import from shared. Worker will import the same.
*Done when:* both web and worker import one extraction function; web flow still works unchanged.

### P6.T2 — /capture command + state
Add `/capture` to the bot. On `/capture`, set a lightweight "awaiting transcript" state for that chat (in-memory map keyed by chat_id, or a `capture_session` row). The next message from that user is treated as the transcript.
*Done when:* `/capture` then a pasted message routes the text into extraction (logged), not normal chat handling.

### P6.T3 — Extract + post task list with buttons
Worker calls shared extraction (inject existing Trello project names + team context). Insert drafts (`source_channel='telegram'`). Post summary + per-task lines with `[✅][✏️][❌]` inline buttons. Flag `needs_clarification` with ⚠️ and disable their Approve.
*Done when:* pasting a real transcript yields a Telegram message with the summary and one button row per task.

### P6.T4 — Approve / Edit / Skip callbacks
Route `capture:` callbacks in `webhook.ts`:
- `capture:{draft_id}:approve` → resolveOrCreateList + createCard + assign member + DB write-back → edit that line to "✅ Created [link]".
- `capture:{draft_id}:edit` → reply with web deep-link `?key=SECRET&draft={id}`.
- `capture:{draft_id}:skip` → mark rejected → edit line to "❌ Skipped".
Guard against double-tap (reuse check-in pattern). Disable approve for needs_clarification.
*Done when:* Approve creates the right card in the right list; Skip discards; Edit gives a working web link; no double-processing.

### P6.T5 — Web deep-link support
Web app reads `?draft=<id>` and opens focused on that single draft for editing + approval.
*Done when:* tapping ✏️ Edit in Telegram opens the web app on exactly that task, editable, approvable.

### P6.T6 — Messages
Add `formatCaptureSummary`, `formatCaptureTaskLine`, and callback acks to `lib/messages.ts`. Consistent style.
*Done when:* capture messages render cleanly.

---

## Edge cases

| Case | Handling |
|------|----------|
| `/capture` then user sends nothing | Timeout the awaiting state after N minutes |
| Transcript too short / not a meeting | Extraction returns 0 tasks → bot says "No tasks found" |
| Many tasks (8+) | Numbered list; consider pagination or an "Approve all clear ones" shortcut |
| needs_clarification task | ⚠️ marked, Approve disabled, must Edit on web |
| Same draft approved twice | Idempotency on trello_card_id (existing guard) |
| Capture from group vs DM | Decide: allow in DM only, or group too (group = noisy). Recommend DM for capture. |

---

## Recommendation on rollout

Build P6.T1 first (shared extraction) — it's a refactor that unblocks everything and risks nothing. Then T2–T4 are the core. T5 (deep-link) can come last; until it's done, ✏️ Edit can just say "edit on the web app" with the base link.

This is Telegram-primary, web-as-editor — the best of both without building a bad editor in chat.
