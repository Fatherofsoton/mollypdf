import 'server-only';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { desc, eq, sql } from 'drizzle-orm';
import { toolUsage, usageStats } from '../schema';
import type { GlobalStats } from '../stats';

/**
 * Postgres driver, over the Neon serverless HTTP client so it works from a
 * Vercel edge/serverless function with no connection pool to exhaust.
 * The same code runs against Vercel Postgres, Neon and Supabase — they all
 * speak the same wire protocol behind a `postgres://` URL.
 */

let cached: ReturnType<typeof drizzle> | null = null;

function db() {
  if (!cached) {
    const url =
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_URL_NON_POOLING;
    if (!url) throw new Error('DATABASE_URL is not set');
    cached = drizzle(neon(url));
  }
  return cached;
}

async function read(): Promise<GlobalStats> {
  const client = db();
  const [totals, popular] = await Promise.all([
    client.select().from(usageStats).where(eq(usageStats.id, 1)).limit(1),
    client
      .select({ toolId: toolUsage.toolId, count: toolUsage.uses })
      .from(toolUsage)
      .orderBy(desc(toolUsage.uses), toolUsage.toolId)
      .limit(3),
  ]);
  const row = totals[0];
  return {
    jobs: Number(row?.jobs ?? 0),
    bytes: Number(row?.bytes ?? 0),
    pages: Number(row?.pages ?? 0),
    popular: popular.map((p) => ({ toolId: p.toolId, count: Number(p.count) })),
    source: 'postgres',
  };
}

export async function readStats(): Promise<GlobalStats> {
  return read();
}

export async function writeUsage(input: {
  toolId: string;
  bytes: number;
  pages: number;
}): Promise<GlobalStats> {
  const client = db();

  // One statement each, both idempotent-safe upserts. The old D1 code ran
  // three CREATE TABLE statements before every single request, including reads.
  await client
    .insert(usageStats)
    .values({ id: 1, jobs: 1, bytes: input.bytes, pages: input.pages })
    .onConflictDoUpdate({
      target: usageStats.id,
      set: {
        jobs: sql`${usageStats.jobs} + 1`,
        bytes: sql`${usageStats.bytes} + ${input.bytes}`,
        pages: sql`${usageStats.pages} + ${input.pages}`,
        updatedAt: sql`now()`,
      },
    });

  await client
    .insert(toolUsage)
    .values({ toolId: input.toolId, uses: 1 })
    .onConflictDoUpdate({
      target: toolUsage.toolId,
      set: { uses: sql`${toolUsage.uses} + 1` },
    });

  return read();
}
