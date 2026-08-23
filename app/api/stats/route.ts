import { getGlobalStats, recordGlobalUsage } from '../../../db/stats';

const jsonHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

export async function GET() {
  try {
    return new Response(JSON.stringify(await getGlobalStats()), { headers: jsonHeaders });
  } catch {
    return new Response(JSON.stringify({ error: 'stats_unavailable' }), { status: 503, headers: jsonHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return new Response(JSON.stringify({ error: 'invalid_origin' }), { status: 403, headers: jsonHeaders });
    }
    const body = await request.json() as { toolId?: unknown; bytes?: unknown; pages?: unknown };
    if (typeof body.toolId !== 'string' || typeof body.bytes !== 'number' || typeof body.pages !== 'number') {
      return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: jsonHeaders });
    }
    return new Response(JSON.stringify(await recordGlobalUsage({
      toolId: body.toolId,
      bytes: body.bytes,
      pages: body.pages,
    })), { headers: jsonHeaders });
  } catch {
    return new Response(JSON.stringify({ error: 'stats_unavailable' }), { status: 503, headers: jsonHeaders });
  }
}
