import { AeroApiError, getAeroApiHealth, readBoundedJsonRequest, solveAeroPayload } from '$lib/server/aeroApi.js';

export const prerender = false;

function corsHeaders(request, env = process.env) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  const origin = request.headers.get('origin');
  if (!origin) return { headers, allowed: true };

  let requestOrigin = '';
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    // Keep a request with an unparsable URL out of the cross-origin allowlist.
  }
  const configured = new Set(String(env.AERO_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean));
  const allowed = origin === requestOrigin || configured.has(origin);
  if (allowed) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '600');
    headers.set('Vary', 'Origin');
  }
  return { headers, allowed };
}

function jsonResponse(body, request, status = 200) {
  const { headers } = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

export function GET({ request }) {
  const { allowed } = corsHeaders(request);
  if (!allowed) return jsonResponse({ ok: false, error: 'Origin is not allowed.' }, request, 403);
  return jsonResponse(getAeroApiHealth(), request);
}

export async function OPTIONS({ request }) {
  const { headers, allowed } = corsHeaders(request);
  if (!allowed) return jsonResponse({ ok: false, error: 'Origin is not allowed.' }, request, 403);
  return new Response(null, { status: 204, headers });
}

export async function POST({ request }) {
  const { allowed } = corsHeaders(request);
  if (!allowed) return jsonResponse({ ok: false, error: 'Origin is not allowed.' }, request, 403);
  try {
    const payload = await readBoundedJsonRequest(request);
    const result = await solveAeroPayload(payload);
    return jsonResponse(result, request);
  } catch (error) {
    const status = error instanceof AeroApiError ? error.status : 500;
    const message = error instanceof AeroApiError ? error.message : 'Environmental solver request failed.';
    return jsonResponse({ ok: false, error: message }, request, status);
  }
}
