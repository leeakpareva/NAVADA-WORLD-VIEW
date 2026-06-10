import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Server-side OpenAI chat proxy so web deployments never ship the API key
// in the client bundle. Accepts a minimal chat-completions shape and returns
// the OpenAI response body untouched (panels parse choices[0].message.content).

const MAX_TOKENS_CAP = 800;
const MAX_PROMPT_CHARS = 8000;
const ALLOWED_MODELS = new Set(['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']);

// Light in-memory rate limit (per runtime instance): 30 requests/min/IP
const rateBuckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const recent = bucket.filter((t) => now - t < 60_000);
  if (recent.length >= 30) return true;
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return false;
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'POST, OPTIONS');
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  if (isDisallowedOrigin(req)) return json(403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(503, { error: 'OPENAI_API_KEY not configured' });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return json(429, { error: 'Rate limited' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'gpt-4o-mini';
  let messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages && typeof body.prompt === 'string') {
    messages = [{ role: 'user', content: body.prompt }];
  }
  if (!messages || messages.length === 0) return json(400, { error: 'messages or prompt required' });

  messages = messages.slice(0, 8).map((m) => ({
    role: m.role === 'system' ? 'system' : 'user',
    content: String(m.content || '').slice(0, MAX_PROMPT_CHARS),
  }));

  const maxTokens = Math.min(Number(body.max_tokens) || 500, MAX_TOKENS_CAP);
  const temperature = Math.min(Math.max(Number(body.temperature) || 0.2, 0), 1);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return json(502, { error: `Upstream failure: ${err.message}` });
  }
}
