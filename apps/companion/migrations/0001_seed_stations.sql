-- Seed the station catalogue. Names are the raw values the watch writes to each
-- FIT lap's developer field, so they must match apps/watch/source/SpaActivity.mc
-- (NAMES) and SessionManager.LABEL_TRANSITION exactly — they are the join key.
--
-- Row order follows the watch's catalogue order. `transition` is the walk between
-- stations, not a station: is_transition = 1, and it stays unclassified so it can
-- never land in hot/cold minutes.
--
-- Thermal classes are the venue's circuit, not inferable from the names alone:
-- the hydro pool and the heated loungers are both heat exposures here, and the
-- fire and ice room is a steam room with an ice outlet in it.
INSERT INTO stations (name, thermal_class, is_transition, created_at) VALUES
  ('Outdoor cold plunge',  'cold',         0, unixepoch()),
  ('Indoor cold plunge',   'cold',         0, unixepoch()),
  ('Hydro pool',           'hot',          0, unixepoch()),
  ('Heated loungers',      'hot',          0, unixepoch()),
  ('Himalayan salt sauna', 'hot',          0, unixepoch()),
  ('Steam room',           'hot',          0, unixepoch()),
  ('Fire and ice room',    'hot',          0, unixepoch()),
  ('Finnish sauna',        'hot',          0, unixepoch()),
  ('Ice cave',             'cold',         0, unixepoch()),
  ('Outdoor lounger',      'neutral',      0, unixepoch()),
  ('transition',           'unclassified', 1, unixepoch());
