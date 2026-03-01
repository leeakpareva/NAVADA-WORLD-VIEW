/**
 * NAVADA Positions Panel
 * Live positions table + recent trades.
 * Polls /api/trading/positions and /api/trading/trades every 2 minutes.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface Position {
  symbol: string;
  qty: number;
  entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  side: string;
}

interface Trade {
  timestamp: string;
  action: string;
  symbol: string;
  amount: number;
  reasoning: string;
}

export class TradingPositionsPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'navada-positions', title: 'NAVADA Positions', showCount: true });
    this.showLoading('Loading positions...');
    this.loadData();
    this.timer = setInterval(() => this.loadData(), 120_000);
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    super.destroy();
  }

  private async loadData(retries = 2): Promise<void> {
    try {
      const [posRes, tradeRes] = await Promise.all([
        fetch('/api/trading/positions', { signal: this.signal }),
        fetch('/api/trading/trades', { signal: this.signal }),
      ]);

      if (!posRes.ok || !tradeRes.ok) throw new Error('API error');

      const posData = await posRes.json();
      const tradeData = await tradeRes.json();

      this.setCount(posData.count || 0);
      this.render(posData.positions || [], posData.count || 0, posData.max_positions || 2, tradeData.trades || []);
      this.setDataBadge('live');
      this.flashUpdate();
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 3000));
        return this.loadData(retries - 1);
      }
      console.error('[TradingPositionsPanel] Failed:', err);
      this.showError('Trading API unavailable');
      this.setDataBadge('unavailable');
    }
  }

  private render(positions: Position[], count: number, maxPos: number, trades: Trade[]): void {
    const positionsHtml = positions.length > 0
      ? positions.map(p => this.renderPosition(p)).join('')
      : '<div class="navada-empty">No open positions</div>';

    const tradesHtml = trades.length > 0
      ? trades.slice(0, 5).map(t => this.renderTrade(t)).join('')
      : '<div class="navada-empty">No recent trades</div>';

    this.setContent(`
      <div class="navada-positions-content">
        <div class="navada-positions-header">
          <span class="navada-section-label">OPEN POSITIONS</span>
          <span class="navada-count-badge">${count}/${maxPos}</span>
        </div>
        <div class="navada-positions-list">${positionsHtml}</div>

        <div class="navada-divider"></div>

        <div class="navada-positions-header">
          <span class="navada-section-label">RECENT TRADES</span>
        </div>
        <div class="navada-trades-list">${tradesHtml}</div>
      </div>
    `);
  }

  private renderPosition(p: Position): string {
    const plClass = p.unrealized_pl >= 0 ? 'navada-positive' : 'navada-negative';
    const arrow = p.unrealized_pl >= 0 ? '&#9650;' : '&#9660;';
    const plSign = p.unrealized_pl >= 0 ? '+' : '';
    const pctSign = p.unrealized_plpc >= 0 ? '+' : '';

    return `
      <div class="navada-position-item">
        <div class="navada-position-top">
          <span class="navada-position-symbol">${escapeHtml(p.symbol)}</span>
          <span class="navada-position-qty">${p.qty} share${p.qty !== 1 ? 's' : ''}</span>
          <span class="navada-position-price">$${p.current_price.toFixed(2)}</span>
          <span class="navada-position-pl ${plClass}">${plSign}$${Math.abs(p.unrealized_pl).toFixed(2)} ${arrow}</span>
        </div>
        <div class="navada-position-bottom">
          <span class="navada-position-entry">entry $${p.entry_price.toFixed(2)}</span>
          <span class="navada-position-pct ${plClass}">${pctSign}${p.unrealized_plpc.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }

  private renderTrade(t: Trade): string {
    const badgeClass = t.action === 'BUY' ? 'navada-action-buy' : t.action === 'SELL' ? 'navada-action-sell' : '';
    const amtLabel = typeof t.amount === 'number' ? `$${t.amount.toFixed(2)}` : String(t.amount);
    const time = this.fmtTime(t.timestamp);
    const reason = t.reasoning ? escapeHtml(t.reasoning.slice(0, 60)) + (t.reasoning.length > 60 ? '...' : '') : '';

    return `
      <div class="navada-trade-item">
        <span class="navada-trade-badge ${badgeClass}">${escapeHtml(t.action)}</span>
        <span class="navada-trade-symbol">${escapeHtml(t.symbol)}</span>
        <span class="navada-trade-amt">${amtLabel}</span>
        <span class="navada-trade-reason">${reason}</span>
        <span class="navada-trade-time">${time}</span>
      </div>
    `;
  }

  private fmtTime(ts: string): string {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const hh = d.getHours();
      const mm = d.getMinutes().toString().padStart(2, '0');
      const ampm = hh >= 12 ? 'PM' : 'AM';
      return `${hh % 12 || 12}:${mm}${ampm.toLowerCase()}`;
    } catch {
      return '';
    }
  }
}
