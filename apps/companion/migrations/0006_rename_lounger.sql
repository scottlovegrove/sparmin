-- The venue has indoor loungers as well as outdoor ones, so the station is just
-- "Loungers" now. Like 0001_seed_stations.sql and 0004_seed_hot_tub.sql this is
-- hand-written and invisible to Drizzle's journal.
--
-- The name must match the watch's FIT lap label exactly
-- (apps/watch/source/SpaActivity.mc NAMES: "Loungers") — it is the join key for
-- an imported file. The slug stays `outdoor_lounger`: it is the watch's
-- permanent catalogue id, already written into sessions recorded before the
-- rename, and worker/station-refs.ts folds the old lap name onto this row.
UPDATE stations SET name = 'Loungers' WHERE name = 'Outdoor lounger';
