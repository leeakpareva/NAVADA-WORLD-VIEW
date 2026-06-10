/**
 * AI Market Share Panel — D3 donut chart showing global AI market share
 * by country/region with hover interactions and responsive sizing.
 */

import { Panel } from './Panel';
import * as d3 from 'd3';
import { replaceChildren } from '@/utils/dom-utils';

const RESIZE_DEBOUNCE_MS = 200;

interface MarketSegment {
  country: string;
  share: number;
  value: number;
  color: string;
}

const SEGMENT_COLORS = ['#4fc3f7', '#ef5350', '#66bb6a', '#78909c'] as const;
const DEFAULT_COLOR = '#78909c';

// Static baseline shown until the live AI-sourced figures arrive
const FALLBACK_MARKET_DATA: MarketSegment[] = [
  { country: 'United States', share: 45, value: 135, color: SEGMENT_COLORS[0] },
  { country: 'China', share: 22, value: 66, color: SEGMENT_COLORS[1] },
  { country: 'United Kingdom', share: 6, value: 18, color: SEGMENT_COLORS[2] },
  { country: 'Rest of World', share: 27, value: 81, color: SEGMENT_COLORS[3] },
];

const FALLBACK_TOTAL = 300; // $B, 2026 estimate

const REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

export class AIMarketSharePanel extends Panel {
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltip: HTMLDivElement | null = null;
  private marketData: MarketSegment[] = FALLBACK_MARKET_DATA;
  private totalMarket = FALLBACK_TOTAL;
  private sourceLabel = '2026 estimate • IDC / Stanford HAI';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'insights', title: 'AI Market Share' });
    this.setupResizeObserver();
    this.renderChart();
    void this.refreshData();
    this.refreshTimer = setInterval(() => void this.refreshData(), REFRESH_MS);
  }

  // Server-side proxy keeps the OpenAI key off the client
  private async refreshData(): Promise<void> {
    try {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 25000);
      const resp = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          temperature: 0.1,
          prompt: 'Return ONLY valid JSON (no markdown) with your best current estimate of the global AI market (software, services and AI infrastructure spending) split by country: {"totalBillionUSD": <number>, "segments": [{"country": "United States", "share": <percent>}, {"country": "China", "share": <percent>}, {"country": "United Kingdom", "share": <percent>}, {"country": "Rest of World", "share": <percent>}]}. Shares must sum to 100. Use the most recent credible analyst figures you know (IDC, Gartner, Stanford HAI).',
        }),
        signal: abort.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) return;
      const json = await resp.json();
      let raw: string = json.choices?.[0]?.message?.content?.trim() || '';
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      const data = JSON.parse(raw) as { totalBillionUSD: number; segments: { country: string; share: number }[] };
      if (!Array.isArray(data.segments) || data.segments.length !== 4 || !Number.isFinite(data.totalBillionUSD)) return;
      const sum = data.segments.reduce((s, x) => s + Number(x.share || 0), 0);
      if (sum < 95 || sum > 105) return;
      this.totalMarket = Math.round(data.totalBillionUSD);
      this.marketData = data.segments.map((s, i) => ({
        country: s.country,
        share: Math.round(s.share),
        value: Math.round((s.share / 100) * data.totalBillionUSD),
        color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? DEFAULT_COLOR,
      }));
      this.sourceLabel = `AI-sourced analyst estimate • updated ${new Date().toLocaleDateString('en-GB')}`;
      this.renderChart();
    } catch {
      // keep fallback data
    }
  }

  public destroy(): void {
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.resizeDebounceTimer) { clearTimeout(this.resizeDebounceTimer); this.resizeDebounceTimer = null; }
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.tooltip) { this.tooltip.remove(); this.tooltip = null; }
    super.destroy();
  }

  private renderChart(): void {
    replaceChildren(this.content);
    this.content.style.position = 'relative';

    const containerWidth = this.content.clientWidth || 280;
    if (containerWidth <= 0) return;

    this.createTooltip();

    // Chart container
    const chartDiv = document.createElement('div');
    Object.assign(chartDiv.style, {
      display: 'flex',
      justifyContent: 'center',
      padding: '12px 0 4px',
    });
    this.content.appendChild(chartDiv);

    const size = Math.min(containerWidth - 32, 220);
    const outerRadius = size / 2;
    const innerRadius = outerRadius * 0.55;

    const svg = d3.select(chartDiv)
      .append('svg')
      .attr('width', size)
      .attr('height', size)
      .style('display', 'block');

    const g = svg.append('g')
      .attr('transform', `translate(${size / 2},${size / 2})`);

    // Pie layout
    const pie = d3.pie<MarketSegment>()
      .value(d => d.share)
      .sort(null)
      .padAngle(0.02);

    const arc = d3.arc<d3.PieArcDatum<MarketSegment>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(3);

    const arcHover = d3.arc<d3.PieArcDatum<MarketSegment>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius + 6)
      .cornerRadius(3);

    const arcs = pie(this.marketData);
    const tooltip = this.tooltip;

    // Draw segments
    g.selectAll('path')
      .data(arcs)
      .join('path')
      .attr('d', arc)
      .attr('fill', d => d.data.color)
      .attr('stroke', 'var(--bg, #0a0a1a)')
      .attr('stroke-width', 2)
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .style('transition', 'opacity 0.15s')
      .on('mouseenter', function (_event: MouseEvent, d: d3.PieArcDatum<MarketSegment>) {
        d3.select(this)
          .attr('opacity', 1)
          .transition().duration(150)
          .attr('d', arcHover(d));
        if (tooltip) {
          tooltip.innerHTML = `<strong>${d.data.country}</strong><br>${d.data.share}% — $${d.data.value}B`;
          tooltip.style.display = 'block';
        }
      })
      .on('mousemove', (event: MouseEvent) => {
        if (tooltip) {
          const rect = chartDiv.getBoundingClientRect();
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top - 30}px`;
        }
      })
      .on('mouseleave', function (_event: MouseEvent, d: d3.PieArcDatum<MarketSegment>) {
        d3.select(this)
          .attr('opacity', 0.9)
          .transition().duration(150)
          .attr('d', arc(d));
        if (tooltip) tooltip.style.display = 'none';
      });

    // Center label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.3em')
      .attr('fill', 'var(--text, #eee)')
      .attr('font-size', '18px')
      .attr('font-weight', '700')
      .attr('font-family', 'monospace')
      .text(`$${this.totalMarket}B+`);

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.2em')
      .attr('fill', 'var(--text-dim, #888)')
      .attr('font-size', '10px')
      .text('Global AI Market');

    // Legend grid
    const legend = document.createElement('div');
    Object.assign(legend.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '6px',
      padding: '8px 16px 12px',
    });

    for (const segment of this.marketData) {
      const item = document.createElement('div');
      Object.assign(item.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
      });

      const dot = document.createElement('span');
      Object.assign(dot.style, {
        width: '10px',
        height: '10px',
        borderRadius: '3px',
        background: segment.color,
        display: 'inline-block',
        flexShrink: '0',
      });

      const label = document.createElement('span');
      Object.assign(label.style, {
        color: 'var(--text-dim, #aaa)',
      });
      label.textContent = `${segment.country} ${segment.share}%`;

      item.appendChild(dot);
      item.appendChild(label);
      legend.appendChild(item);
    }

    this.content.appendChild(legend);

    // Source label
    const source = document.createElement('div');
    Object.assign(source.style, {
      textAlign: 'center',
      fontSize: '9px',
      color: 'var(--text-dim)',
      padding: '0 0 6px',
    });
    source.textContent = this.sourceLabel;
    this.content.appendChild(source);

    // Re-add tooltip to end
    if (this.tooltip) this.content.appendChild(this.tooltip);

    this.setDataBadge('live');
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
      padding: '6px 10px',
      fontSize: '11px',
      color: 'var(--text, #eee)',
      zIndex: '9999',
      display: 'none',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      lineHeight: '1.4',
    });
    this.content.appendChild(this.tooltip);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(() => this.renderChart(), RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(this.content);
  }
}
