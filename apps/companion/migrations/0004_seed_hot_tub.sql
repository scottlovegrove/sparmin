-- Seed the Hot tub station. Like 0001_seed_stations.sql this is a hand-written
-- seed, invisible to Drizzle's journal. The name must match the watch's FIT lap
-- label exactly (apps/watch/source/SpaActivity.mc NAMES: "Hot tub") — it is the
-- join key. Hot tub is a heat exposure, so it lands in the 'hot' circuit.
INSERT INTO stations (name, thermal_class, is_transition, created_at)
  VALUES ('Hot tub', 'hot', 0, unixepoch());
