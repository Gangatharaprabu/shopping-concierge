-- 0002_use_cases.sql
--
-- Mirrors UseCase from /docs/schemas/use-case.schema.json (source of truth
-- for the exact shape) / CLAUDE.md's canonical data models. Shared taxonomy
-- content, not per-user data, so RLS allows public read and no public
-- write path (writes go through the service-role key only -- see the seed
-- loader at /scripts/load-seed-usecases.ts).

create table if not exists use_cases (
  id text primary key
    check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null,
  description text,
  category text not null
    check (category in ('events', 'travel', 'home', 'seasonal')),
  subcategory text not null
    -- Namespaced as "<category>.<subcategory>" per category-taxonomy.json
    -- (52 total ids). Full enum of subcategory ids intentionally NOT
    -- duplicated here (they'd drift out of sync with the JSON taxonomy,
    -- which stays the single source of truth per docs/schemas/README.md);
    -- this check only enforces the namespacing convention + that the
    -- subcategory is prefixed by this row's own category.
    check (subcategory ~ '^[a-z]+\.[a-z0-9_]+$'),
  tags text[] not null default '{}',
  -- scenario_slots: map of slot_id -> slot_definition (see use-case.schema.json
  -- $defs.scenario_slots). template_list: array of template_list_item.
  -- Both stored as jsonb rather than normalized -- they're always read/
  -- written as a whole per use case (never queried by sub-field from SQL;
  -- any such lookups happen in application code after fetching the row),
  -- and normalizing would add join complexity with no query benefit at
  -- this scale.
  scenario_slots jsonb not null,
  template_list jsonb not null,
  -- Populated later by feed-agent's embeddings pipeline; nullable until then.
  -- Dimension matches OpenAI text-embedding-3-small / similar 1536-dim models;
  -- adjust here if feed-agent picks a different embedding model later.
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint use_cases_subcategory_matches_category
    check (subcategory like (category || '.%'))
);

create trigger use_cases_set_updated_at
  before update on use_cases
  for each row
  execute function set_updated_at();

-- category is the most common filter (GET /api/usecases?category=...).
create index if not exists use_cases_category_idx on use_cases (category);
create index if not exists use_cases_subcategory_idx on use_cases (subcategory);
-- tags queried with the array-overlap operator (&&) for future feed-agent use.
create index if not exists use_cases_tags_idx on use_cases using gin (tags);

alter table use_cases enable row level security;

-- Base table-level privilege, on top of which RLS further restricts: a
-- brand-new Supabase project already grants this by default via
-- `alter default privileges` for the public schema, but it's spelled out
-- explicitly here too so this migration is correct and self-contained even
-- against a bare/self-hosted Postgres that doesn't have Supabase's project-
-- level defaults pre-configured (e.g. the local Postgres this was verified
-- against -- see this task's summary).
grant select on use_cases to anon, authenticated;

-- Public read: this is shared taxonomy content, not per-user data. Anyone
-- (including unauthenticated/anon-key clients) can read it.
create policy use_cases_public_read
  on use_cases
  for select
  to anon, authenticated
  using (true);

-- No insert/update/delete grant or policy for anon/authenticated: this
-- table is only ever written by the seed loader / future content pipeline
-- using the service-role key, which bypasses RLS (and already has full
-- table privileges by default on a real Supabase project) entirely.
-- Regular users never write to use_cases directly.
