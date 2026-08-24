import 'server-only';
import { allowedToolIds } from '../lib/tools/registry';

/**
 * Usage counters.
 *
 * Design rule that was missing before: **the counters are decorative, the tools
 * are the product.** The old code threw when the D1 binding was absent, which
 * meant a deploy without a database served a broken home page for a site whose
 * every feature runs client-side and needs no database at all.
 *
 * Now there are three drivers and the site works with any of them:
 *   - `postgres` when DATABASE_URL / POSTGRES_URL is set (Vercel, Neon, Supabase)
 *   - `memory`   when it is not — counters read as zero, nothing errors
 *   - the D1 driver stays in `db/drivers/d1.ts` for a Cloudflare deploy
 */

export type GlobalStats = {
  jobs: number;
  bytes: number;
  pages: number;
  popular: Array<{ toolId: string; count: number }>;
  /** So the UI can say "ยังไม่ได้เชื่อมต่อ" instead of showing a fake zero. */
  source: 'postgres' | 'memory';
};

const EMPTY: GlobalStats = { jobs: 0, bytes: 0, pages: 0, popular: [], source: 'memory' };

function connectionString() {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    ''
  );
}

export function statsEnabled() {
  return connectionString().length > 0;
}

export async function getGlobalStats(): Promise<GlobalStats> {
  if (!statsEnabled()) return EMPTY;
  try {
    const { readStats } = await import('./drivers/postgres');
    return await readStats();
  } catch (error) {
    // A stats outage must never take the tools down with it.
    console.error('[stats] read failed', error);
    return EMPTY;
  }
}

export async function recordGlobalUsage(input: {
  toolId: string;
  bytes: number;
  pages: number;
}): Promise<GlobalStats> {
  if (!allowedToolIds.has(input.toolId)) throw new Error('Unknown tool');
  if (!statsEnabled()) return EMPTY;

  const bytes = Math.min(Math.max(Math.round(input.bytes) || 0, 0), 300 * 1024 * 1024);
  const pages = Math.min(Math.max(Math.round(input.pages) || 1, 1), 5000);

  try {
    const { writeUsage } = await import('./drivers/postgres');
    return await writeUsage({ toolId: input.toolId, bytes, pages });
  } catch (error) {
    console.error('[stats] write failed', error);
    return EMPTY;
  }
}
