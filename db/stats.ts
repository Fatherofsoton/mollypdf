import { env } from 'cloudflare:workers';

export type GlobalStats = {
  jobs: number;
  bytes: number;
  pages: number;
  popular: Array<{ toolId: string; count: number }>;
};

const allowedToolIds = new Set([
  'merge','split','organize','remove-pages','extract-pages','rotate','crop','scan',
  'compress','repair','ocr','grayscale','remove-blank','pdf-word','pdf-ppt',
  'pdf-excel','pdf-jpg','pdf-png','pdf-text','pdf-markdown','word-pdf','ppt-pdf',
  'excel-pdf','jpg-pdf','png-pdf','html-pdf','text-pdf','edit','watermark',
  'page-numbers','header-footer','create-form','fill-form','sign','protect',
  'unlock','redact','metadata','flatten','compare','word-count','read-aloud',
]);

function getDatabase() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

async function ensureSchema() {
  const db = getDatabase();
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS usage_stats (id INTEGER PRIMARY KEY, jobs INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tool_usage (tool_id TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 0)'),
    db.prepare("INSERT OR IGNORE INTO usage_stats (id, jobs, bytes, pages, updated_at) VALUES (1, 0, 0, 0, datetime('now'))"),
  ]);
}

export async function getGlobalStats(): Promise<GlobalStats> {
  await ensureSchema();
  const db = getDatabase();
  const total = await db.prepare('SELECT jobs, bytes, pages FROM usage_stats WHERE id = 1').first<{ jobs: number; bytes: number; pages: number }>();
  const popular = await db.prepare('SELECT tool_id AS toolId, uses AS count FROM tool_usage ORDER BY uses DESC, tool_id ASC LIMIT 3').all<{ toolId: string; count: number }>();
  return {
    jobs: Number(total?.jobs ?? 0),
    bytes: Number(total?.bytes ?? 0),
    pages: Number(total?.pages ?? 0),
    popular: popular.results.map((row) => ({ toolId: row.toolId, count: Number(row.count) })),
  };
}

export async function recordGlobalUsage(input: { toolId: string; bytes: number; pages: number }) {
  if (!allowedToolIds.has(input.toolId)) throw new Error('Unknown tool');
  const bytes = Math.min(Math.max(Math.round(input.bytes), 0), 250 * 1024 * 1024);
  const pages = Math.min(Math.max(Math.round(input.pages), 1), 5000);
  await ensureSchema();
  const db = getDatabase();
  await db.batch([
    db.prepare("UPDATE usage_stats SET jobs = jobs + 1, bytes = bytes + ?, pages = pages + ?, updated_at = datetime('now') WHERE id = 1").bind(bytes, pages),
    db.prepare('INSERT INTO tool_usage (tool_id, uses) VALUES (?, 1) ON CONFLICT(tool_id) DO UPDATE SET uses = uses + 1').bind(input.toolId),
  ]);
  return getGlobalStats();
}
