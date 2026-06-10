/**
 * AI IP & Patents Panel — D3 horizontal bar chart of AI patent activity
 * by major AI company, plus notable AI IP/copyright/licensing headlines.
 * Data fetched via the server-side AI proxy (/api/ai-chat).
 * Auto-refreshes every 30 minutes with 30-minute cache.
 */

import { Panel } from './Panel';
import * as d3 from 'd3';
import { replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';

interface AIIPCompany {
  name: string;
  patents2026: number;
  trend: 'up' | 'down' | 'flat';
}

interface AIIPHeadline {
  title: string;
  detail: string;
}

interface AIIPData {
  companies: AIIPCompany[];
  headlines: AIIPHeadline[];
}

const CACHE_TTL = 30 * 60 * 1000; // 30 min
let cachedData: AIIPData | null = null;
let cacheTimestamp = 0;

const CHART_MARGIN = { top: 8, right: 48, bottom: 24, left: 110 };
const BAR_BAND_HEIGHT = 26;
const RESIZE_DEBOUNCE_MS = 200;

const TREND_COLORS: Record<AIIPCompany['trend'], string> = {
  up: '#66bb6a',
  down: '#ef5350',
  flat: '#78909c',
};
const TREND_ARROWS: Record<AIIPCompany['trend'], string> = {
  up: '▲',
  down: '▼',
  flat: '▬',
};

const AI_IP_PROMPT = `Return ONLY valid JSON (no markdown, no code fences, no explanation) describing the latest known AI company patent/IP activity. Structure:
{"companies":[{"name":"OpenAI","patents2026":120,"trend":"up"}],"headlines":[{"title":"...","detail":"..."}]}
companies = 6-8 major AI companies (e.g. OpenAI, Google DeepMind, Microsoft, Nvidia, Anthropic, Meta, IBM, Baidu) with your best estimate of AI-related patent filings/grants this year and trend "up"|"down"|"flat" vs last year.
headlines = exactly 3 notable recent AI IP, copyright, patent or licensing news items, each with a short title and a one-sentence detail.
Update ALL values to your best current knowledge. Return ONLY the JSON object.`;

export class AIIPPanel extends Panel {
  private data: AIIPData | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltip: HTMLDivElement | null = null;

  constructor() {
    super({ id: 'ai-ip', title: 'AI IP & Patents' });
    this.setupResizeObserver();
    void this.loadData();
    this.refreshTimer = setInterval(() => this.loadData(), 30 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.resizeDebounceTimer) { clearTimeout(this.resizeDebounceTimer); this.resizeDebounceTimer = null; }
    if (this.tooltip) { this.tooltip.remove(); this.tooltip = null; }
    super.destroy();
  }

  private async loadData(): Promise<void> {
    if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
      this.data = cachedData;
      this.render();
      return;
    }

    if (!this.data) {
      this.showLoading('Loading AI IP data...');
    }

    const data = await this.fetchFromProxy();
    if (data && data.companies.length > 0) {
      cachedData = data;
      cacheTimestamp = Date.now();
      this.data = data;
      this.render();
      this.setDataBadge('live', 'AI');
    } else if (!this.data) {
      this.showError('AI IP data temporarily unavailable — retrying in 30 min');
    }
  }

  private async fetchFromProxy(): Promise<AIIPData | null> {
    // Server-side proxy keeps the OpenAI key off the client
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const resp = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 900,
          temperature: 0.3,
          messages: [{ role: 'user', content: AI_IP_PROMPT }],
        }),
        signal: abort.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      let raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw) as AIIPData;
      if (!Array.isArray(parsed.companies) || parsed.companies.length === 0) return null;
      if (!Array.isArray(parsed.headlines)) parsed.headlines = [];
      return parsed;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private render(): void {
    if (!this.data) return;
    replaceChildren(this.content);
    this.content.style.position = 'relative';

    const containerWidth = this.content.clientWidth - 8;
    if (containerWidth <= 0) return;

    this.createTooltip();
    this.renderChart(containerWidth);
    this.renderHeadlines();

    // Source label
    const source = document.createElement('div');
    Object.assign(source.style, {
      textAlign: 'center',
      fontSize: '9px',
      color: 'var(--text-dim)',
      padding: '4px 0 6px',
    });
    source.textContent = 'AI estimate • 30 min cache';
    this.content.appendChild(source);

    // Re-add tooltip to end
    if (this.tooltip) this.content.appendChild(this.tooltip);
  }

  private renderChart(containerWidth: number): void {
    if (!this.data) return;
    const companies = [...this.data.companies]
      .filter(c => Number.isFinite(c.patents2026))
      .sort((a, b) => b.patents2026 - a.patents2026)
      .slice(0, 8);
    if (companies.length === 0) return;

    const chartDiv = document.createElement('div');
    this.content.appendChild(chartDiv);

    const width = Math.max(containerWidth - CHART_MARGIN.left - CHART_MARGIN.right, 60);
    const height = companies.length * BAR_BAND_HEIGHT;

    const svg = d3.select(chartDiv)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', height + CHART_MARGIN.top + CHART_MARGIN.bottom)
      .style('display', 'block');

    const g = svg.append('g')
      .attr('transform', `translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`);

    // Scales
    const maxVal = d3.max(companies, c => c.patents2026) ?? 0;
    const x = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(companies.map(c => c.name))
      .range([0, height])
      .padding(0.25);

    // Y axis (company names)
    const yAxisG = g.append('g')
      .call(d3.axisLeft(y).tickSize(0));
    yAxisG.selectAll('text')
      .attr('fill', 'var(--text-dim)')
      .attr('font-size', '10px');
    yAxisG.select('.domain').attr('stroke', 'var(--border-subtle)');

    // X axis
    const xAxisG = g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d => `${d}`));
    xAxisG.selectAll('text')
      .attr('fill', 'var(--text-dim)')
      .attr('font-size', '9px');
    xAxisG.selectAll('line').attr('stroke', 'var(--border-subtle)');
    xAxisG.select('.domain').attr('stroke', 'var(--border-subtle)');

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(4).tickSize(-height).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', 'var(--border-subtle)')
      .attr('stroke-opacity', 0.3);
    g.select('.grid .domain').remove();

    // Bars
    const tooltip = this.tooltip;
    g.selectAll('rect.ai-ip-bar')
      .data(companies)
      .join('rect')
      .attr('class', 'ai-ip-bar')
      .attr('x', 0)
      .attr('y', d => y(d.name) || 0)
      .attr('width', d => Math.max(x(d.patents2026), 1))
      .attr('height', y.bandwidth())
      .attr('fill', d => TREND_COLORS[d.trend] || TREND_COLORS.flat)
      .attr('rx', 2)
      .attr('opacity', 0.85)
      .on('mouseenter', function (_event: MouseEvent, d: AIIPCompany) {
        d3.select(this).attr('opacity', 1);
        if (tooltip) {
          tooltip.textContent = `${d.name}: ~${d.patents2026} patents — trend ${d.trend}`;
          tooltip.style.display = 'block';
        }
      })
      .on('mousemove', (event: MouseEvent) => {
        if (tooltip) {
          const rect = chartDiv.getBoundingClientRect();
          tooltip.style.left = `${event.clientX - rect.left + 10}px`;
          tooltip.style.top = `${event.clientY - rect.top - 20}px`;
        }
      })
      .on('mouseleave', function () {
        d3.select(this).attr('opacity', 0.85);
        if (tooltip) tooltip.style.display = 'none';
      });

    // Value + trend labels at bar end
    g.selectAll('text.ai-ip-value')
      .data(companies)
      .join('text')
      .attr('class', 'ai-ip-value')
      .attr('x', d => x(d.patents2026) + 5)
      .attr('y', d => (y(d.name) || 0) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('fill', d => TREND_COLORS[d.trend] || TREND_COLORS.flat)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text(d => `${d.patents2026} ${TREND_ARROWS[d.trend] || ''}`);
  }

  private renderHeadlines(): void {
    if (!this.data || this.data.headlines.length === 0) return;

    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '6px 10px 4px',
      borderTop: '1px solid var(--border-subtle)',
    });

    for (const headline of this.data.headlines.slice(0, 3)) {
      const item = document.createElement('div');
      item.innerHTML = `
        <div style="font-size:11px;color:var(--text,#eee);font-weight:600;line-height:1.3;">${escapeHtml(headline.title)}</div>
        <div style="font-size:10px;color:var(--text-dim,#888);line-height:1.3;">${escapeHtml(headline.detail)}</div>
      `;
      list.appendChild(item);
    }

    this.content.appendChild(list);
  }

  private createTooltip(): void {
    if (this.tooltip) this.tooltip.remove();
    this.tooltip = document.createElement('div');
    Object.assign(this.tooltip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      background: 'var(--bg, #1a1a2e)',
      border: '1px solid var(--border, #333)',
      borderRadius: '6px',
      padding: '4px 8px',
      fontSize: '11px',
      color: 'var(--text, #eee)',
      zIndex: '9999',
      display: 'none',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    });
    this.content.appendChild(this.tooltip);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.data) return;
      if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(() => this.render(), RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(this.content);
  }
}
