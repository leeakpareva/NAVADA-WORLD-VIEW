/**
 * Global Debt Panel — shows top countries by government debt with horizontal bar chart.
 * Data sourced via AI (IMF/World Bank estimates).
 */

import { Panel } from './Panel';
import { getSecretValue } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface CountryDebt {
  name: string;
  code: string;
  debtBn: number;       // Total debt in billions USD
  debtToGdp: number;    // Debt-to-GDP ratio %
}

interface GlobalDebtData {
  totalWorldDebt: string;   // e.g. "$97.1T"
  avgDebtToGdp: number;
  countries: CountryDebt[];
}

const CACHE_TTL = 60 * 60 * 1000; // 60 min
let cachedData: GlobalDebtData | null = null;
let cacheTimestamp = 0;

export class GlobalDebtPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'global-debt', title: 'Global Debt', showCount: false });
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

    this.setContent('<div style="padding:16px;text-align:center;color:var(--text-dim);">Loading global debt data...</div>');

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
            content: `Return top 20 countries by government debt (national/sovereign debt) as JSON only (no markdown fences).
Include total debt in billions USD and debt-to-GDP ratio. Use latest available IMF/World Bank data.
Format:
{"totalWorldDebt":"$97.1T","avgDebtToGdp":92.5,"countries":[{"name":"United States","code":"US","debtBn":34000,"debtToGdp":123.4},...]}`
          }],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error('AI failed');
      const json = await res.json();
      let text = json.choices?.[0]?.message?.content?.trim() ?? '';
      text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const data: GlobalDebtData = JSON.parse(text);
      if (!data.countries || data.countries.length === 0) throw new Error('No countries');
      data.countries.sort((a, b) => b.debtBn - a.debtBn);
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } catch {
      this.renderFallback();
    }
  }

  private renderFallback(): void {
    const fallback: GlobalDebtData = {
      totalWorldDebt: '$97.1T',
      avgDebtToGdp: 92.5,
      countries: [
        { name: 'United States', code: 'US', debtBn: 34000, debtToGdp: 123.0 },
        { name: 'China', code: 'CN', debtBn: 14500, debtToGdp: 83.6 },
        { name: 'Japan', code: 'JP', debtBn: 12800, debtToGdp: 263.9 },
        { name: 'United Kingdom', code: 'GB', debtBn: 3400, debtToGdp: 101.3 },
        { name: 'France', code: 'FR', debtBn: 3300, debtToGdp: 111.8 },
        { name: 'Italy', code: 'IT', debtBn: 3100, debtToGdp: 144.4 },
        { name: 'Germany', code: 'DE', debtBn: 2900, debtToGdp: 66.3 },
        { name: 'India', code: 'IN', debtBn: 2800, debtToGdp: 83.1 },
        { name: 'Brazil', code: 'BR', debtBn: 1800, debtToGdp: 87.6 },
        { name: 'Canada', code: 'CA', debtBn: 1600, debtToGdp: 106.4 },
        { name: 'Spain', code: 'ES', debtBn: 1550, debtToGdp: 107.7 },
        { name: 'South Korea', code: 'KR', debtBn: 900, debtToGdp: 54.3 },
        { name: 'Australia', code: 'AU', debtBn: 750, debtToGdp: 52.7 },
        { name: 'Mexico', code: 'MX', debtBn: 700, debtToGdp: 53.8 },
        { name: 'Belgium', code: 'BE', debtBn: 650, debtToGdp: 105.2 },
        { name: 'Greece', code: 'GR', debtBn: 420, debtToGdp: 171.3 },
        { name: 'Netherlands', code: 'NL', debtBn: 500, debtToGdp: 50.1 },
        { name: 'Singapore', code: 'SG', debtBn: 650, debtToGdp: 167.8 },
        { name: 'Argentina', code: 'AR', debtBn: 400, debtToGdp: 89.5 },
        { name: 'Portugal', code: 'PT', debtBn: 310, debtToGdp: 112.4 },
      ],
    };
    this.render(fallback);
  }

  private getDebtColor(debtToGdp: number): string {
    if (debtToGdp >= 150) return 'var(--semantic-critical, #ff4444)';
    if (debtToGdp >= 100) return 'var(--semantic-high, #ff8844)';
    if (debtToGdp >= 60) return 'var(--semantic-elevated, #ffaa44)';
    return 'var(--semantic-normal, #44ff88)';
  }

  private render(data: GlobalDebtData): void {
    const maxDebt = Math.max(...data.countries.map(c => c.debtBn));
    const chartHTML = this.buildBarChart(data.countries, maxDebt);

    this.setContent(`
      <div class="global-debt-panel">
        <div class="global-debt-summary">
          <div class="global-debt-stat">
            <span class="global-debt-stat-val">${escapeHtml(data.totalWorldDebt)}</span>
            <span class="global-debt-stat-label">World Debt</span>
          </div>
          <div class="global-debt-stat">
            <span class="global-debt-stat-val">${data.avgDebtToGdp.toFixed(1)}%</span>
            <span class="global-debt-stat-label">Avg Debt/GDP</span>
          </div>
        </div>
        ${chartHTML}
        <div class="global-debt-source">IMF / World Bank via AI &bull; 60 min cache</div>
      </div>
    `);
  }

  private buildBarChart(countries: CountryDebt[], maxDebt: number): string {
    const bars = countries.slice(0, 20).map(c => {
      const widthPct = Math.max(2, (c.debtBn / maxDebt) * 100);
      const color = this.getDebtColor(c.debtToGdp);
      const debtLabel = c.debtBn >= 1000 ? `$${(c.debtBn / 1000).toFixed(1)}T` : `$${c.debtBn}B`;

      return `
        <div class="global-debt-row">
          <span class="global-debt-country">${escapeHtml(c.name)}</span>
          <div class="global-debt-bar-wrap">
            <div class="global-debt-bar" style="width:${widthPct}%;background:${color};"></div>
          </div>
          <span class="global-debt-amount">${debtLabel}</span>
          <span class="global-debt-ratio" style="color:${color}">${c.debtToGdp.toFixed(0)}%</span>
        </div>`;
    }).join('');

    return `
      <div class="global-debt-chart">
        <div class="global-debt-header-row">
          <span class="global-debt-col-label">Country</span>
          <span class="global-debt-col-label" style="flex:1;"></span>
          <span class="global-debt-col-label">Debt</span>
          <span class="global-debt-col-label">D/GDP</span>
        </div>
        ${bars}
      </div>`;
  }
}
