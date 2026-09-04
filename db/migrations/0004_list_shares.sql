-- 0004_list_shares.sql
--
-- Sharing model for ShoppingList (CLAUDE.md's canonical models don't define
-- this yet -- added here + documented as a new bullet in CLAUDE.md's
-- "Canonical data models" section in this same change, per this task's
-- instructions).
--
-- Design: a simple join table, list_id -> shared_with_user_id, with a
-- 'view' | 'edit' permission. Kept intentionally minimal for ~100-user
-- scale:
--   - Direct user-to-user sharing only (share with another registered
--     Supabase Auth user), not a public/anonymous share-link/token scheme.
--     A token-based "anyone with the link" share would need its own
--     unauthenticated read path and token-rotation/revocation story: real
--     complexity this prototype doesn't need yet. If that's wanted later,
--     it's an additive migration (e.g. a nullable `token` column + relaxing
--     shared_with_user_id to nullable), not a breaking change to this shape.
--   - Two permission levels only (view/edit) -- matches the two things a
--     sharee actually does in this app (look at a list, or help edit it).
--     No per-item permissions.
--   - One row per (list, sharee) pair; sharing again with the same user just
--     updates the permission (upsert), it doesn't create a duplicate share.

create table if not exists list_shares (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists (id) on delete cascade,
  shared_with_user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null default 'view'
    check (permission in ('view', 'edit')),
  created_at timestamptz not null default now(),

  constraint list_shares_unique_list_sharee unique (list_id, shared_with_user_id)
);

create index if not exists list_shares_list_id_idx on list_shares (list_id);
create index if not exists list_shares_shared_with_user_id_idx on list_shares (shared_with_user_id);

alter table list_shares enable row level security;

-- Base table-level privilege (see note in 0002_use_cases.sql).
grant select, insert, update, delete on list_shares to authenticated;

-- shopping_lists' RLS policies need to check list_shares, and list_shares'
-- RLS policies need to check shopping_lists.user_id -- a genuine mutual
-- dependency between the two tables' policies. Querying each table directly
-- from within the other's USING/WITH CHECK clause causes Postgres to raise
-- "infinite recursion detected in policy" (each table's policy evaluation
-- re-triggers RLS evaluation on the other table, which re-triggers the
-- first, ad infinitum) -- confirmed by hitting this exact error while
-- verifying this migration against a local Postgres (see this task's
-- summary).
--
-- Standard fix (same one Supabase's own RLS docs recommend for this
-- pattern): wrap each cross-table lookup in a SECURITY DEFINER function.
-- A SECURITY DEFINER function runs its body as its *owner* (here, whichever
-- role applies this migration, e.g. `postgres`), and Postgres table owners
-- bypass RLS on their own tables by default (unless FORCE ROW LEVEL
-- SECURITY is set, which we don't). So the query inside the function
-- doesn't re-trigger RLS/policy evaluation at all, which breaks the cycle.
-- `search_path` is pinned and EXECUTE is restricted to `authenticated` as
-- standard hardening for SECURITY DEFINER functions.

create or replace function list_owner_id(target_list_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from shopping_lists where id = target_list_id;
$$;

revoke all on function list_owner_id(uuid) from public;
grant execute on function list_owner_id(uuid) to authenticated;

create or replace function list_share_permission(target_list_id uuid, target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select permission from list_shares
  where list_id = target_list_id and shared_with_user_id = target_user_id;
$$;

revoke all on function list_share_permission(uuid, uuid) from public;
grant execute on function list_share_permission(uuid, uuid) to authenticated;

-- The list owner can see every share on their own lists.
create policy list_shares_owner_select
  on list_shares
  for select
  to authenticated
  using (list_owner_id(list_id) = auth.uid());

-- A sharee can see the share row(s) that name them (so they know what's
-- been shared with them and at what permission). No cross-table lookup
-- needed here -- shared_with_user_id lives directly on this row.
create policy list_shares_sharee_select
  on list_shares
  for select
  to authenticated
  using (shared_with_user_id = auth.uid());

-- Only the list owner can create a share on their own list.
create policy list_shares_owner_insert
  on list_shares
  for insert
  to authenticated
  with check (list_owner_id(list_id) = auth.uid());

-- Only the list owner can change a share's permission level.
create policy list_shares_owner_update
  on list_shares
  for update
  to authenticated
  using (list_owner_id(list_id) = auth.uid())
  with check (list_owner_id(list_id) = auth.uid());

-- The list owner can revoke any share on their list; a sharee can also
-- remove themselves (leave a shared list) without needing the owner to do
-- it for them.
create policy list_shares_owner_delete
  on list_shares
  for delete
  to authenticated
  using (list_owner_id(list_id) = auth.uid());

create policy list_shares_sharee_delete
  on list_shares
  for delete
  to authenticated
  using (shared_with_user_id = auth.uid());

-- Now that list_shares (and the helper functions above) exist, add the
-- "shared-with" access policies on shopping_lists that
-- 0003_shopping_lists.sql deferred to here. A sharee can always SELECT a
-- list shared with them; they can UPDATE it only if their share's
-- permission is 'edit'. Sharees never INSERT or DELETE the list itself --
-- only the owner can create/remove the list row (see the owner policies in
-- 0003_shopping_lists.sql). Both use list_share_permission() rather than
-- querying list_shares directly, for the same recursion-avoidance reason
-- explained above.
create policy shopping_lists_shared_select
  on shopping_lists
  for select
  to authenticated
  using (list_share_permission(id, auth.uid()) is not null);

create policy shopping_lists_shared_update
  on shopping_lists
  for update
  to authenticated
  using (list_share_permission(id, auth.uid()) = 'edit')
  with check (list_share_permission(id, auth.uid()) = 'edit');
