import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const usageStats = sqliteTable('usage_stats', {
  id: integer('id').primaryKey(),
  jobs: integer('jobs').notNull().default(0),
  bytes: integer('bytes').notNull().default(0),
  pages: integer('pages').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const toolUsage = sqliteTable('tool_usage', {
  toolId: text('tool_id').primaryKey(),
  uses: integer('uses').notNull().default(0),
});
