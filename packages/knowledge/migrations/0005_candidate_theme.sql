-- A trace shared by every store running one theme is that theme's own asset, not an app
-- a merchant installed. Recording which theme lets the reviewer see that at a glance
-- instead of investigating the same domain again every week.
alter table candidates add column theme_id text;
