import { bigint, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Drizzle was already a dependency in this repo but nothing used it —
 * `db/stats.ts` hand-wrote raw D1 prepared statements while a generated
 * migration sat unused in `drizzle/`. Moving to Vercel is the moment to pick
 * one: the schema below is the single definition, and the queries in
 * `db/drivers/postgres.ts` are built from it.
 *
 * `bytes` is a bigint: the old SQLite column was a 32-bit INTEGER, which
 * overflows at 2.1 GB of cumulative processed file size — a counter the home
 * page advertises and therefore one that will reach that number.
 */

export const usageStats = pgTable('usage_stats', {
  id: integer('id').primaryKey(),
  jobs: bigint('jobs', { mode: 'number' }).notNull().default(0),
  bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  pages: bigint('pages', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const toolUsage = pgTable('tool_usage', {
  toolId: text('tool_id').primaryKey(),
  uses: bigint('uses', { mode: 'number' }).notNull().default(0),
});
