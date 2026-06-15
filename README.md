# MeeBo — AI-Assisted Trello Task Capture & Hygiene Automation

See [BLUEPRINT.md](./BLUEPRINT.md) for architecture, schemas, and build sequence.

## Workspaces

| Package | Path | Runtime |
|---------|------|---------|
| `web` | `apps/web` | Next.js on Vercel |
| `worker` | `apps/worker` | Node on Railway (deferred) |
| `shared` | `packages/shared` | Shared types and contracts |

## Setup

```bash
cp .env.example .env
# Fill in real values (see BLUEPRINT.md §12)
npm install
```

## Development

```bash
npm run dev          # Next.js dev server (apps/web)
npm run typecheck    # tsc --noEmit for web + shared
```
