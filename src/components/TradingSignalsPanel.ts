/**
 * NAVADA Signals Panel
 * Signal cards for each tracked symbol + risk status footer.
 * Polls /api/trading/signals and /api/trading/status every 3 minutes.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface TradingSignal {
  symbol: string;
  action: string;
  confidence: number;
  reasoning: string;
  current_price: number;
  fast_ma: number;
  slow_ma: number;
  rsi: number;
}

interface StatusData {
  system_status: string;
  risk_controls: {
    max_positions: number;
    stop_loss_pct: number;
    take_profit_pct: number;
  };
  symbols: string[];
  strategy: string;
}

export class TradingSignalsPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'navada-signals', title: 'NAVADA Signals' });
    this.showLoading('Analysing signals...');
    this.loadData();
    this.timer = setInterval(() => this.loadData(), 180_000);
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
      const [sigRes, statusRes] = await Promise.all([
        fetch('/api/trading/signals', { signal: this.signal }),
        fetch('/api/trading/status', { signal: this.signal }),
      ]);

      if (!sigRes.ok || !statusRes.ok) throw new Error('API error');

      const sigData = await sigRes.json();
      const statusData: StatusData = await statusRes.json();

      this.render(sigData.signals || [], statusData);
      this.setDataBadge('live');
      this.flashUpdate();
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 3000));
        return this.loadData(retries - 1);
      }
      console.error('[TradingSignalsPanel] Failed:', err);
      this.showError('Trading API unavailable');
      this.setDataBadge('unavailable');
    }
  }

  private render(signals: TradingSignal[], status: StatusData): void {
    const signalsHtml = signals.length > 0
      ? signals.map(s => this.renderSignal(s)).join('')
      : '<div class="navada-empty">No signals available (market may be closed)</div>';

    const rc = status.risk_controls;
    const statusIcon = status.system_status === 'active' ? '&#10003;' : '&#10007;';
    const statusClass = status.system_status === 'active' ? 'navada-risk-active' : 'navada-risk-error';

    this.setContent(`
      <div class="navada-signals-content">
        <div class="navada-signals-list">${signalsHtml}</div>
        <div class="navada-risk-bar">
          <span class="navada-risk-item ${statusClass}">${statusIcon} ${escapeHtml(status.system_status?.toUpperCase() || 'UNKNOWN')}</span>
          <span class="navada-risk-sep">|</span>
          <span class="navada-risk-item">SL ${rc.stop_loss_pct}%</span>
          <span class="navada-risk-sep">|</span>
          <span class="navada-risk-item">TP ${rc.take_profit_pct}%</span>
          <span class="navada-risk-sep">|</span>
          <span class="navada-risk-item">${rc.max_positions} max pos</span>
        </div>
      </div>
    `);
  }

  private renderSignal(s: TradingSignal): string {
    const actionClass = s.action === 'BUY'
      ? 'navada-action-buy'
      : s.action === 'SELL'
        ? 'navada-action-sell'
        : 'navada-action-hold';

    const trend = this.getTrendLabel(s);
    const trendClass = this.getTrendClass(s);

    return `
      <div class="navada-signal-card">
        <div class="navada-signal-top">
          <span class="navada-signal-symbol">${escapeHtml(s.symbol)}</span>
          <span class="navada-signal-price">$${s.current_price.toFixed(2)}</span>
          <span class="navada-signal-action ${actionClass}">${escapeHtml(s.action)}</span>
          <span class="navada-signal-rsi">RSI ${s.rsi.toFixed(1)}</span>
        </div>
        <div class="navada-signal-bottom">
          <span class="navada-signal-ma">10MA $${s.fast_ma.toFixed(2)}</span>
          <span class="navada-signal-ma">30MA $${s.slow_ma.toFixed(2)}</span>
          <span class="navada-signal-trend ${trendClass}">${trend}</span>
        </div>
      </div>
    `;
  }

  private getTrendLabel(s: TradingSignal): string {
    if (s.rsi > 70) return 'Overbought';
    if (s.rsi < 30) return 'Oversold';
    return s.fast_ma > s.slow_ma ? 'Bullish' : 'Bearish';
  }

  private getTrendClass(s: TradingSignal): string {
    if (s.rsi > 70) return 'navada-trend-overbought';
    if (s.rsi < 30) return 'navada-trend-oversold';
    return s.fast_ma > s.slow_ma ? 'navada-trend-bullish' : 'navada-trend-bearish';
  }
}
