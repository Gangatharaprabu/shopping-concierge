-- 0006_baskets.sql
--
-- Mirrors Basket from CLAUDE.md: { id, user_id, items[], status: "draft" }
-- -- no order/checkout fields. Per CLAUDE.md's locked decision #1
-- (ordering/checkout out of scope for this phase), `status` is constrained
-- to 'draft' only for now; it's a text column (not left off entirely) so a
-- later phase can widen the CHECK to add real statuses without an
-- add-column migration, but no payment/order columns are added even as
-- nullable placeholders, per that same locked decision.
--
-- `items` is jsonb for the same reasons as shopping_lists.items (see
-- 0003_shopping_lists.sql) -- always read/written as a whole basket, no
-- cross-basket per-item queries needed at this scale. commerce-agent's
-- later inventory-subtraction logic operates on this jsonb array in
-- application code, not via per-row SQL constraints.

create table if not exists baskets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  items jsonb not null default '[]',
  status text not null default 'draft'
    check (status = 'draft'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger baskets_set_updated_at
  before update on baskets
  for each row
  execute function set_updated_at();

create index if not exists baskets_user_id_idx on baskets (user_id);

alter table baskets enable row level security;

-- Base table-level privilege (see note in 0002_use_cases.sql).
grant select, insert, update, delete on baskets to authenticated;

-- Owner-only CRUD. No sharing story for baskets -- sharing (list_shares) is
-- scoped to shopping_lists only, per the "sharing" feature as described
-- (shared shopping lists), not shared baskets.
create policy baskets_owner_select
  on baskets
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy baskets_owner_insert
  on baskets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy baskets_owner_update
  on baskets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy baskets_owner_delete
  on baskets
  for delete
  to authenticated
  using (auth.uid() = user_id);
