import { getGlobalStats, recordGlobalUsage, statsEnabled } from '../../../db/stats';

/**
 * Hardening notes.
 *
 * The original POST guard was:
 *     if (origin && origin !== new URL(request.url).origin) reject
 *
 * `origin &&` makes it opt-in: any client that simply omits the Origin header —
 * which curl, every HTTP library and every bot does by default — sailed
 * straight through. A one-line shell loop could have driven the public counters
 * to any number, and those counters are presented on the home page as social
 * proof. Now the header is required and must match, plus a per-IP token bucket,
 * a body size cap before parsing, and a short edge cache on the read path
 * instead of `no-store` (which made every visitor a database round trip).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...jsonHeaders, ...(init.headers ?? {}) },
  });
}

/* Best-effort in-instance rate limit. For a hard guarantee put Vercel's own
   rate limiting (or a Cloudflare rule) in front of /api/stats — it applies
   before the function is even invoked. */
const buckets = new Map<string, { tokens: number; refilled: number }>();
const LIMIT = 20;
const WINDOW = 60_000;

function clientIp(request: Request) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

function rateLimited(request: Request) {
  const ip = clientIp(request);
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { tokens: LIMIT, refilled: now };
  if (now - bucket.refilled > WINDOW) {
    bucket.tokens = LIMIT;
    bucket.refilled = now;
  }
  if (bucket.tokens <= 0) {
    buckets.set(ip, bucket);
    return true;
  }
  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  if (buckets.size > 5000) buckets.clear();
  return false;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const expected = new URL(request.url).host;
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}

export async function GET() {
  const stats = await getGlobalStats();
  return json(stats, {
    headers: {
      'Cache-Control': statsEnabled()
        ? 'public, max-age=30, stale-while-revalidate=300'
        : 'public, max-age=3600',
    },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'invalid_origin' }, { status: 403 });
  if (rateLimited(request)) {
    return json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const raw = await request.text();
  if (raw.length > 512) return json({ error: 'payload_too_large' }, { status: 413 });

  let body: { toolId?: unknown; bytes?: unknown; pages?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (
    typeof body.toolId !== 'string' ||
    typeof body.bytes !== 'number' ||
    typeof body.pages !== 'number' ||
    !Number.isFinite(body.bytes) ||
    !Number.isFinite(body.pages)
  ) {
    return json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    const stats = await recordGlobalUsage({
      toolId: body.toolId,
      bytes: body.bytes,
      pages: body.pages,
    });
    return json(stats, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return json({ error: 'unknown_tool' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
