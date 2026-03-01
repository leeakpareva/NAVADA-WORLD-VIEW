/**
 * AI-powered fallback for panels that rely on backend proto APIs.
 * Called when FRED, WTO Trade, Supply Chain, Stablecoins, or Macro Signals
 * endpoints return 404 / empty / timeout.
 *
 * Uses xAI Grok (primary) → OpenAI GPT-4o-mini (fallback).
 * Results cached for 10 minutes per category.
 */

import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';

// ---- Generic AI call helpers ----

async function fetchFromProvider(
  url: string,
  key: string,
  model: string,
  prompt: string,
  maxTokens = 2000,
): Promise<string | null> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 30000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
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

async function callAI(prompt: string, maxTokens = 2000): Promise<string | null> {
  if (isFeatureAvailable('aiXai')) {
    const key = getSecretValue('XAI_API_KEY');
    if (key) {
      const result = await fetchFromProvider('https://api.x.ai/v1/chat/completions', key, 'grok-3-mini-fast', prompt, maxTokens);
      if (result) return result;
    }
  }
  const oaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
  if (oaiKey) return fetchFromProvider('https://api.openai.com/v1/chat/completions', oaiKey, 'gpt-4o-mini', prompt, maxTokens);
  return null;
}

function cleanJSON(raw: string): string {
  let cleaned = raw;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

// ---- Cache ----

const CACHE_TTL = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache: Record<string, CacheEntry<unknown>> = {};

function getCached<T>(key: string): T | null {
  const entry = cache[key] as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache[key] = { data, ts: Date.now() };
}

// ---- Deduplication ----

const inFlight: Record<string, Promise<unknown>> = {};

async function dedupedFetch<T>(key: string, fetcher: () => Promise<T | null>): Promise<T | null> {
  const cached = getCached<T>(key);
  if (cached) return cached;
  if (inFlight[key]) return inFlight[key] as Promise<T | null>;

  inFlight[key] = (async () => {
    const result = await fetcher();
    if (result) setCache(key, result);
    return result;
  })();

  try {
    return await inFlight[key] as T | null;
  } finally {
    delete inFlight[key];
  }
}

// ========================================
// FRED / Economic Indicators AI Fallback
// ========================================

export interface AIFredSeries {
  id: string;
  name: string;
  value: number;
  previousValue: number;
  change: number;
  changePercent: number;
  date: string;
  unit: string;
}

const FRED_PROMPT = `You are an economic data assistant. Return ONLY valid JSON (no markdown, no code fences) with current US economic indicators as of ${new Date().toISOString().split('T')[0]}.

{"series":[
{"id":"WALCL","name":"Fed Total Assets","value":6900000,"previousValue":6950000,"change":-50000,"changePercent":-0.7,"date":"${new Date().toISOString().split('T')[0]}","unit":"$B"},
{"id":"FEDFUNDS","name":"Fed Funds Rate","value":4.33,"previousValue":4.58,"change":-0.25,"changePercent":-5.5,"date":"${new Date().toISOString().split('T')[0]}","unit":"%"},
{"id":"T10Y2Y","name":"10Y-2Y Spread","value":0.25,"previousValue":0.18,"change":0.07,"changePercent":38.9,"date":"${new Date().toISOString().split('T')[0]}","unit":"%"},
{"id":"UNRATE","name":"Unemployment","value":4.1,"previousValue":4.0,"change":0.1,"changePercent":2.5,"date":"${new Date().toISOString().split('T')[0]}","unit":"%"},
{"id":"CPIAUCSL","name":"CPI Index","value":315.5,"previousValue":314.8,"change":0.7,"changePercent":0.2,"date":"${new Date().toISOString().split('T')[0]}","unit":""},
{"id":"DGS10","name":"10Y Treasury","value":4.35,"previousValue":4.28,"change":0.07,"changePercent":1.6,"date":"${new Date().toISOString().split('T')[0]}","unit":"%"},
{"id":"VIXCLS","name":"VIX","value":15.2,"previousValue":14.8,"change":0.4,"changePercent":2.7,"date":"${new Date().toISOString().split('T')[0]}","unit":""}
]}

Update ALL values to your best current estimates. Return ONLY the JSON object.`;

export async function getAIFredData(): Promise<AIFredSeries[] | null> {
  return dedupedFetch<AIFredSeries[]>('fred', async () => {
    console.log('[PanelAI] Fetching FRED economic data via AI...');
    const raw = await callAI(FRED_PROMPT);
    if (!raw) { console.warn('[PanelAI] FRED AI fallback failed'); return null; }
    try {
      const parsed = JSON.parse(cleanJSON(raw));
      if (parsed.series && parsed.series.length > 0) {
        console.log('[PanelAI] FRED AI data received:', parsed.series.length, 'series');
        return parsed.series as AIFredSeries[];
      }
    } catch { console.warn('[PanelAI] FRED AI parse failed'); }
    return null;
  });
}

// ========================================
// Trade Policy AI Fallback
// ========================================

export interface AITradeRestriction {
  country: string;
  measure: string;
  status: string;
  affectedSectors: string[];
  imposedDate: string;
  severity: string;
}

export interface AITariffDatapoint {
  year: number;
  avgTariff: number;
  sector: string;
}

export interface AITradeFlow {
  reporter: string;
  partner: string;
  exports: number;
  imports: number;
  balance: number;
  year: number;
}

export interface AITradeBarrier {
  country: string;
  type: string;
  description: string;
  affectedProducts: string;
  notificationDate: string;
}

export interface AITradePolicyData {
  restrictions: AITradeRestriction[];
  tariffs: AITariffDatapoint[];
  flows: AITradeFlow[];
  barriers: AITradeBarrier[];
}

const TRADE_PROMPT = `You are a trade policy data assistant. Return ONLY valid JSON (no markdown, no code fences) with current global trade policy data as of ${new Date().toISOString().split('T')[0]}.

{"restrictions":[
{"country":"United States","measure":"Section 301 Tariffs on China","status":"active","affectedSectors":["Technology","Steel","Aluminum"],"imposedDate":"2024-05","severity":"high"},
{"country":"European Union","measure":"Carbon Border Adjustment (CBAM)","status":"active","affectedSectors":["Steel","Cement","Aluminum","Fertilizers"],"imposedDate":"2023-10","severity":"moderate"},
{"country":"China","measure":"Rare Earth Export Controls","status":"active","affectedSectors":["Electronics","Defense","Green Energy"],"imposedDate":"2024-07","severity":"high"},
{"country":"India","measure":"Electronics Import Duties","status":"active","affectedSectors":["Consumer Electronics","Semiconductors"],"imposedDate":"2024-01","severity":"moderate"},
{"country":"Russia","measure":"Western Sanctions Response","status":"active","affectedSectors":["Energy","Finance","Technology"],"imposedDate":"2022-03","severity":"high"}
],
"tariffs":[
{"year":2020,"avgTariff":6.3,"sector":"All Goods"},
{"year":2021,"avgTariff":6.5,"sector":"All Goods"},
{"year":2022,"avgTariff":7.1,"sector":"All Goods"},
{"year":2023,"avgTariff":7.8,"sector":"All Goods"},
{"year":2024,"avgTariff":8.2,"sector":"All Goods"},
{"year":2025,"avgTariff":8.9,"sector":"All Goods"}
],
"flows":[
{"reporter":"United States","partner":"China","exports":148000,"imports":427000,"balance":-279000,"year":2025},
{"reporter":"United States","partner":"EU","exports":372000,"imports":558000,"balance":-186000,"year":2025},
{"reporter":"China","partner":"ASEAN","exports":520000,"imports":410000,"balance":110000,"year":2025}
],
"barriers":[
{"country":"United States","type":"TBT","description":"AI chip export restrictions","affectedProducts":"Semiconductors, GPU","notificationDate":"2024-10"},
{"country":"EU","type":"SPS","description":"Deforestation-linked import ban","affectedProducts":"Palm oil, Soy, Cocoa, Coffee","notificationDate":"2024-12"},
{"country":"India","type":"TBT","description":"Quality control orders on imports","affectedProducts":"Electronics, Steel, Chemicals","notificationDate":"2025-01"}
]}

Update ALL data to your best current estimates. Return ONLY the JSON object.`;

export async function getAITradePolicyData(): Promise<AITradePolicyData | null> {
  return dedupedFetch<AITradePolicyData>('trade', async () => {
    console.log('[PanelAI] Fetching trade policy data via AI...');
    const raw = await callAI(TRADE_PROMPT, 2500);
    if (!raw) { console.warn('[PanelAI] Trade AI fallback failed'); return null; }
    try {
      const parsed = JSON.parse(cleanJSON(raw));
      if (parsed.restrictions) {
        console.log('[PanelAI] Trade AI data received');
        return parsed as AITradePolicyData;
      }
    } catch { console.warn('[PanelAI] Trade AI parse failed'); }
    return null;
  });
}

// ========================================
// Supply Chain AI Fallback
// ========================================

export interface AIShippingIndex {
  name: string;
  value: number;
  change: number;
  unit: string;
  spikeAlert: boolean;
}

export interface AIChokepoint {
  name: string;
  status: string;
  disruption: number;
  vesselCount: number;
  avgDelay: number;
  region: string;
}

export interface AICriticalMineral {
  mineral: string;
  hhi: number;
  topProducers: Array<{ country: string; share: number }>;
  riskRating: string;
  priceChange: number;
}

export interface AISupplyChainData {
  shipping: AIShippingIndex[];
  chokepoints: AIChokepoint[];
  minerals: AICriticalMineral[];
}

const SUPPLY_CHAIN_PROMPT = `You are a supply chain data assistant. Return ONLY valid JSON (no markdown, no code fences) with current global supply chain data as of ${new Date().toISOString().split('T')[0]}.

{"shipping":[
{"name":"Baltic Dry Index","value":1450,"change":-2.3,"unit":"points","spikeAlert":false},
{"name":"SCFI (Shanghai)","value":1680,"change":5.1,"unit":"$/TEU","spikeAlert":false},
{"name":"Harpex Container","value":980,"change":1.2,"unit":"points","spikeAlert":false},
{"name":"VLCC Tanker Rate","value":42000,"change":-1.5,"unit":"$/day","spikeAlert":false},
{"name":"Suezmax Rate","value":38000,"change":3.2,"unit":"$/day","spikeAlert":false}
],
"chokepoints":[
{"name":"Strait of Hormuz","status":"elevated","disruption":25,"vesselCount":85,"avgDelay":2.5,"region":"Middle East"},
{"name":"Suez Canal","status":"normal","disruption":10,"vesselCount":52,"avgDelay":0.5,"region":"Middle East/Africa"},
{"name":"Strait of Malacca","status":"normal","disruption":8,"vesselCount":120,"avgDelay":0.3,"region":"Asia-Pacific"},
{"name":"Panama Canal","status":"elevated","disruption":35,"vesselCount":28,"avgDelay":4.0,"region":"Americas"},
{"name":"Bab el-Mandeb","status":"critical","disruption":65,"vesselCount":15,"avgDelay":12.0,"region":"Middle East/Africa"},
{"name":"Taiwan Strait","status":"normal","disruption":12,"vesselCount":95,"avgDelay":0.5,"region":"Asia-Pacific"}
],
"minerals":[
{"mineral":"Lithium","hhi":3200,"topProducers":[{"country":"Australia","share":47},{"country":"Chile","share":25},{"country":"China","share":15}],"riskRating":"high","priceChange":-8.5},
{"mineral":"Cobalt","hhi":4500,"topProducers":[{"country":"DR Congo","share":73},{"country":"Russia","share":5},{"country":"Australia","share":4}],"riskRating":"critical","priceChange":-3.2},
{"mineral":"Rare Earths","hhi":5800,"topProducers":[{"country":"China","share":70},{"country":"Myanmar","share":12},{"country":"Australia","share":6}],"riskRating":"critical","priceChange":2.1},
{"mineral":"Copper","hhi":1200,"topProducers":[{"country":"Chile","share":27},{"country":"Peru","share":10},{"country":"China","share":8}],"riskRating":"moderate","priceChange":4.5},
{"mineral":"Nickel","hhi":2100,"topProducers":[{"country":"Indonesia","share":52},{"country":"Philippines","share":10},{"country":"Russia","share":8}],"riskRating":"high","priceChange":-1.8}
]}

Update ALL data to your best current estimates. Return ONLY the JSON object.`;

export async function getAISupplyChainData(): Promise<AISupplyChainData | null> {
  return dedupedFetch<AISupplyChainData>('supplyChain', async () => {
    console.log('[PanelAI] Fetching supply chain data via AI...');
    const raw = await callAI(SUPPLY_CHAIN_PROMPT, 2500);
    if (!raw) { console.warn('[PanelAI] Supply chain AI fallback failed'); return null; }
    try {
      const parsed = JSON.parse(cleanJSON(raw));
      if (parsed.shipping || parsed.chokepoints || parsed.minerals) {
        console.log('[PanelAI] Supply chain AI data received');
        return parsed as AISupplyChainData;
      }
    } catch { console.warn('[PanelAI] Supply chain AI parse failed'); }
    return null;
  });
}

// ---- Availability check ----

export function isAIPanelFallbackAvailable(): boolean {
  const xaiKey = getSecretValue('XAI_API_KEY');
  const openaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
  return !!(xaiKey || openaiKey);
}
