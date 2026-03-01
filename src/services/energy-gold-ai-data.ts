/**
 * AI-powered data service for Energy Prices and Gold Price panels.
 * Uses xAI Grok (primary) → OpenAI GPT-4o-mini (fallback).
 * Results cached for 10 minutes.
 */

import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';

// ---- Types ----

export interface EnergyRegionData {
  region: string;
  crudeOil: number;   // $/barrel
  naturalGas: number; // $/MMBtu
  electricity: number; // $/MWh
  coal: number;        // $/ton
}

export interface EnergyPricesData {
  regions: EnergyRegionData[];
  timestamp: string;
}

export interface GoldData {
  price: number;          // USD/oz
  change24h: number;      // % change
  trend: number[];        // 7 data points (daily)
  silver: number;         // USD/oz
  platinum: number;       // USD/oz
  palladium: number;      // USD/oz
  silverChange: number;   // %
  platinumChange: number; // %
  palladiumChange: number; // %
}

// ---- Cache ----

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let energyCache: CacheEntry<EnergyPricesData> | null = null;
let goldCache: CacheEntry<GoldData> | null = null;

function isCacheValid<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS;
}

// ---- AI fetch helpers ----

async function fetchFromXai(prompt: string): Promise<string | null> {
  const key = getSecretValue('XAI_API_KEY');
  if (!key) return null;

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 30000);
  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini-fast',
        max_tokens: 2000,
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
  const timeout = setTimeout(() => abort.abort(), 30000);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
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

async function callAI(prompt: string): Promise<string | null> {
  if (isFeatureAvailable('aiXai')) {
    const result = await fetchFromXai(prompt);
    if (result) return result;
  }
  return fetchFromOpenai(prompt);
}

function cleanJSON(raw: string): string {
  let cleaned = raw;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

// ---- Prompts ----

const ENERGY_PROMPT = `You are an energy markets data assistant. Return ONLY valid JSON (no markdown, no code fences, no explanation) with approximate current global energy prices across 6 regions. Use realistic current prices as of ${new Date().toISOString().split('T')[0]}.

{
  "regions": [
    {"region":"North America","crudeOil":72,"naturalGas":3.8,"electricity":85,"coal":120},
    {"region":"Europe","crudeOil":76,"naturalGas":12.5,"electricity":140,"coal":135},
    {"region":"Middle East","crudeOil":70,"naturalGas":2.5,"electricity":45,"coal":95},
    {"region":"Asia-Pacific","crudeOil":75,"naturalGas":14.2,"electricity":110,"coal":145},
    {"region":"Africa","crudeOil":74,"naturalGas":8.5,"electricity":95,"coal":110},
    {"region":"Latin America","crudeOil":73,"naturalGas":6.2,"electricity":75,"coal":100}
  ],
  "timestamp":"${new Date().toISOString()}"
}

Units: crudeOil=$/barrel, naturalGas=$/MMBtu, electricity=$/MWh, coal=$/metric ton.
Update ALL prices to your best current estimates. Return ONLY the JSON object.`;

const GOLD_PROMPT = `You are a precious metals data assistant. Return ONLY valid JSON (no markdown, no code fences, no explanation) with current precious metals prices as of ${new Date().toISOString().split('T')[0]}.

{
  "price":2950,
  "change24h":0.3,
  "trend":[2920,2930,2925,2940,2935,2945,2950],
  "silver":33.5,
  "platinum":1020,
  "palladium":980,
  "silverChange":0.5,
  "platinumChange":-0.2,
  "palladiumChange":0.8
}

price=gold spot USD/oz, change24h=daily % change, trend=7 daily closing prices (most recent last), other metals in USD/oz with daily % changes.
Update ALL to your best current estimates. Return ONLY the JSON object.`;

// ---- Deduplication ----

let energyFetchInProgress: Promise<EnergyPricesData | null> | null = null;
let goldFetchInProgress: Promise<GoldData | null> | null = null;

// ---- Public API ----

export async function getAIEnergyPrices(): Promise<EnergyPricesData | null> {
  if (isCacheValid(energyCache)) return energyCache.data;
  if (energyFetchInProgress) return energyFetchInProgress;

  energyFetchInProgress = (async () => {
    console.log('[EnergyAI] Fetching energy prices...');
    const raw = await callAI(ENERGY_PROMPT);
    if (!raw) { console.warn('[EnergyAI] All AI providers failed'); return null; }
    try {
      const parsed: EnergyPricesData = JSON.parse(cleanJSON(raw));
      if (!parsed.regions || parsed.regions.length === 0) return null;
      energyCache = { data: parsed, timestamp: Date.now() };
      console.log('[EnergyAI] Data received:', parsed.regions.length, 'regions');
      return parsed;
    } catch {
      console.warn('[EnergyAI] Failed to parse response');
      return null;
    }
  })();

  try {
    return await energyFetchInProgress;
  } finally {
    energyFetchInProgress = null;
  }
}

export async function getAIGoldData(): Promise<GoldData | null> {
  if (isCacheValid(goldCache)) return goldCache.data;
  if (goldFetchInProgress) return goldFetchInProgress;

  goldFetchInProgress = (async () => {
    console.log('[GoldAI] Fetching gold & precious metals data...');
    const raw = await callAI(GOLD_PROMPT);
    if (!raw) { console.warn('[GoldAI] All AI providers failed'); return null; }
    try {
      const parsed: GoldData = JSON.parse(cleanJSON(raw));
      if (!parsed.price || !parsed.trend) return null;
      goldCache = { data: parsed, timestamp: Date.now() };
      console.log('[GoldAI] Gold price: $' + parsed.price);
      return parsed;
    } catch {
      console.warn('[GoldAI] Failed to parse response');
      return null;
    }
  })();

  try {
    return await goldFetchInProgress;
  } finally {
    goldFetchInProgress = null;
  }
}
