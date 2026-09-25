-- What ties a candidate to an app when it was found by comparing the stores known to run
-- that app with every other store: which app, in how many of its stores, and how rare the
-- trace is elsewhere.
alter table candidates add column evidence jsonb;

-- How detection fares on the stores known to run each app, and what that says about the
-- app: detection finds it, it leaves no public trace, or there is not enough to tell.
create table app_quality (
  app_id text primary key references apps (id) on delete cascade,
  stores integer not null,
  detected integer not null,
  verdict text not null check (verdict in ('detected', 'no-trace', 'unclear')),
  measured_at timestamptz not null default now()
);

alter table app_quality enable row level security;
