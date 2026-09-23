-- Reading the knowledge means three queries over a couple of thousand rows, which is slow
-- from a serverless function in another region. The sync job assembles it once and stores
-- the result, so a scan reads a single row.
create table knowledge_snapshots (
  version text primary key,
  document jsonb not null,
  built_at timestamptz not null default now()
);

create index knowledge_snapshots_recent on knowledge_snapshots (built_at desc);

alter table knowledge_snapshots enable row level security;
