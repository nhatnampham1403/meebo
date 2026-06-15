# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                        # install all workspaces from root
npm run dev                        # run web + worker concurrently
npm run dev:web                    # Next.js only (http://localhost:3000)
npm run dev:worker                 # worker only (tsx watch)
npm run build                      # build all workspaces
npm run typecheck                  # tsc --noEmit across all workspaces
npx tsx scripts/seed-members.ts   # one-time: resolve Trello member IDs → team_members table
```

Access the web app with `?key=YOUR_APP_SECRET` on first visit; it sets a cookie and stays unlocked.

## Architecture

Two deployable runtimes sharing one Supabase PostgreSQL database. They never call each other — all shared state goes through Supabase.

- **`apps/web`** — Next.js 15 App Router, deployed to Vercel. Handles the entire UI, all API routes, and every interaction with OpenAI/Claude, Trello, and Supabase.
- **`apps/worker`** — Node.js process, deployed to Railway. Runs cron schedulers and the Telegram bot. **Currently deferred (Phases 3 & 4)** — Telegram account is flagged; build Phases 1 & 2 first.
- **`packages/shared`** — The contract layer. `TaskDraft` Zod schema, `ExtractionResponse`, `supabase-types.ts`, `draftToTrelloCard()`, and `withRetry()` live here exclusively. Never redefine these in `web` or `worker`.

**Boundary rule:** `web` never touches Telegram; `worker` never serves UI. Trello is the execution source of truth — Supabase stores only drafts, config, and logs.

## Key design decisions

| # | Decision |
|---|----------|
| D1 | AI provider is configured via `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` env vars (see `apps/web/lib/claude.ts`). BLUEPRINT.md references OpenAI — the actual scaffold uses Claude. |
| D2 | Trello is read **live** on every operation — no local mirror. |
| D3 | Auth is a hardcoded `APP_SECRET` env var (URL param → cookie gate in `middleware.ts`). No login page until proper auth is added. |
| D4 | **Trello lists = projects**, not status columns. Lists are named after contracts/initiatives (e.g. "MKV x Happyland", "PlaSight"). |
| D5 | New Trello lists are **auto-created silently** when a project doesn't exist — no confirmation gate. Case-insensitive match prevents accidental duplicates. |
| D6 | All AI output is in **English**, even when input notes are Vietnamese. |
| D7 | `/approve` is **idempotent** — the write-back uses `WHERE trello_card_id IS NULL`; zero rows returned means already approved. Double-clicking must never create two cards. |
| D8 | `apps/web/lib/db.ts` uses the **service role key** server-side only. The anon key is reserved for when real auth lands. Never ship the service role key to the browser. |

## Core flow: extract → review → approve

1. `POST /api/extract` receives raw meeting notes + `source_type`.
2. Route fetches existing Trello list names, injects them into the Claude prompt so the AI reuses existing project names.
3. Claude returns `{ summary, tasks[] }` validated against `ExtractionResponse` (Zod). Tasks with `needs_clarification: true` get `review_status = 'needs_clarification'` and are blocked from one-click approval.
4. Drafts are inserted into `task_drafts` table.
5. Manager edits flagged tasks in the UI, then clicks Approve.
6. `POST /api/approve` → `resolveOrCreateList(project)` → `createCard(...)` → idempotent write-back.

## Database tables (all already migrated)

- **`task_drafts`** — central lifecycle table; `review_status` progresses `pending → needs_clarification → approved | rejected`; `trello_card_id` is the idempotency key.
- **`team_members`** — stores `trello_member_id` (24-char hex) resolved from emails/names via the seed script. Member assignment uses this ID.
- **`trello_config`** — key-value store for board/list/label config.
- **`digest_log`** — deduplication log for cron jobs; unique index on `(job_name, reference_id, sent_date)`.
- **`pending_checkins`** / **`member_stats`** — Phase 4 (deferred).

## Implementing tickets

BLUEPRINT.md (`§10`) defines the full build sequence (P1.T1–P2.T6). Implement exactly one ticket at a time. The *Done when* criteria in each ticket are the acceptance test — do not add scope from future tickets.

`packages/shared/schema.ts` must be populated first (P1.T2) before any extraction or DB work can proceed. The exact Zod schemas and `supabase-types.ts` content are specified verbatim in BLUEPRINT.md §5 and §6.
