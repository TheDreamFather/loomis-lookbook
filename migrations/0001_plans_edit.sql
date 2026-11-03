-- Plans edit (feat/plans-edit) — ADDITIVE ONLY.
-- Creates three new tables and seeds the default legend. It does not alter,
-- rewrite or delete any existing table or row (scope_plans images, scope_rooms,
-- users, etc. are untouched). Safe to run more than once (IF NOT EXISTS / OR IGNORE).
--
-- Apply (production, at go-live):
--   wrangler d1 execute lookbook --remote --file migrations/0001_plans_edit.sql
-- Roll back (drops ONLY the new tables and their data):
--   wrangler d1 execute lookbook --remote --file migrations/0001_plans_edit.down.sql

-- Company-wide legend of colour-coded plan symbols. Add a row to extend the legend
-- (or use "+ Add legend item" in Plans edit). icon = built-in icon key, or
-- "text:AB" for a lettered badge.
CREATE TABLE IF NOT EXISTS plan_legend (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  created_by TEXT
);

-- Current markup overlay per floor plan. plan_key = the plan image URL as used by
-- the floor view (e.g. /white-floor-2.jpg or /api/scope/plan/<id>). data = JSON
-- {"items":[...]} with coordinates normalised 0..1 to the plan image. Room
-- regions are items of type "room" ({room_id,x,y,w,h}). The plan image itself is
-- never modified — the markup is an overlay.
CREATE TABLE IF NOT EXISTS plan_markups (
  project_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  label TEXT,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  updated_by TEXT,
  PRIMARY KEY (project_id, plan_key)
);

-- Previous versions (the API keeps the newest 25 per plan) so a save can be undone.
CREATE TABLE IF NOT EXISTS plan_markup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  saved_at TEXT,
  saved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_markup_history_plan ON plan_markup_history(project_id, plan_key, version);

INSERT OR IGNORE INTO plan_legend (id,name,color,icon,sort,active,created_at,created_by) VALUES
 ('lg-recessed','Recessed light','#f2c14e','recessed',10,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-pendant','Decorative / pendant','#e8913d','pendant',20,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-speaker','In-ceiling speaker','#4aa3df','speaker',30,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-sub','Subwoofer','#2e6fa8','sub',40,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-tv','TV / display','#9b6cd6','tv',50,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-wap','Wi-Fi access point','#31b6a6','wap',60,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-camera','Camera','#e05a5a','camera',70,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-keypad','Keypad / switch','#c9b27c','keypad',80,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-motion','Motion / occupancy sensor','#f08bb4','motion',90,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-shade','Motorized shade','#8fbf7f','shade',100,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-outlet','Outlet','#ff8c42','outlet',110,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-data','Data / network drop','#5ad1e6','data',120,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-thermostat','Thermostat','#b3d465','thermostat',130,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-doorbell','Video doorbell / intercom','#c78bf0','doorbell',140,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-rack','Equipment rack','#a8a8a8','rack',150,1,'2026-11-03T00:00:00.000Z','migration');
