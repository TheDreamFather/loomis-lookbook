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
-- "text:AB" for a lettered badge. wiring = JSON wiring rule used by "Wiring" in
-- Plans edit (NULL = no wiring), e.g.
--   {"rule":"home","to":"rack","wire":"Cat6","color":"#d64545"}   one run per device to the rack
--   {"rule":"pair","to":"rack","wire":"16/4 speaker","color":"#2f7fd0"}  speakers paired, one run per pair
--   {"rule":"chain","to":"panel","wire":"14/2","color":"#d49a00","max":0}  daisy-chained back to a breaker/panel
--   {"rule":"source","src":"rack"|"panel"}   this item IS a head-end / breaker panel
--   {"rule":"none"}
-- NOTE: a database that ran an earlier draft of this file (only lookbook-staging) was
-- brought up to date with: ALTER TABLE plan_legend ADD COLUMN wiring TEXT; plus UPDATEs
-- of the seed rows below. Production has never run this file, so nothing extra is needed there.
CREATE TABLE IF NOT EXISTS plan_legend (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  wiring TEXT,
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

INSERT OR IGNORE INTO plan_legend (id,name,color,icon,wiring,sort,active,created_at,created_by) VALUES
 ('lg-recessed','Recessed light','#f2c14e','recessed','{"rule":"chain","to":"panel","wire":"14/2 · Lutron lighting","color":"#d49a00"}',10,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-pendant','Decorative / pendant','#e8913d','pendant','{"rule":"chain","to":"panel","wire":"14/2 · Lutron lighting","color":"#d49a00"}',20,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-speaker','In-ceiling speaker','#4aa3df','speaker','{"rule":"pair","to":"rack","wire":"16/4 speaker","color":"#2f7fd0"}',30,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-sub','Subwoofer','#2e6fa8','sub','{"rule":"none"}',40,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-tv','TV / display','#9b6cd6','tv','{"rule":"home","to":"rack","wire":"Cat6 + HDMI","color":"#7d4fc4"}',50,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-wap','Wi-Fi access point','#31b6a6','wap','{"rule":"home","to":"rack","wire":"Cat6","color":"#179c8c"}',60,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-camera','Camera','#e05a5a','camera','{"rule":"home","to":"rack","wire":"Cat6","color":"#d64545"}',70,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-keypad','Keypad / switch','#c9b27c','keypad','{"rule":"chain","to":"panel","wire":"Lutron QS link","color":"#9c7a1f"}',80,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-motion','Motion / occupancy sensor','#f08bb4','motion','{"rule":"none"}',90,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-shade','Motorized shade','#8fbf7f','shade','{"rule":"chain","to":"panel","wire":"Lutron QS shade cable","color":"#4f9a45"}',100,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-outlet','Outlet','#ff8c42','outlet','{"rule":"none"}',110,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-data','Data / network drop','#5ad1e6','data','{"rule":"home","to":"rack","wire":"Cat6","color":"#1597b8"}',120,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-thermostat','Thermostat','#b3d465','thermostat','{"rule":"home","to":"rack","wire":"Cat6","color":"#7f9f2f"}',130,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-doorbell','Video doorbell / intercom','#c78bf0','doorbell','{"rule":"home","to":"rack","wire":"Cat6","color":"#a35bd6"}',140,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-rack','Rack / head-end','#a8a8a8','rack','{"rule":"source","src":"rack"}',150,1,'2026-11-03T00:00:00.000Z','migration'),
 ('lg-breaker','Breaker / panel','#6f7d8c','breaker','{"rule":"source","src":"panel"}',160,1,'2026-11-03T00:00:00.000Z','migration');
