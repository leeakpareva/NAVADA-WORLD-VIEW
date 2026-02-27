/**
 * Bitcoin Price Panel — shows live BTC price with sparkline and key stats.
 * Uses CoinGecko first, falls back to AI.
 */

import { Panel } from './Panel';
import { getSecretValue } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface BTCData {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: string;
  marketCap: string;
  dominance: string;
  ath: number;
  sparkline: number[];
}

const CACHE_TTL = 5 * 60 * 1000; // 5 min
let cachedData: BTCData | null = null;
let cacheTimestamp = 0;

export class BitcoinPricePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'bitcoin-price', title: '₿ Bitcoin', showCount: false });
    void this.loadData();
    this.refreshTimer = setInterval(() => this.loadData(), 5 * 60 * 1000);
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

    this.setContent('<div style="padding:16px;text-align:center;color:var(--text-dim);">Loading BTC data...</div>');

    try {
      // Try CoinGecko first
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true',
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const d = await res.json();
        const data: BTCData = {
          price: d.market_data.current_price.usd,
          change24h: d.market_data.price_change_percentage_24h,
          high24h: d.market_data.high_24h.usd,
          low24h: d.market_data.low_24h.usd,
          volume24h: this.formatLargeNum(d.market_data.total_volume.usd),
          marketCap: this.formatLargeNum(d.market_data.market_cap.usd),
          dominance: (d.market_data.market_cap_percentage?.btc ?? 0).toFixed(1) + '%',
          ath: d.market_data.ath.usd,
          sparkline: (d.market_data.sparkline_7d?.price ?? []).slice(-24),
        };
        cachedData = data;
        cacheTimestamp = Date.now();
        this.render(data);
        return;
      }
    } catch { /* fallback to AI */ }

    await this.loadViaAI();
  }

  private async loadViaAI(): Promise<void> {
    const xaiKey = getSecretValue('XAI_API_KEY');
    const openaiKey = getSecretValue('OPENAI_API_KEY');
    const key = xaiKey || openaiKey;
    if (!key) {
      this.setContent('<div style="padding:16px;text-align:center;color:var(--text-dim);">No API key for BTC data</div>');
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
            content: `Return current Bitcoin data as JSON only, no markdown fences:
{"price":number,"change24h":number,"high24h":number,"low24h":number,"volume24h":"string","marketCap":"string","dominance":"string","ath":number,"sparkline":[24 hourly prices]}`
          }],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error('AI failed');
      const json = await res.json();
      let text = json.choices?.[0]?.message?.content?.trim() ?? '';
      text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const data: BTCData = JSON.parse(text);
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } catch {
      this.setContent('<div style="padding:16px;text-align:center;color:var(--text-dim);">Failed to load BTC data</div>');
    }
  }

  private render(data: BTCData): void {
    const isPositive = data.change24h >= 0;
    const changeClass = isPositive ? 'positive' : 'negative';
    const changeSign = isPositive ? '+' : '';

    let sparklineHTML = '';
    if (data.sparkline && data.sparkline.length > 1) {
      const min = Math.min(...data.sparkline);
      const max = Math.max(...data.sparkline);
      const range = max - min || 1;
      const w = 280;
      const h = 40;
      const points = data.sparkline.map((v, i) => {
        const x = (i / (data.sparkline.length - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${x},${y}`;
      }).join(' ');
      sparklineHTML = `
        <div class="btc-sparkline">
          <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
            <polyline points="${points}" />
          </svg>
        </div>`;
    }

    this.setContent(`
      <div class="bitcoin-panel">
        <div class="btc-price-section">
          <span class="btc-price-main">$${data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="btc-change ${changeClass}">${changeSign}${data.change24h.toFixed(2)}%</span>
        </div>
        ${sparklineHTML}
        <div class="btc-stats-grid">
          <div class="btc-stat"><span class="btc-stat-label">24h High</span><span class="btc-stat-val">$${data.high24h.toLocaleString()}</span></div>
          <div class="btc-stat"><span class="btc-stat-label">24h Low</span><span class="btc-stat-val">$${data.low24h.toLocaleString()}</span></div>
          <div class="btc-stat"><span class="btc-stat-label">Volume</span><span class="btc-stat-val">${escapeHtml(data.volume24h)}</span></div>
          <div class="btc-stat"><span class="btc-stat-label">Market Cap</span><span class="btc-stat-val">${escapeHtml(data.marketCap)}</span></div>
          <div class="btc-stat"><span class="btc-stat-label">Dominance</span><span class="btc-stat-val">${escapeHtml(data.dominance)}</span></div>
          <div class="btc-stat"><span class="btc-stat-label">ATH</span><span class="btc-stat-val">$${data.ath.toLocaleString()}</span></div>
        </div>
        <div class="btc-source">CoinGecko / AI estimate &bull; 5 min cache</div>
      </div>
    `);
  }

  private formatLargeNum(n: number): string {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return `$${n.toLocaleString()}`;
  }
}
