/**
 * Gold Price Panel — shows live gold price with D3 sparkline trend
 * and secondary precious metals (Silver, Platinum, Palladium).
 * Data powered by AI (xAI Grok / OpenAI).
 */

import { Panel } from './Panel';
import * as d3 from 'd3';
import { getAIGoldData, type GoldData } from '@/services/energy-gold-ai-data';
import { replaceChildren } from '@/utils/dom-utils';

const SPARK_MARGIN = { top: 4, right: 8, bottom: 4, left: 8 };
const SPARK_HEIGHT = 50;
const RESIZE_DEBOUNCE_MS = 200;

export class GoldPricePanel extends Panel {
  private data: GoldData | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({ id: 'gold-price', title: 'Gold Price' });
    this.setupResizeObserver();
    void this.loadData();
    this.refreshTimer = setInterval(() => this.loadData(), 10 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.resizeDebounceTimer) { clearTimeout(this.resizeDebounceTimer); this.resizeDebounceTimer = null; }
    super.destroy();
  }

  private async loadData(): Promise<void> {
    if (!this.data) this.showLoading();

    try {
      const data = await getAIGoldData();
      if (data) {
        this.data = data;
        this.render();
        this.setDataBadge('live', 'AI');
      } else {
        this.showError('No gold data available');
      }
    } catch {
      this.showError('Failed to load gold data');
    }
  }

  private render(): void {
    if (!this.data) return;
    const d = this.data;

    replaceChildren(this.content);

    const isPositive = d.change24h >= 0;
    const changeSign = isPositive ? '+' : '';
    const changeColor = isPositive ? '#4caf50' : '#f44336';

    // Price header
    const priceSection = document.createElement('div');
    Object.assign(priceSection.style, {
      display: 'flex',
      alignItems: 'baseline',
      gap: '12px',
      padding: '8px 12px 4px',
    });

    const priceMain = document.createElement('span');
    Object.assign(priceMain.style, {
      fontSize: '24px',
      fontWeight: '700',
      color: '#ffd700',
      fontFamily: 'monospace',
    });
    priceMain.textContent = `$${d.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const unit = document.createElement('span');
    Object.assign(unit.style, { fontSize: '11px', color: 'var(--text-dim)' });
    unit.textContent = '/oz';

    const change = document.createElement('span');
    Object.assign(change.style, {
      fontSize: '14px',
      fontWeight: '600',
      color: changeColor,
    });
    change.textContent = `${changeSign}${d.change24h.toFixed(2)}%`;

    priceSection.appendChild(priceMain);
    priceSection.appendChild(unit);
    priceSection.appendChild(change);
    this.content.appendChild(priceSection);

    // D3 sparkline
    if (d.trend && d.trend.length > 1) {
      const chartDiv = document.createElement('div');
      Object.assign(chartDiv.style, { padding: '0 4px' });
      this.content.appendChild(chartDiv);
      this.renderSparkline(chartDiv, d.trend);
    }

    // Secondary metals grid
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '8px',
      padding: '8px 12px',
    });

    const metals = [
      { name: 'Silver', price: d.silver, change: d.silverChange, color: '#c0c0c0' },
      { name: 'Platinum', price: d.platinum, change: d.platinumChange, color: '#e5e4e2' },
      { name: 'Palladium', price: d.palladium, change: d.palladiumChange, color: '#cec8c8' },
    ];

    for (const metal of metals) {
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: 'var(--bg-elevated, rgba(255,255,255,0.05))',
        borderRadius: '6px',
        padding: '8px',
        textAlign: 'center',
      });

      const name = document.createElement('div');
      Object.assign(name.style, { fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px' });
      name.textContent = metal.name;

      const price = document.createElement('div');
      Object.assign(price.style, { fontSize: '14px', fontWeight: '600', color: metal.color, fontFamily: 'monospace' });
      price.textContent = `$${metal.price.toLocaleString()}`;

      const chg = document.createElement('div');
      const mPositive = metal.change >= 0;
      Object.assign(chg.style, {
        fontSize: '10px',
        color: mPositive ? '#4caf50' : '#f44336',
        marginTop: '2px',
      });
      chg.textContent = `${mPositive ? '+' : ''}${metal.change.toFixed(2)}%`;

      card.appendChild(name);
      card.appendChild(price);
      card.appendChild(chg);
      grid.appendChild(card);
    }

    this.content.appendChild(grid);

    // Source
    const source = document.createElement('div');
    Object.assign(source.style, {
      textAlign: 'center',
      fontSize: '9px',
      color: 'var(--text-dim)',
      padding: '2px 0 6px',
    });
    source.textContent = 'AI estimate (xAI/OpenAI) \u2022 10 min cache';
    this.content.appendChild(source);
  }

  private renderSparkline(container: HTMLElement, trend: number[]): void {
    const containerWidth = this.content.clientWidth - 16;
    if (containerWidth <= 0) return;

    const width = containerWidth - SPARK_MARGIN.left - SPARK_MARGIN.right;
    const height = SPARK_HEIGHT;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', height + SPARK_MARGIN.top + SPARK_MARGIN.bottom)
      .style('display', 'block');

    const g = svg.append('g')
      .attr('transform', `translate(${SPARK_MARGIN.left},${SPARK_MARGIN.top})`);

    const yExtent = d3.extent(trend) as [number, number];
    const yPadding = (yExtent[1] - yExtent[0]) * 0.15 || 10;

    const x = d3.scaleLinear()
      .domain([0, trend.length - 1])
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([height, 0]);

    // Gradient
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'gold-gradient')
      .attr('x1', '0').attr('y1', '0')
      .attr('x2', '0').attr('y2', '1');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#ffd700').attr('stop-opacity', 0.3);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#ffd700').attr('stop-opacity', 0.02);

    // Area
    const area = d3.area<number>()
      .x((_, i) => x(i))
      .y0(height)
      .y1(d => y(d))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(trend)
      .attr('d', area)
      .attr('fill', 'url(#gold-gradient)');

    // Line
    const line = d3.line<number>()
      .x((_, i) => x(i))
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(trend)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', '#ffd700')
      .attr('stroke-width', 2);

    // End dot
    const lastIdx = trend.length - 1;
    const lastVal = trend[lastIdx] ?? trend[0] ?? 0;
    g.append('circle')
      .attr('cx', x(lastIdx))
      .attr('cy', y(lastVal))
      .attr('r', 3)
      .attr('fill', '#ffd700')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);

    // 7-day label
    const label = document.createElement('div');
    Object.assign(label.style, {
      textAlign: 'center',
      fontSize: '9px',
      color: 'var(--text-dim)',
      marginTop: '2px',
    });
    label.textContent = '7-day trend';
    container.appendChild(label);
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
