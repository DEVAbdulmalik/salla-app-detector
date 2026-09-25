-- Most review avatars name the store only by its CDN code, which means nothing until a
-- scan ties that code to a store. Keeping the codes lets that scan turn each one into a
-- known installation without the reviews being read again.
create table review_codes (
  app_id text not null references apps (id) on delete cascade,
  code text not null,
  observed_on date,
  primary key (app_id, code)
);

create index review_codes_by_code on review_codes (code);

alter table review_codes enable row level security;
