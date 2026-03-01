/**
 * Global Energy Prices Panel — D3 grouped bar chart showing energy prices
 * (crude oil, natural gas, electricity, coal) across 6 continents.
 * Data powered by AI (xAI Grok / OpenAI).
 */

import { Panel } from './Panel';
import * as d3 from 'd3';
import { getAIEnergyPrices, type EnergyRegionData } from '@/services/energy-gold-ai-data';
import { replaceChildren } from '@/utils/dom-utils';

const CHART_MARGIN = { top: 12, right: 16, bottom: 50, left: 50 };
const CHART_HEIGHT = 180;
const RESIZE_DEBOUNCE_MS = 200;

const ENERGY_TYPES = ['crudeOil', 'naturalGas', 'electricity', 'coal'] as const;
const ENERGY_LABELS: Record<string, string> = {
  crudeOil: 'Crude Oil ($/bbl)',
  naturalGas: 'Nat Gas ($/MMBtu)',
  electricity: 'Electricity ($/MWh)',
  coal: 'Coal ($/ton)',
};
const REGION_COLORS: Record<string, string> = {
  'North America': '#4fc3f7',
  'Europe': '#81c784',
  'Middle East': '#ffb74d',
  'Asia-Pacific': '#e57373',
  'Africa': '#ba68c8',
  'Latin America': '#ffd54f',
};

export class EnergyPricesPanel extends Panel {
  private regions: EnergyRegionData[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltip: HTMLDivElement | null = null;

  constructor() {
    super({ id: 'energy-prices', title: 'Global Energy Prices' });
    this.setupResizeObserver();
    void this.loadData();
    this.refreshTimer = setInterval(() => this.loadData(), 10 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.resizeDebounceTimer) { clearTimeout(this.resizeDebounceTimer); this.resizeDebounceTimer = null; }
    if (this.tooltip) { this.tooltip.remove(); this.tooltip = null; }
    super.destroy();
  }

  private async loadData(): Promise<void> {
    if (this.regions.length === 0) {
      this.showLoading();
    }

    try {
      const data = await getAIEnergyPrices();
      if (data && data.regions.length > 0) {
        this.regions = data.regions;
        this.renderChart();
        this.setDataBadge('live', 'AI');
      } else {
        this.showError('No energy data available');
      }
    } catch {
      this.showError('Failed to load energy data');
    }
  }

  private renderChart(): void {
    replaceChildren(this.content);

    const containerWidth = this.content.clientWidth - 8;
    if (containerWidth <= 0) return;

    // Create tooltip
    this.createTooltip();

    // Legend
    const legend = document.createElement('div');
    Object.assign(legend.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      padding: '4px 8px',
      fontSize: '10px',
    });
    for (const region of this.regions) {
      const item = document.createElement('span');
      Object.assign(item.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      });
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        width: '8px',
        height: '8px',
        borderRadius: '2px',
        background: REGION_COLORS[region.region] || '#888',
        display: 'inline-block',
      });
      item.appendChild(dot);
      item.appendChild(document.createTextNode(region.region));
      legend.appendChild(item);
    }
    this.content.appendChild(legend);

    // Chart container
    const chartDiv = document.createElement('div');
    this.content.appendChild(chartDiv);

    const width = containerWidth - CHART_MARGIN.left - CHART_MARGIN.right;
    const height = CHART_HEIGHT;

    const svg = d3.select(chartDiv)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', height + CHART_MARGIN.top + CHART_MARGIN.bottom)
      .style('display', 'block');

    const g = svg.append('g')
      .attr('transform', `translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`);

    // Scales
    const x0 = d3.scaleBand()
      .domain(ENERGY_TYPES as unknown as string[])
      .range([0, width])
      .paddingInner(0.2)
      .paddingOuter(0.1);

    const regionNames = this.regions.map(r => r.region);
    const x1 = d3.scaleBand()
      .domain(regionNames)
      .range([0, x0.bandwidth()])
      .padding(0.05);

    // Find max value across all energy types for y-scale
    let maxVal = 0;
    for (const region of this.regions) {
      for (const type of ENERGY_TYPES) {
        if (region[type] > maxVal) maxVal = region[type];
      }
    }

    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    // X axis
    const xAxisG = g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickFormat(d => {
        const short: Record<string, string> = {
          crudeOil: 'Crude Oil',
          naturalGas: 'Nat Gas',
          electricity: 'Electricity',
          coal: 'Coal',
        };
        return short[d] || d;
      }));

    xAxisG.selectAll('text')
      .attr('fill', 'var(--text-dim)')
      .attr('font-size', '10px');
    xAxisG.selectAll('line').attr('stroke', 'var(--border-subtle)');
    xAxisG.select('.domain').attr('stroke', 'var(--border-subtle)');

    // Y axis
    const yAxisG = g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `$${d}`));

    yAxisG.selectAll('text')
      .attr('fill', 'var(--text-dim)')
      .attr('font-size', '9px');
    yAxisG.selectAll('line').attr('stroke', 'var(--border-subtle)');
    yAxisG.select('.domain').attr('stroke', 'var(--border-subtle)');

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', 'var(--border-subtle)')
      .attr('stroke-opacity', 0.3);
    g.select('.grid .domain').remove();

    // Bars
    const tooltip = this.tooltip;
    for (const energyType of ENERGY_TYPES) {
      const group = g.append('g')
        .attr('transform', `translate(${x0(energyType)},0)`);

      group.selectAll('rect')
        .data(this.regions)
        .join('rect')
        .attr('x', d => x1(d.region) || 0)
        .attr('y', d => y(d[energyType]))
        .attr('width', x1.bandwidth())
        .attr('height', d => height - y(d[energyType]))
        .attr('fill', d => REGION_COLORS[d.region] || '#888')
        .attr('rx', 1)
        .attr('opacity', 0.85)
        .on('mouseenter', function (_event: MouseEvent, d: EnergyRegionData) {
          d3.select(this).attr('opacity', 1);
          if (tooltip) {
            const unit = ENERGY_LABELS[energyType] || energyType;
            tooltip.textContent = `${d.region}: $${d[energyType]} — ${unit}`;
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
    }

    // Source label
    const source = document.createElement('div');
    Object.assign(source.style, {
      textAlign: 'center',
      fontSize: '9px',
      color: 'var(--text-dim)',
      padding: '4px 0',
    });
    source.textContent = 'AI estimate (xAI/OpenAI) \u2022 10 min cache';
    this.content.appendChild(source);

    // Re-add tooltip to end
    if (this.tooltip) this.content.appendChild(this.tooltip);
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
    this.content.style.position = 'relative';
    this.content.appendChild(this.tooltip);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.regions.length === 0) return;
      if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(() => this.renderChart(), RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(this.content);
  }
}
