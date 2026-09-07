-- 0001_extensions_and_helpers.sql
--
-- Extensions and small shared helpers used by every later migration in this
-- directory. Kept in its own file so it only ever needs to run once, first.

-- pgvector: not populated yet (that's feed-agent's job once the embeddings
-- pipeline exists), but CLAUDE.md calls for the column to exist now so the
-- schema doesn't need a breaking migration later. See 0002_use_cases.sql.
create extension if not exists vector;

-- gen_random_uuid() for uuid primary keys (pgcrypto ships this on Supabase;
-- included here so the migration is self-contained if applied to a bare
-- Postgres instance too, e.g. for local testing).
create extension if not exists pgcrypto;

-- Shared "bump updated_at on any UPDATE" trigger function, reused by every
-- table below that has an updated_at/edited_at column.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- shopping_lists uses "edited_at" (per CLAUDE.md's ShoppingList shape)
-- instead of "updated_at" -- same behavior, separate function so the column
-- name difference doesn't require a parameterized trigger.
create or replace function set_edited_at()
returns trigger
language plpgsql
as $$
begin
  new.edited_at = now();
  return new;
end;
$$;
