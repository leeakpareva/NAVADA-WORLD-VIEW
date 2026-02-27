/**
 * UK Debt-to-GDP Panel — shows historical UK debt-to-GDP ratio as SVG line graph.
 * Data sourced via AI (ONS/OBR estimates).
 */

import { Panel } from './Panel';
import { getSecretValue } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface DebtGDPPoint {
  year: number;
  ratio: number;
}

interface DebtGDPData {
  current: number;
  trend: string;
  totalDebt: string;
  gdp: string;
  forecast2027: number;
  history: DebtGDPPoint[];
}

const CACHE_TTL = 60 * 60 * 1000; // 60 min
let cachedData: DebtGDPData | null = null;
let cacheTimestamp = 0;

export class UKDebtGDPPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'uk-debt-gdp', title: 'UK Debt/GDP', showCount: false });
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

    this.setContent('<div style="padding:16px;text-align:center;color:var(--text-dim);">Loading UK debt data...</div>');

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
            content: `Return UK government debt-to-GDP ratio data as JSON only (no markdown fences).
Include yearly data from 2000 to 2026. Format:
{"current":number,"trend":"rising|stable|falling","totalDebt":"string like £2.7T","gdp":"string like £2.3T","forecast2027":number,"history":[{"year":2000,"ratio":29.5},...]}`
          }],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error('AI failed');
      const json = await res.json();
      let text = json.choices?.[0]?.message?.content?.trim() ?? '';
      text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const data: DebtGDPData = JSON.parse(text);
      if (!data.history || data.history.length === 0) throw new Error('No history');
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } catch {
      this.renderFallback();
    }
  }

  private renderFallback(): void {
    const fallback: DebtGDPData = {
      current: 101.3,
      trend: 'rising',
      totalDebt: '£2.69T',
      gdp: '£2.27T',
      forecast2027: 104.2,
      history: [
        { year: 2000, ratio: 29.5 }, { year: 2002, ratio: 30.8 }, { year: 2004, ratio: 34.2 },
        { year: 2006, ratio: 35.5 }, { year: 2008, ratio: 43.7 }, { year: 2010, ratio: 64.5 },
        { year: 2012, ratio: 73.5 }, { year: 2014, ratio: 80.4 }, { year: 2016, ratio: 85.8 },
        { year: 2018, ratio: 84.4 }, { year: 2020, ratio: 100.6 }, { year: 2022, ratio: 97.4 },
        { year: 2024, ratio: 98.6 }, { year: 2026, ratio: 101.3 },
      ],
    };
    this.render(fallback);
  }

  private render(data: DebtGDPData): void {
    const chartHTML = this.buildLineChart(data.history);
    const trendClass = data.trend === 'rising' ? 'up' : 'down';
    const trendArrow = data.trend === 'rising' ? '&#9650;' : data.trend === 'falling' ? '&#9660;' : '&#9654;';

    this.setContent(`
      <div class="debt-gdp-panel">
        <div class="debt-gdp-current">
          <span class="debt-gdp-value">${data.current.toFixed(1)}%</span>
          <span class="debt-gdp-trend ${trendClass}">${trendArrow} ${escapeHtml(data.trend)}</span>
        </div>
        ${chartHTML}
        <div class="debt-gdp-stats">
          <div class="debt-gdp-stat"><span class="debt-gdp-stat-label">Total Debt</span><span class="debt-gdp-stat-val">${escapeHtml(data.totalDebt)}</span></div>
          <div class="debt-gdp-stat"><span class="debt-gdp-stat-label">GDP</span><span class="debt-gdp-stat-val">${escapeHtml(data.gdp)}</span></div>
          <div class="debt-gdp-stat"><span class="debt-gdp-stat-label">2027 Forecast</span><span class="debt-gdp-stat-val">${data.forecast2027.toFixed(1)}%</span></div>
          <div class="debt-gdp-stat"><span class="debt-gdp-stat-label">Peak</span><span class="debt-gdp-stat-val">${Math.max(...data.history.map(h => h.ratio)).toFixed(1)}%</span></div>
        </div>
        <div class="debt-gdp-source">ONS / OBR estimates via AI &bull; 60 min cache</div>
      </div>
    `);
  }

  private buildLineChart(history: DebtGDPPoint[]): string {
    if (!history || history.length < 2) return '';

    const W = 280;
    const H = 100;
    const padL = 32;
    const padR = 8;
    const padT = 8;
    const padB = 18;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const minY = Math.floor(Math.min(...history.map(h => h.ratio)) / 10) * 10;
    const maxY = Math.ceil(Math.max(...history.map(h => h.ratio)) / 10) * 10;
    const rangeY = maxY - minY || 1;

    const xScale = (i: number) => padL + (i / (history.length - 1)) * chartW;
    const yScale = (v: number) => padT + chartH - ((v - minY) / rangeY) * chartH;

    // Grid lines
    const gridLines: string[] = [];
    const gridLabels: string[] = [];
    for (let v = minY; v <= maxY; v += 20) {
      const y = yScale(v);
      gridLines.push(`<line class="chart-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" />`);
      gridLabels.push(`<text class="chart-label" x="${padL - 4}" y="${y + 3}" text-anchor="end">${v}%</text>`);
    }

    // X-axis labels (every 4th year or so)
    const xLabels: string[] = [];
    history.forEach((p, i) => {
      if (i === 0 || i === history.length - 1 || p.year % 5 === 0) {
        xLabels.push(`<text class="chart-label" x="${xScale(i)}" y="${H - 2}" text-anchor="middle">${p.year}</text>`);
      }
    });

    // Line path
    const linePoints = history.map((p, i) => `${xScale(i)},${yScale(p.ratio)}`).join(' ');

    // Area path
    const areaPath = `M${xScale(0)},${yScale(history[0]!.ratio)} ` +
      history.map((p, i) => `L${xScale(i)},${yScale(p.ratio)}`).join(' ') +
      ` L${xScale(history.length - 1)},${padT + chartH} L${xScale(0)},${padT + chartH} Z`;

    // Dots for key points
    const dots = history.map((p, i) =>
      `<circle class="chart-dot" cx="${xScale(i)}" cy="${yScale(p.ratio)}" r="2" />`
    ).join('');

    return `
      <div class="debt-gdp-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          ${gridLines.join('')}
          ${gridLabels.join('')}
          ${xLabels.join('')}
          <path class="chart-area" d="${areaPath}" />
          <polyline class="chart-line" points="${linePoints}" />
          ${dots}
        </svg>
      </div>`;
  }
}
