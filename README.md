# Shopping Concierge

AI shopping concierge prototype (max ~100 users). See `CLAUDE.md` for
project context, data models, and locked decisions — read it before
making changes, especially if you're using Claude Code (`.claude/agents/`
has the subagent team for this project).

## Getting started

```bash
npm install
npm run dev
```

## Project structure
- `app/` — Next.js routes, pages, API route handlers
- `lib/` — shared logic; `lib/tools/` holds one file per runtime tool
  (matching specs in `docs/tool-specs/`)
- `scripts/` — offline batch scripts (e.g. use-case generation pipeline)
- `db/` — Supabase migrations/schema
- `docs/tool-specs/` — contracts for runtime tools; read before implementing
- `.claude/agents/` — Claude Code subagent team for this project

## Not built yet (by design)
- Ordering/checkout — basket ends in a stubbed CTA, see CLAUDE.md
