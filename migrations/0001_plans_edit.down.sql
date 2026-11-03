-- Rollback for 0001_plans_edit.sql — drops ONLY the tables that migration created
-- (all saved plan markups, history and custom legend items are lost). Export first:
--   wrangler d1 export lookbook --remote --table plan_markups --output plan_markups-backup.sql
DROP INDEX IF EXISTS idx_plan_markup_history_plan;
DROP TABLE IF EXISTS plan_markup_history;
DROP TABLE IF EXISTS plan_markups;
DROP TABLE IF EXISTS plan_legend;
