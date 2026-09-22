-- Apps, and the fingerprints that point at them, are the knowledge the detector runs on.
-- Everything else here records what scanning sees, so the knowledge can grow from it.

create table apps (
  id text primary key,
  name text not null,
  name_en text,
  company text,
  categories text[] not null default '{}',
  -- An app removed from the marketplace often keeps running in stores, so it is kept and
  -- marked rather than deleted. `unidentified` is a vendor we can detect but cannot name.
  status text not null default 'listed' check (status in ('listed', 'delisted', 'unidentified')),
  is_default boolean not null default false,
  installs integer,
  developer_domains text[] not null default '{}',
  details_fetched_at timestamptz,
  last_seen_in_catalog_at timestamptz,
  missing_from_catalog_runs integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fingerprints (
  id text primary key,
  kind text not null,
  pattern text not null,
  strength text not null check (strength in ('decisive', 'strong', 'medium')),
  source text not null check (source in ('auto', 'mined', 'manual')),
  status text not null default 'active' check (status in ('active', 'candidate', 'disabled')),
  -- A fingerprint names one app, or a company when a shared domain cannot tell its apps apart.
  app_id text references apps (id) on delete cascade,
  company text,
  company_app_ids text[] not null default '{}',
  min_product_share real,
  match_count bigint not null default 0,
  last_matched_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fingerprint_names_a_target check ((app_id is not null) <> (company is not null))
);

create index fingerprints_lookup on fingerprints (kind, pattern) where status = 'active';
create index fingerprints_app on fingerprints (app_id);

create table noise_rules (
  kind text not null,
  pattern text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (kind, pattern)
);

create table scans (
  id bigserial primary key,
  store_host text not null,
  store_id bigint,
  status text not null,
  report jsonb not null,
  engine_version text not null,
  knowledge_version text not null,
  duration_ms integer not null,
  scanned_at timestamptz not null default now()
);

create index scans_by_store on scans (store_host, scanned_at desc);

-- Signals a scan could not explain. Clustering these across stores is what turns an
-- unknown trace into a fingerprint.
create table observations (
  signal_kind text not null,
  signal_value text not null,
  store_host text not null,
  sample text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (signal_kind, signal_value, store_host)
);

create index observations_by_signal on observations (signal_kind, signal_value);

create table candidates (
  signal_kind text not null,
  signal_value text not null,
  store_count integer not null default 0,
  status text not null default 'new' check (status in ('new', 'investigating', 'promoted', 'ignored')),
  suggested_app_id text references apps (id) on delete set null,
  sample text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (signal_kind, signal_value)
);

-- Stores known to have an app installed, used to measure how well detection performs.
create table ground_truth (
  app_id text not null references apps (id) on delete cascade,
  store_id bigint not null,
  source text not null default 'review',
  observed_on date,
  primary key (app_id, store_id)
);

-- Salla gives every store a short code in its asset URLs; collecting them lets a review
-- avatar be traced back to the store that left it.
create table store_codes (
  code text primary key,
  store_id bigint,
  store_host text,
  seen_at timestamptz not null default now()
);

create table canaries (
  store_url text primary key,
  expected_app_ids text[] not null default '{}',
  expected_services text[] not null default '{}',
  note text
);

create table health_events (
  id bigserial primary key,
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index health_events_recent on health_events (created_at desc);

create table job_state (
  job text primary key,
  cursor jsonb not null default '{}',
  last_run_at timestamptz,
  last_status text,
  updated_at timestamptz not null default now()
);

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- Nothing here is reachable with a public key: every read and write goes through the
-- server, which connects as the owner. Enabling row level security without adding a policy
-- keeps it that way even if a key is ever exposed.
alter table apps enable row level security;
alter table fingerprints enable row level security;
alter table noise_rules enable row level security;
alter table scans enable row level security;
alter table observations enable row level security;
alter table candidates enable row level security;
alter table ground_truth enable row level security;
alter table store_codes enable row level security;
alter table canaries enable row level security;
alter table health_events enable row level security;
alter table job_state enable row level security;
alter table rate_limits enable row level security;
