-- 0005_user_memory.sql
--
-- Mirrors UserMemory (durable) from CLAUDE.md: { user_id, household_size,
-- dietary_prefs[], budget_tier, brand_prefs[] }. One row per user, keyed
-- directly by auth.users.id (no separate surrogate id -- user_id IS the
-- primary key, matching "global to the user" from CLAUDE.md's memory-
-- boundary rule).
--
-- This table only stores the raw durable fields. Enforcing the durable-vs-
-- session boundary (never auto-promoting Scenario-level overrides here) is
-- memory-agent's job on top of this table/the memory_read/memory_write
-- tools -- this migration + the /api/memory routes are raw persistence only.

create table if not exists user_memory (
  user_id uuid primary key references auth.users (id) on delete cascade,
  household_size integer check (household_size is null or household_size > 0),
  dietary_prefs text[] not null default '{}',
  budget_tier text check (budget_tier is null or budget_tier in ('low', 'mid', 'high')),
  brand_prefs text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create trigger user_memory_set_updated_at
  before update on user_memory
  for each row
  execute function set_updated_at();

alter table user_memory enable row level security;

-- Base table-level privilege (see note in 0002_use_cases.sql).
grant select, insert, update, delete on user_memory to authenticated;

-- A user can only read/write their own memory row.
create policy user_memory_owner_select
  on user_memory
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy user_memory_owner_insert
  on user_memory
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy user_memory_owner_update
  on user_memory
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy user_memory_owner_delete
  on user_memory
  for delete
  to authenticated
  using (auth.uid() = user_id);
