-- Integrations and dropshipping were never counted as fingerprint matches, so fingerprints
-- that match most stores sat at zero. The reports already stored say what they matched.
with matched as (
  select evidence->>'kind' as kind,
         evidence->>'value' as pattern,
         count(*) as matches,
         max(scans.scanned_at) as last_matched_at
  from scans,
       jsonb_array_elements(scans.report->'dropshipping') as app,
       jsonb_array_elements(app->'evidence') as evidence
  where scans.status = 'live'
  group by 1, 2
  union all
  select 'service',
         integration->>'key',
         count(*),
         max(scans.scanned_at)
  from scans,
       jsonb_array_elements(scans.report->'integrations') as integration
  where scans.status = 'live' and integration->>'appId' is not null
  group by 2
)
update fingerprints
set match_count = fingerprints.match_count + matched.matches,
    last_matched_at = greatest(fingerprints.last_matched_at, matched.last_matched_at)
from matched
where fingerprints.kind = matched.kind and fingerprints.pattern = matched.pattern;
