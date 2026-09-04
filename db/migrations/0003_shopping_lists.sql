-- 0003_shopping_lists.sql
--
-- Mirrors ShoppingList from CLAUDE.md: { id, user_id, scenario, items[],
-- created_at, edited_at }.
--
-- Design decision -- items as jsonb array vs. a normalized list_items child
-- table: this migration stores `items` as a jsonb array on the row itself,
-- NOT a normalized child table. Reasons:
--   1. ListItem (see use-case.schema.json $defs.list_item) is a small, fixed
--      shape (name/qty/unit/category/owned/source_item_id) with no need to
--      be queried or filtered independently of its parent list -- every read
--      path fetches "the whole list" (GET /api/lists/[id]), and every write
--      path (adjust_scenario, manual edits) replaces/patches items as part
--      of one list-level operation. There's no cross-list query like "find
--      all ListItems named X across every user" that would benefit from a
--      normalized table.
--   2. adjust_scenario's patch semantics (CLAUDE.md locked decision #2) work
--      by finding an item within items[] by source_item_id and rewriting it
--      in place -- an application-level jsonb patch, not a SQL UPDATE ...
--      WHERE list_item_id = .... A child table would require an extra
--      surrogate PK + foreign key per item and N round trips (or a bulk
--      upsert) for what is, in practice, always a single-row read-modify-
--      write from the harness's point of view.
--   3. At ~100 users / prototype scale, the jsonb array's lack of per-item
--      SQL constraints (e.g. can't CHECK qty >= 0 per element) is an
--      acceptable trade for the much simpler read/write path. If the app
--      later needs per-item queries (e.g. "which items across all lists are
--      unresolved"), that's a clean, isolated migration to a child table --
--      nothing about this shape forecloses it.
--
-- `scenario` is stored as jsonb holding { use_case_id, slots } (the Scenario
-- shape from use-case.schema.json), not split into separate columns, for the
-- same reason: it's always read/written as a unit.

create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scenario jsonb not null,
  items jsonb not null default '[]',
  created_at timestamptz not null default now(),
  edited_at timestamptz not null default now()
);

create trigger shopping_lists_set_edited_at
  before update on shopping_lists
  for each row
  execute function set_edited_at();

create index if not exists shopping_lists_user_id_idx on shopping_lists (user_id);

alter table shopping_lists enable row level security;

-- Base table-level privilege (see note in 0002_use_cases.sql on why this is
-- spelled out explicitly rather than relying only on Supabase project
-- defaults). No `anon` grant -- shopping lists are always user-scoped, so
-- unauthenticated clients get no table-level access at all, RLS aside.
grant select, insert, update, delete on shopping_lists to authenticated;

-- Owner: full read/write.
create policy shopping_lists_owner_select
  on shopping_lists
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy shopping_lists_owner_insert
  on shopping_lists
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy shopping_lists_owner_update
  on shopping_lists
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy shopping_lists_owner_delete
  on shopping_lists
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Shared-with access policies (SELECT for any share, UPDATE for 'edit'
-- shares) live in 0004_list_shares.sql instead of here, because they
-- reference the list_shares table, which doesn't exist yet at this point in
-- migration order -- see that file for the "shared-with" policies on this
-- table.
