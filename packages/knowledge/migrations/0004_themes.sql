-- A storefront names the theme it runs, so this table only has to say what that name
-- means. The key is the identifier a store reports, which is Salla's preview identifier
-- for the theme, not the product identifier its store listing uses.
create table themes (
  id text primary key,
  name text not null,
  developer text,
  version text,
  rating real,
  ratings_count integer,
  is_beta boolean not null default false,
  listing_id text,
  status text not null default 'listed' check (status in ('listed', 'delisted')),
  updated_at timestamptz not null default now()
);

alter table themes enable row level security;
