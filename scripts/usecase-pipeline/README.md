# usecase-pipeline

Offline batch pipeline for generating the 1000+ `UseCase` seed records
described in `CLAUDE.md`. This directory is the whole pipeline: generation,
validation, and interim dedup. Output (the actual seed data) lives in
`/db/seed/usecases/` -- see `/db/seed/README.md`.

## Why this exists (and why it's resumable, not one giant script)

Per this project's own operating rule: **never generate all 1000+ use cases
in a single interactive/one-shot run.** This pipeline is built to be killed,
resumed, and re-run incrementally, batch by batch, subcategory by
subcategory, with every batch validated and logged before it's ever
committed.

## Files

- `lib/types.ts` -- TypeScript mirror of `/docs/schemas/use-case.schema.json`
  (hand-kept in sync; the JSON Schema remains the actual source of truth).
- `lib/schema-validate.ts` -- the real validator. Wraps `ajv` (draft 2020-12)
  against `/docs/schemas/use-case.schema.json` (which itself `$ref`s
  `/docs/schemas/category-taxonomy.json`), plus semantic lint rules the JSON
  Schema can't express (see file header for the full list: presence/scaling
  rule slot_ids must be declared in `depends_on_slots`, slot defaults must be
  valid for their own type, category must namespace-prefix subcategory,
  `item_id` must be unique per use case, `depends_on_slots` must reference a
  declared `scenario_slots` key).
- `lib/dedup.ts` -- interim, lexical (title-token Jaccard) near-duplicate
  check. **This is a documented placeholder for real pgvector/embedding
  dedup** -- see the file header for why and what replaces it later.
- `lib/state.ts` -- resumable state file read/write (see below).
- `lib/logger.ts` -- stdout + append-to-file logging, used by every CLI.
- `batch-plan.json` -- target count per subcategory (currently 20 x 52
  subcategories = 1040, matching CLAUDE.md's "1000+"). Edit this file to
  change targets; it's read fresh on every run.
- `generate-batch.ts` -- the real, LLM-backed, resumable generator CLI (see
  "Resuming with a real API key" below).
- `author-initial-batch.ts` -- the one-off script that produced this
  pipeline's *first* batch by hand (no `ANTHROPIC_API_KEY` was available in
  the environment this was built in). Kept in the repo as a record of how
  batch 1 was produced; not meant to be re-run (it will just re-validate and
  re-write the same 49 records it already wrote). Its `main()` runs the
  exact same validate -> dedup -> write -> record-state sequence as
  `generate-batch.ts`, just with a hardcoded list of records instead of an
  API call.
- `validate-all.ts` -- standalone CLI: validates every file in
  `/db/seed/usecases` (or `--dir <path>`) against schema + lint. Exit code
  non-zero on any failure. Wired into `npm run usecase:validate`.
- `dedup-check.ts` -- standalone CLI: runs the interim dedup heuristic across
  `/db/seed/usecases` (or `--dir <path>`), reports flagged pairs. Wired into
  `npm run usecase:dedup`. Add `--strict` to exit non-zero when pairs are
  flagged (off by default -- this is a "review", not a hard gate, until the
  heuristic is trusted more).
- `state/generation-state.json` -- resumable progress, committed to the repo
  (see below).
- `logs/pipeline.log` -- append-only log of every batch run by any of the
  CLIs above (gitignored — regenerable, not meant to be reviewed via git
  history).

## Running it

```bash
npm run usecase:validate          # validate everything in db/seed/usecases
npm run usecase:dedup             # check for near-duplicate titles
npm run usecase:dedup -- --strict # same, but exit non-zero if anything is flagged

# requires a real key -- see below
ANTHROPIC_API_KEY=sk-... npm run usecase:generate -- --subcategory events.wedding_related --batch-size 8
```

## Resuming generation with a real `ANTHROPIC_API_KEY`

1. Set `ANTHROPIC_API_KEY` in your environment. `generate-batch.ts` fails
   fast with a clear error if it's unset -- it will never silently no-op.
2. Run `npm run usecase:generate` (with no `--subcategory`) to work through
   every subcategory in `batch-plan.json` that's still below its target, in
   the order they appear in the taxonomy. Pass `--subcategory <id>` to work
   on just one, `--batch-size N` to change how many records are requested
   per model call (default 8), and `--max-batches N` to cap how many batches
   a single invocation processes (useful for chunking a long run across CI
   jobs or terminal sessions).
3. On startup the script reconciles `state/generation-state.json` against
   what's actually sitting in `/db/seed/usecases` (so state can never drift
   from reality even if a file was hand-edited or deleted), then only asks
   the model for `target - already_generated` records per subcategory, in
   batches of `--batch-size`.
4. Every batch is validated and dedup-checked *before* anything is written.
   Invalid records are rejected and logged (never silently dropped);
   dedup-flagged records are also excluded from the write and logged for a
   human to review (this script does not auto-resolve dedup flags the way
   `author-initial-batch.ts` did for its one reviewed pair -- add a reviewer
   step here before merging if that's needed for automated runs later).
5. State is saved after **every batch**, not just at the end. If the process
   crashes, gets rate-limited, or is killed, just re-run the exact same
   command -- it resumes from where `state/generation-state.json` says it
   left off, and will not regenerate or duplicate already-written records
   (existing titles in that subcategory are included in the prompt so the
   model doesn't repeat itself either).
6. Check `scripts/usecase-pipeline/logs/pipeline.log` for a full audit trail
   of every batch (counts generated/valid/invalid/dedup-flagged/written).

## What's still a placeholder (see also `/db/seed/README.md`)

- **Dedup is lexical, not embedding-based.** `lib/dedup.ts` has a full
  explanation and an explicit TODO. Once `pgvector` + an embeddings pipeline
  exist (backend-agent/feed-agent, later phase), replace `findNearDuplicates`
  with a real cosine-similarity query and delete this heuristic.
- **`batch-plan.json`'s 20-per-subcategory target is a starting guess**, not
  a hard requirement from any spec -- adjust freely; some subcategories will
  reasonably want more or fewer than others.
