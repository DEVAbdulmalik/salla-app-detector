-- Stores served from a salla.sa path all share one host, so the host alone cannot identify
-- a store: two handles collided in the scan cache and their signals merged into one row.
-- The identity is now the host for a store on its own domain, and host/handle otherwise.

alter table scans rename column store_host to store_key;
alter table observations rename column store_host to store_key;

alter table store_codes rename column store_host to store_key;

alter index scans_by_store rename to scans_by_store_key;
