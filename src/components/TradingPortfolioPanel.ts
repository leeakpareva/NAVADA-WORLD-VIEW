/**
 * NAVADA Portfolio Panel
 * Equity sparkline + KPI cards + strategy info.
 * Polls /api/trading/account, /api/trading/portfolio, /api/trading/status every 3 minutes.
 */

import { Panel } from './Panel';

interface AccountData {
  equity: number;
  cash: number;
  buying_power: number;
  starting_capital: number;
  total_return_pct: number;
  daily_pnl: number;
  updated_at: string;
  error?: string;
}

interface PortfolioData {
  metrics: {
    total_return_pct: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    total_trades: number;
    trading_days: number;
    starting_capital: number;
    current_equity: number;
  };
  equity_history: { date: string; equity: number }[];
}

interface StatusData {
  system_status: string;
  symbols: string[];
  strategy: string;
  risk_controls: { max_positions: number };
  schedule: { next_execution: string };
}

export class TradingPortfolioPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'navada-portfolio', title: 'NAVADA Portfolio' });
    this.showLoading('Connecting to trading API...');
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

  private async loadData(): Promise<void> {
    try {
      const [acctRes, portfolioRes, statusRes] = await Promise.all([
        fetch('/api/trading/account', { signal: this.signal }),
        fetch('/api/trading/portfolio', { signal: this.signal }),
        fetch('/api/trading/status', { signal: this.signal }),
      ]);

      if (!acctRes.ok || !portfolioRes.ok || !statusRes.ok) {
        throw new Error('API returned non-200');
      }

      const acct: AccountData = await acctRes.json();
      const portfolio: PortfolioData = await portfolioRes.json();
      const status: StatusData = await statusRes.json();

      if (acct.error) {
        this.showError('Trading account unavailable');
        this.setDataBadge('unavailable');
        return;
      }

      this.render(acct, portfolio, status);
      this.setDataBadge('live');
      this.flashUpdate();
    } catch (err) {
      if (this.isAbortError(err)) return;
      console.error('[TradingPortfolioPanel] Failed:', err);
      this.showError('Trading API unavailable');
      this.setDataBadge('unavailable');
    }
  }

  private render(acct: AccountData, portfolio: PortfolioData, status: StatusData): void {
    const returnPct = acct.total_return_pct;
    const returnClass = returnPct >= 0 ? 'navada-positive' : 'navada-negative';
    const returnSign = returnPct >= 0 ? '+' : '';
    const pnlClass = acct.daily_pnl >= 0 ? 'navada-positive' : 'navada-negative';
    const pnlSign = acct.daily_pnl >= 0 ? '+' : '';

    const sparkline = this.buildSparklineSVG(portfolio.equity_history);

    const metrics = portfolio.metrics;
    const nextExec = status.schedule?.next_execution || 'N/A';
    const nextLabel = this.formatScheduleTime(nextExec);

    this.setContent(`
      <div class="navada-portfolio-content">
        <div class="navada-hero-row">
          <div class="navada-hero-equity">
            <span class="navada-equity-value">$${this.fmtNum(acct.equity)}</span>
            <span class="navada-equity-label">EQUITY</span>
          </div>
          <div class="navada-hero-return">
            <span class="navada-return-badge ${returnClass}">${returnSign}${returnPct.toFixed(2)}%</span>
            <span class="navada-equity-label">TOTAL RETURN</span>
          </div>
          <div class="navada-hero-pnl">
            <span class="navada-pnl-value ${pnlClass}">${pnlSign}$${Math.abs(acct.daily_pnl).toFixed(2)}</span>
            <span class="navada-equity-label">DAILY P&amp;L</span>
          </div>
        </div>

        ${sparkline ? `<div class="navada-sparkline-wrap">${sparkline}</div>` : ''}

        <div class="navada-kpi-grid">
          <div class="navada-kpi-card">
            <span class="navada-kpi-value">$${this.fmtNum(acct.cash)}</span>
            <span class="navada-kpi-label">CASH</span>
          </div>
          <div class="navada-kpi-card">
            <span class="navada-kpi-value navada-negative">-${metrics.max_drawdown_pct.toFixed(1)}%</span>
            <span class="navada-kpi-label">MAX DRAWDOWN</span>
          </div>
          <div class="navada-kpi-card">
            <span class="navada-kpi-value">${metrics.sharpe_ratio.toFixed(2)}</span>
            <span class="navada-kpi-label">SHARPE RATIO</span>
          </div>
        </div>

        <div class="navada-footer-row">
          <span class="navada-footer-item">${status.strategy}</span>
          <span class="navada-footer-sep">|</span>
          <span class="navada-footer-item">${status.symbols?.length || 0} symbols</span>
          <span class="navada-footer-sep">|</span>
          <span class="navada-footer-item">Next: ${nextLabel}</span>
        </div>
      </div>
    `);
  }

  private buildSparklineSVG(history: { date: string; equity: number }[]): string {
    if (!history || history.length < 2) return '';
    const w = 280;
    const h = 40;
    const values = history.map(h => h.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const last = values[values.length - 1] ?? 0;
    const first = values[0] ?? 0;
    const color = last >= first ? '#4caf50' : '#f44336';

    return `<svg viewBox="0 0 ${w} ${h}" class="navada-sparkline-svg">
      <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }

  private fmtNum(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatScheduleTime(s: string): string {
    if (!s || s === 'N/A') return 'N/A';
    try {
      const d = new Date(s.replace(' ', 'T'));
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const hh = d.getHours();
      const mm = d.getMinutes().toString().padStart(2, '0');
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh % 12 || 12;
      return `${days[d.getDay()]} ${h12}:${mm} ${ampm}`;
    } catch {
      return s;
    }
  }
}
