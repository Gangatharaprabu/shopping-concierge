# Shopping Concierge App

## What this is
AI shopping concierge: users describe a need ("hosting a BBQ", "weekend trip"),
get matched to one of 1000+ pre-built use cases, get a personalized shopping
list, can edit the scenario (day/night, headcount, etc.), mark what they
already own, and build a basket. No product catalogue — products are
resolved live via web search. Ordering/checkout is NOT built yet (deferred).

## Canonical data models
(Keep this section in sync with actual schema files in /docs/schemas/ once they exist.)

- **UseCase**: { id, category, tags[], scenario_slots{}, template_list[] }
- **Scenario**: { use_case_id, slots{} } — the patched/adjusted version for one user session
- **ShoppingList**: { id, user_id, scenario, items[], created_at, edited_at }
- **ListItem**: { name, qty, category, owned:boolean }
- **UserMemory (durable)**: { user_id, household_size, dietary_prefs[], budget_tier, brand_prefs[] }
- **Basket**: { id, user_id, items[], status: "draft" } — no order/checkout fields yet

## Locked decisions (do not relitigate without asking)
1. Ordering/checkout is OUT OF SCOPE for this phase. Basket ends in a stubbed
   "Buy"/"Get this" CTA with no real handoff. Do not build payment or
   retailer-checkout integration.
2. Scenario edits PATCH affected slots/items only. Never regenerate a whole
   list from scratch on an edit — this discards user's manual changes.
3. Memory boundary: durable facts (household size, dietary prefs, budget
   tier) go through `memory_write` and are global to the user. Session/event-
   specific context (this event is at night, this event has 20 guests) lives
   on the Scenario/ShoppingList object only and must never be auto-promoted
   to global memory.

## Tool contracts
Full specs for runtime tools (resolve_products, adjust_scenario, etc.) live
in /docs/tool-specs/*.md. Read the relevant spec before implementing or
modifying a tool — don't infer the contract from the tool name.

## Conventions

This is a prototype targeting a maximum of ~100 users. Prefer the simplest
option that works over anything "scalable" — no microservices, no queues,
no k8s. One deployable app, one database.

- **Language/framework**: TypeScript, Next.js (App Router) — frontend and
  backend API routes live in the same app, one codebase, one deploy.
- **Database**: Postgres via Supabase, with the `pgvector` extension for
  use-case/feed embedding search (needed by feed-agent) and any embedding-
  based dedup (needed by usecase-content-agent). Supabase also provides
  auth — don't build custom auth.
- **AI calls**: Anthropic SDK (Claude API) for harness reasoning and list
  generation. Web search for `resolve_products` goes through a search API
  (e.g. Tavily) — this app has no built-in web search tool, unlike Claude
  Code, so this must be called explicitly as an HTTP API.
- **Package manager**: npm.
- **Test runner**: vitest — run with `npm test`.
- **Lint**: `npm run lint` (eslint via `next lint`) — run before
  considering any task done.
- **Folder layout**: single Next.js app at repo root.
  - `/app` — routes, pages, API route handlers
  - `/lib` — shared logic: harness, tools (resolve_products, memory, etc.),
    db client
  - `/lib/tools/` — one file per runtime tool, matching /docs/tool-specs/
  - `/scripts` — offline batch scripts (e.g. use-case generation pipeline)
  - `/db` — Supabase migrations/schema
- **API style**: Next.js route handlers under `/app/api/`, JSON in/out.
- **Deployment**: Vercel (app) + Supabase (db). No Docker needed for this
  phase.
- **Commit style**: conventional commits (`feat:`, `fix:`, `chore:`, etc.).
