/**
 * Global Population Panel — real-time world population, birth rate, death rate.
 * Uses AI to fetch latest data, auto-refreshes every 30 minutes.
 * Shows a live population counter that ticks up based on net growth rate.
 */

import { Panel } from './Panel';
import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface PopulationData {
  worldPopulation: number;
  birthsPerSecond: number;
  deathsPerSecond: number;
  netGrowthPerSecond: number;
  birthRate: number;
  deathRate: number;
  infantMortality: number;
  lifeExpectancy: number;
  fertilitRate: number;
  medianAge: number;
  urbanPopPct: number;
  topCountries: Array<{ name: string; population: string; growth: string }>;
}

const CACHE_TTL = 30 * 60 * 1000;
let cachedData: PopulationData | null = null;
let cacheTimestamp = 0;

export class GlobalPopulationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private currentPop = 0;
  private growthPerSec = 0;

  constructor() {
    super({ id: 'global-population', title: 'Global Population', showCount: false });
    void this.fetchData();
    this.refreshTimer = setInterval(() => this.fetchData(), 30 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  private async fetchData(): Promise<void> {
    if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
      this.render(cachedData);
      return;
    }

    this.showLoading('Loading global population data...');

    const prompt = `Return ONLY valid JSON (no markdown, no code fences) with latest global population statistics. Structure:
{"worldPopulation":8200000000,"birthsPerSecond":4.3,"deathsPerSecond":1.8,"netGrowthPerSecond":2.5,"birthRate":17.8,"deathRate":7.7,"infantMortality":26.5,"lifeExpectancy":73.4,"fertilitRate":2.3,"medianAge":30.5,"urbanPopPct":57,"topCountries":[{"name":"India","population":"1.44B","growth":"+0.8%"},{"name":"China","population":"1.42B","growth":"-0.02%"},{"name":"USA","population":"340M","growth":"+0.5%"},{"name":"Indonesia","population":"279M","growth":"+0.8%"},{"name":"Pakistan","population":"240M","growth":"+1.8%"}]}
Update ALL values to your best estimate as of ${new Date().toISOString().split('T')[0]}. birthRate and deathRate are per 1000 people per year. Return ONLY JSON.`;

    const data = await this.callAI(prompt);
    if (data) {
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } else {
      this.showError('Failed to load population data');
    }
  }

  private async callAI(prompt: string): Promise<PopulationData | null> {
    if (isFeatureAvailable('aiXai')) {
      const key = getSecretValue('XAI_API_KEY');
      if (key) {
        const result = await this.fetchAI('https://api.x.ai/v1/chat/completions', key, 'grok-3-mini-fast', prompt);
        if (result) return result;
      }
    }
    const oaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
    if (oaiKey) return this.fetchAI('https://api.openai.com/v1/chat/completions', oaiKey, 'gpt-4o-mini', prompt);
    return null;
  }

  private async fetchAI(url: string, key: string, model: string, prompt: string): Promise<PopulationData | null> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 600, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
        signal: abort.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      let raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      return JSON.parse(raw) as PopulationData;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  private render(d: PopulationData): void {
    this.currentPop = d.worldPopulation;
    this.growthPerSec = d.netGrowthPerSecond;

    // Start live counter
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      this.currentPop += this.growthPerSec;
      const el = this.getElement().querySelector('.pop-counter');
      if (el) el.textContent = this.currentPop.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }, 1000);

    this.setContent(`
      <div class="global-pop-panel">
        <div class="pop-hero">
          <div class="pop-counter">${d.worldPopulation.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          <div class="pop-subtitle">Live World Population</div>
        </div>
        <div class="pop-rates">
          <div class="pop-rate-item pop-births">
            <span class="pop-rate-num">${d.birthsPerSecond.toFixed(1)}/s</span>
            <span class="pop-rate-label">Births</span>
            <span class="pop-rate-per1k">${d.birthRate}/1000/yr</span>
          </div>
          <div class="pop-rate-item pop-deaths">
            <span class="pop-rate-num">${d.deathsPerSecond.toFixed(1)}/s</span>
            <span class="pop-rate-label">Deaths</span>
            <span class="pop-rate-per1k">${d.deathRate}/1000/yr</span>
          </div>
          <div class="pop-rate-item pop-growth">
            <span class="pop-rate-num">+${d.netGrowthPerSecond.toFixed(1)}/s</span>
            <span class="pop-rate-label">Net Growth</span>
          </div>
        </div>
        <div class="pop-stats-grid">
          <div class="pop-stat"><span class="pop-stat-label">Life Expectancy</span><span class="pop-stat-val">${d.lifeExpectancy} yrs</span></div>
          <div class="pop-stat"><span class="pop-stat-label">Median Age</span><span class="pop-stat-val">${d.medianAge} yrs</span></div>
          <div class="pop-stat"><span class="pop-stat-label">Fertility Rate</span><span class="pop-stat-val">${d.fertilitRate}</span></div>
          <div class="pop-stat"><span class="pop-stat-label">Infant Mortality</span><span class="pop-stat-val">${d.infantMortality}/1K</span></div>
          <div class="pop-stat"><span class="pop-stat-label">Urban Pop</span><span class="pop-stat-val">${d.urbanPopPct}%</span></div>
        </div>
        <div class="pop-top-countries">
          <div class="pop-top-title">Top 5 by Population</div>
          ${d.topCountries.map((c, i) => `
            <div class="pop-country-row">
              <span class="pop-country-rank">${i + 1}</span>
              <span class="pop-country-name">${escapeHtml(c.name)}</span>
              <span class="pop-country-pop">${escapeHtml(c.population)}</span>
              <span class="pop-country-growth">${escapeHtml(c.growth)}</span>
            </div>
          `).join('')}
        </div>
        <div class="pop-source">Source: UN World Population (AI-estimated)</div>
      </div>
    `);
  }
}
