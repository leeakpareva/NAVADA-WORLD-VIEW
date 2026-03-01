/**
 * Global GDP Panel — shows top countries by GDP with horizontal bar chart.
 * Data sourced via AI (IMF/World Bank estimates).
 */

import { Panel } from './Panel';
import { getSecretValue } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface CountryGDP {
  name: string;
  code: string;
  gdpBn: number;        // Nominal GDP in billions USD
  growthPct: number;     // Annual GDP growth %
}

interface GlobalGDPData {
  worldGdp: string;         // e.g. "$105.4T"
  avgGrowth: number;        // Global average growth %
  countries: CountryGDP[];
}

const CACHE_TTL = 60 * 60 * 1000; // 60 min
let cachedData: GlobalGDPData | null = null;
let cacheTimestamp = 0;

export class GlobalGDPPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'global-gdp', title: 'Global GDP', showCount: false });
    void this.loadData();
    this.refreshTimer = setInterval(() => this.loadData(), 60 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    super.destroy();
  }

  private async loadData(): Promise<void> {
    if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
      this.render(cachedData);
      return;
    }

    this.setContent('<div style="padding:16px;text-align:center;color:var(--text-dim);">Loading global GDP data...</div>');

    const xaiKey = getSecretValue('XAI_API_KEY');
    const openaiKey = getSecretValue('OPENAI_API_KEY');
    const key = xaiKey || openaiKey;
    if (!key) {
      this.renderFallback();
      return;
    }

    const baseUrl = xaiKey ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const model = xaiKey ? 'grok-3-mini-fast' : 'gpt-4o-mini';

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: `Return top 25 countries by nominal GDP in USD as JSON only (no markdown fences).
Include GDP in billions and latest annual growth rate. Use latest available IMF/World Bank data.
Format:
{"worldGdp":"$105.4T","avgGrowth":3.2,"countries":[{"name":"United States","code":"US","gdpBn":28780,"growthPct":2.8},...]}`
          }],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error('AI failed');
      const json = await res.json();
      let text = json.choices?.[0]?.message?.content?.trim() ?? '';
      text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const data: GlobalGDPData = JSON.parse(text);
      if (!data.countries || data.countries.length === 0) throw new Error('No countries');
      data.countries.sort((a, b) => b.gdpBn - a.gdpBn);
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } catch {
      this.renderFallback();
    }
  }

  private renderFallback(): void {
    const fallback: GlobalGDPData = {
      worldGdp: '$105.4T',
      avgGrowth: 3.2,
      countries: [
        { name: 'United States', code: 'US', gdpBn: 28780, growthPct: 2.8 },
        { name: 'China', code: 'CN', gdpBn: 18530, growthPct: 5.2 },
        { name: 'Germany', code: 'DE', gdpBn: 4590, growthPct: 0.3 },
        { name: 'Japan', code: 'JP', gdpBn: 4230, growthPct: 1.9 },
        { name: 'India', code: 'IN', gdpBn: 3940, growthPct: 7.8 },
        { name: 'United Kingdom', code: 'GB', gdpBn: 3500, growthPct: 0.4 },
        { name: 'France', code: 'FR', gdpBn: 3130, growthPct: 0.7 },
        { name: 'Italy', code: 'IT', gdpBn: 2330, growthPct: 0.7 },
        { name: 'Brazil', code: 'BR', gdpBn: 2170, growthPct: 2.9 },
        { name: 'Canada', code: 'CA', gdpBn: 2140, growthPct: 1.1 },
        { name: 'Russia', code: 'RU', gdpBn: 2020, growthPct: 3.6 },
        { name: 'South Korea', code: 'KR', gdpBn: 1710, growthPct: 2.6 },
        { name: 'Australia', code: 'AU', gdpBn: 1690, growthPct: 1.5 },
        { name: 'Mexico', code: 'MX', gdpBn: 1470, growthPct: 3.2 },
        { name: 'Spain', code: 'ES', gdpBn: 1580, growthPct: 2.5 },
        { name: 'Indonesia', code: 'ID', gdpBn: 1390, growthPct: 5.1 },
        { name: 'Netherlands', code: 'NL', gdpBn: 1090, growthPct: 0.1 },
        { name: 'Saudi Arabia', code: 'SA', gdpBn: 1070, growthPct: -0.8 },
        { name: 'Turkey', code: 'TR', gdpBn: 1020, growthPct: 4.5 },
        { name: 'Switzerland', code: 'CH', gdpBn: 910, growthPct: 0.8 },
        { name: 'Poland', code: 'PL', gdpBn: 810, growthPct: 0.2 },
        { name: 'Taiwan', code: 'TW', gdpBn: 790, growthPct: 1.3 },
        { name: 'Belgium', code: 'BE', gdpBn: 630, growthPct: 1.4 },
        { name: 'Sweden', code: 'SE', gdpBn: 590, growthPct: -0.1 },
        { name: 'Argentina', code: 'AR', gdpBn: 640, growthPct: -1.6 },
      ],
    };
    this.render(fallback);
  }

  private getGrowthColor(growth: number): string {
    if (growth >= 5) return 'var(--semantic-normal, #44ff88)';
    if (growth >= 2) return '#88cc44';
    if (growth >= 0) return 'var(--semantic-elevated, #ffaa44)';
    return 'var(--semantic-critical, #ff4444)';
  }

  private getBarColor(rank: number): string {
    if (rank <= 3) return '#3b82f6';
    if (rank <= 10) return '#6366f1';
    return '#8b5cf6';
  }

  private render(data: GlobalGDPData): void {
    const maxGdp = Math.max(...data.countries.map(c => c.gdpBn));
    const chartHTML = this.buildBarChart(data.countries, maxGdp);

    this.setContent(`
      <div class="global-gdp-panel">
        <div class="global-gdp-summary">
          <div class="global-gdp-stat">
            <span class="global-gdp-stat-val">${escapeHtml(data.worldGdp)}</span>
            <span class="global-gdp-stat-label">World GDP</span>
          </div>
          <div class="global-gdp-stat">
            <span class="global-gdp-stat-val">${data.avgGrowth >= 0 ? '+' : ''}${data.avgGrowth.toFixed(1)}%</span>
            <span class="global-gdp-stat-label">Global Growth</span>
          </div>
        </div>
        ${chartHTML}
        <div class="global-gdp-source">IMF / World Bank via AI &bull; 60 min cache</div>
      </div>
    `);
  }

  private buildBarChart(countries: CountryGDP[], maxGdp: number): string {
    const bars = countries.slice(0, 25).map((c, i) => {
      const widthPct = Math.max(2, (c.gdpBn / maxGdp) * 100);
      const barColor = this.getBarColor(i + 1);
      const growthColor = this.getGrowthColor(c.growthPct);
      const gdpLabel = c.gdpBn >= 1000 ? `$${(c.gdpBn / 1000).toFixed(1)}T` : `$${c.gdpBn}B`;
      const growthSign = c.growthPct >= 0 ? '+' : '';

      return `
        <div class="global-gdp-row">
          <span class="global-gdp-country">${escapeHtml(c.name)}</span>
          <div class="global-gdp-bar-wrap">
            <div class="global-gdp-bar" style="width:${widthPct}%;background:${barColor};"></div>
          </div>
          <span class="global-gdp-amount">${gdpLabel}</span>
          <span class="global-gdp-growth" style="color:${growthColor}">${growthSign}${c.growthPct.toFixed(1)}%</span>
        </div>`;
    }).join('');

    return `
      <div class="global-gdp-chart">
        <div class="global-gdp-header-row">
          <span class="global-gdp-col-label">Country</span>
          <span class="global-gdp-col-label" style="flex:1;"></span>
          <span class="global-gdp-col-label">GDP</span>
          <span class="global-gdp-col-label">Growth</span>
        </div>
        ${bars}
      </div>`;
  }
}
