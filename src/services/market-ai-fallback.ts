/**
 * AI-powered fallback for market, commodity, crypto, and sector data.
 * Called when Finnhub/Yahoo/CoinGecko APIs are rate-limited or unavailable.
 * Uses xAI Grok (primary) → OpenAI (fallback) to generate approximate data.
 *
 * Results are cached for 10 minutes to avoid excessive AI calls.
 */

import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';

// ---- Types ----

export interface AIMarketQuote {
  symbol: string;
  name: string;
  display: string;
  price: number;
  change: number;
}

export interface AICryptoQuote {
  name: string;
  symbol: string;
  price: number;
  change: number;
}

export interface AISectorQuote {
  name: string;
  change: number;
}

interface AIMarketCache {
  stocks: AIMarketQuote[];
  commodities: AIMarketQuote[];
  crypto: AICryptoQuote[];
  sectors: AISectorQuote[];
  timestamp: number;
}

// ---- Cache ----

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let aiCache: AIMarketCache | null = null;

function isCacheValid(): boolean {
  return aiCache !== null && Date.now() - aiCache.timestamp < CACHE_TTL_MS;
}

// ---- AI prompt ----

const MARKET_PROMPT = `You are a financial data assistant. Return ONLY valid JSON (no markdown, no code fences, no explanation) with approximate current market data. Use realistic current prices based on your latest knowledge. The JSON must match this exact structure:

{
  "stocks": [
    {"symbol":"^GSPC","name":"S&P 500","display":"SPX","price":5800,"change":0.3},
    {"symbol":"^DJI","name":"Dow Jones","display":"DOW","price":42500,"change":0.2},
    {"symbol":"^IXIC","name":"NASDAQ","display":"NDX","price":18500,"change":0.4},
    {"symbol":"AAPL","name":"Apple","display":"AAPL","price":230,"change":-0.1},
    {"symbol":"MSFT","name":"Microsoft","display":"MSFT","price":430,"change":0.5},
    {"symbol":"NVDA","name":"NVIDIA","display":"NVDA","price":135,"change":1.2},
    {"symbol":"GOOGL","name":"Alphabet","display":"GOOGL","price":175,"change":0.3},
    {"symbol":"AMZN","name":"Amazon","display":"AMZN","price":200,"change":0.6},
    {"symbol":"META","name":"Meta","display":"META","price":580,"change":0.4},
    {"symbol":"BRK-B","name":"Berkshire","display":"BRK.B","price":460,"change":0.1},
    {"symbol":"TSM","name":"TSMC","display":"TSM","price":180,"change":0.8},
    {"symbol":"LLY","name":"Eli Lilly","display":"LLY","price":780,"change":-0.2},
    {"symbol":"TSLA","name":"Tesla","display":"TSLA","price":350,"change":1.5},
    {"symbol":"AVGO","name":"Broadcom","display":"AVGO","price":220,"change":0.7},
    {"symbol":"WMT","name":"Walmart","display":"WMT","price":95,"change":0.1},
    {"symbol":"JPM","name":"JPMorgan","display":"JPM","price":240,"change":0.3},
    {"symbol":"V","name":"Visa","display":"V","price":310,"change":0.2},
    {"symbol":"UNH","name":"UnitedHealth","display":"UNH","price":520,"change":-0.3},
    {"symbol":"NVO","name":"Novo Nordisk","display":"NVO","price":120,"change":-0.5},
    {"symbol":"XOM","name":"Exxon","display":"XOM","price":110,"change":0.4},
    {"symbol":"MA","name":"Mastercard","display":"MA","price":520,"change":0.2},
    {"symbol":"ORCL","name":"Oracle","display":"ORCL","price":180,"change":0.6},
    {"symbol":"PG","name":"P&G","display":"PG","price":170,"change":0.1},
    {"symbol":"COST","name":"Costco","display":"COST","price":920,"change":0.3},
    {"symbol":"JNJ","name":"J&J","display":"JNJ","price":155,"change":-0.1},
    {"symbol":"HD","name":"Home Depot","display":"HD","price":400,"change":0.2},
    {"symbol":"NFLX","name":"Netflix","display":"NFLX","price":900,"change":0.8},
    {"symbol":"BAC","name":"BofA","display":"BAC","price":44,"change":0.3}
  ],
  "commodities": [
    {"symbol":"^VIX","name":"VIX","display":"VIX","price":15,"change":-2.1},
    {"symbol":"GC=F","name":"Gold","display":"GOLD","price":2950,"change":0.3},
    {"symbol":"CL=F","name":"Crude Oil","display":"OIL","price":72,"change":-0.5},
    {"symbol":"NG=F","name":"Natural Gas","display":"NATGAS","price":3.8,"change":1.2},
    {"symbol":"SI=F","name":"Silver","display":"SILVER","price":33,"change":0.4},
    {"symbol":"HG=F","name":"Copper","display":"COPPER","price":4.5,"change":0.2}
  ],
  "crypto": [
    {"name":"Bitcoin","symbol":"BTC","price":87000,"change":1.5},
    {"name":"Ethereum","symbol":"ETH","price":3200,"change":2.1},
    {"name":"Solana","symbol":"SOL","price":140,"change":3.2},
    {"name":"XRP","symbol":"XRP","price":2.3,"change":1.8}
  ],
  "sectors": [
    {"name":"Tech","change":0.5},
    {"name":"Finance","change":0.3},
    {"name":"Energy","change":-0.2},
    {"name":"Health","change":0.1},
    {"name":"Consumer","change":0.4},
    {"name":"Industrial","change":0.2},
    {"name":"Staples","change":0.1},
    {"name":"Utilities","change":-0.1},
    {"name":"Materials","change":0.3},
    {"name":"Real Est","change":-0.3},
    {"name":"Comms","change":0.6},
    {"name":"Semis","change":0.8}
  ]
}

Update ALL prices to your best estimate of current values as of today ${new Date().toISOString().split('T')[0]}. Change values are daily percentage change. Return ONLY the JSON object, nothing else.`;

// ---- AI fetch helpers ----

async function fetchFromXai(prompt: string): Promise<string | null> {
  const key = getSecretValue('XAI_API_KEY');
  if (!key) return null;

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini-fast',
        max_tokens: 3000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: abort.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromOpenai(prompt: string): Promise<string | null> {
  const key =
    getSecretValue('OPENAI_API_KEY') ||
    (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
  if (!key) return null;

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 3000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: abort.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAIResponse(raw: string): AIMarketCache | null {
  try {
    // Strip markdown code fences if present
    let cleaned = raw;
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    const parsed = JSON.parse(cleaned);
    if (!parsed.stocks || !parsed.commodities || !parsed.crypto || !parsed.sectors) return null;
    return { ...parsed, timestamp: Date.now() };
  } catch {
    return null;
  }
}

// ---- Public API ----

let fetchInProgress: Promise<AIMarketCache | null> | null = null;

async function fetchAIMarketData(): Promise<AIMarketCache | null> {
  // Return cached data if still valid
  if (isCacheValid()) return aiCache;

  // Deduplicate concurrent requests
  if (fetchInProgress) return fetchInProgress;

  fetchInProgress = (async () => {
    console.log('[MarketAI] Fetching AI-generated market data...');

    // Try xAI first
    if (isFeatureAvailable('aiXai')) {
      const raw = await fetchFromXai(MARKET_PROMPT);
      if (raw) {
        const parsed = parseAIResponse(raw);
        if (parsed) {
          aiCache = parsed;
          console.log('[MarketAI] xAI Grok market data received');
          return aiCache;
        }
      }
    }

    // Fallback to OpenAI
    const raw = await fetchFromOpenai(MARKET_PROMPT);
    if (raw) {
      const parsed = parseAIResponse(raw);
      if (parsed) {
        aiCache = parsed;
        console.log('[MarketAI] OpenAI market data received');
        return aiCache;
      }
    }

    console.warn('[MarketAI] All AI providers failed');
    return null;
  })();

  try {
    return await fetchInProgress;
  } finally {
    fetchInProgress = null;
  }
}

/**
 * Get AI-generated stock market data as fallback.
 * Returns MarketData[] compatible with MarketPanel.renderMarkets()
 */
export async function getAIStocks(): Promise<AIMarketQuote[]> {
  const data = await fetchAIMarketData();
  return data?.stocks ?? [];
}

/**
 * Get AI-generated commodity data as fallback.
 * Returns data compatible with CommoditiesPanel.renderCommodities()
 */
export async function getAICommodities(): Promise<AIMarketQuote[]> {
  const data = await fetchAIMarketData();
  return data?.commodities ?? [];
}

/**
 * Get AI-generated crypto data as fallback.
 * Returns CryptoData[] compatible with CryptoPanel.renderCrypto()
 */
export async function getAICrypto(): Promise<AICryptoQuote[]> {
  const data = await fetchAIMarketData();
  return data?.crypto ?? [];
}

/**
 * Get AI-generated sector heatmap data as fallback.
 * Returns data compatible with HeatmapPanel.renderHeatmap()
 */
export async function getAISectors(): Promise<AISectorQuote[]> {
  const data = await fetchAIMarketData();
  return data?.sectors ?? [];
}

/**
 * Check if AI market data is available (has valid API keys).
 */
export function isAIMarketAvailable(): boolean {
  const xaiKey = getSecretValue('XAI_API_KEY');
  const openaiKey =
    getSecretValue('OPENAI_API_KEY') ||
    (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
  return !!(xaiKey || openaiKey);
}
