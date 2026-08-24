-- mollypdf usage counters (Postgres)
--
-- Run once against your database before the first deploy:
--   psql "$DATABASE_URL" -f drizzle/0001_init.sql
--
-- Replaces the old pattern of issuing CREATE TABLE IF NOT EXISTS on every
-- single API request, including reads.

CREATE TABLE IF NOT EXISTS usage_stats (
  id          integer PRIMARY KEY,
  jobs        bigint      NOT NULL DEFAULT 0,
  bytes       bigint      NOT NULL DEFAULT 0,
  pages       bigint      NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tool_usage (
  tool_id  text   PRIMARY KEY,
  uses     bigint NOT NULL DEFAULT 0
);

INSERT INTO usage_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Serves the "เครื่องมือยอดนิยม" query on the home page.
CREATE INDEX IF NOT EXISTS tool_usage_uses_idx ON tool_usage (uses DESC, tool_id ASC);
