# /db/seed -- seed data destined for the database

This is where offline-generated seed data that will eventually be loaded
into Postgres/Supabase lives, per `CLAUDE.md`'s folder layout (`/db` --
"Supabase migrations/schema"). `CLAUDE.md` didn't specify an exact path for
UseCase seed content, so this is `usecase-content-agent`'s choice, documented
here for whoever (`backend-agent`) builds the loader later.

## Layout

```
db/seed/
  README.md          <- this file
  usecases/
    <use-case-id>.json   <- one file per UseCase, filename == UseCase.id + ".json"
```

- **One JSON file per `UseCase`**, not one big array file. This keeps
  `git diff`s to a single-record scope when one use case is edited, makes
  merge conflicts between parallel batches trivial to resolve (different
  files), and lets `validate-all.ts` / `dedup-check.ts` / a future DB loader
  all just glob `*.json` in the directory without needing an index file to
  stay in sync.
- **Filename is always `<id>.json`**, matching the record's own `id` field
  exactly (enforced by a test in
  `scripts/usecase-pipeline/__tests__/seed-data.test.ts`). This is what
  makes "does this use case already exist" a filesystem check
  (`fs.existsSync`) rather than needing to parse every file first.
- Every file here is a plain JSON object matching
  `/docs/schemas/use-case.schema.json` exactly -- no wrapper, no extra
  metadata fields. Provenance/generation metadata (which batch, which model,
  hand-authored vs LLM-generated) lives separately in
  `scripts/usecase-pipeline/state/generation-state.json`, keyed by
  subcategory + batch, not inline in the UseCase records themselves (the
  schema's `additionalProperties: false` wouldn't allow it anyway).

## How this gets produced

See `scripts/usecase-pipeline/README.md` for the full pipeline. Short
version: `scripts/usecase-pipeline/generate-batch.ts` (LLM-backed, resumable,
requires `ANTHROPIC_API_KEY`) or, for this first batch,
`scripts/usecase-pipeline/author-initial-batch.ts` (hand-authored) both write
here, and only after every record passes
`scripts/usecase-pipeline/lib/schema-validate.ts` (schema + lint) and the
interim dedup check in `scripts/usecase-pipeline/lib/dedup.ts`.

## For backend-agent, building the DB loader later

- Read every `*.json` in `usecases/`, `JSON.parse`, and each one is already a
  schema-valid `UseCase` ready to insert as-is (run
  `npm run usecase:validate` first if you want a final sanity check before a
  bulk load).
- `UseCase.id` is the natural primary key / stable slug -- safe to use
  directly as the DB row's `id` / `slug` column.
- Embedding generation for `pgvector`-based similarity search (needed by
  `feed-agent`, and to eventually replace the interim lexical dedup heuristic
  in `scripts/usecase-pipeline/lib/dedup.ts`) is **not done here** -- these
  files have no embedding vectors attached. That's backend-agent/feed-agent's
  job once the embeddings pipeline exists.

## Current status

49 hand-authored `UseCase` records across 22 of the 52 subcategories (all 4
top-level categories represented). This is the pipeline's first batch, not
the full 1000+ -- see `scripts/usecase-pipeline/state/generation-state.json`
for exact per-subcategory progress against the 20-per-subcategory target in
`scripts/usecase-pipeline/batch-plan.json`.
