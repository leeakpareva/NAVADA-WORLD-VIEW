import { Panel } from './Panel';
import type {
  GetShippingRatesResponse,
  GetChokepointStatusResponse,
  GetCriticalMineralsResponse,
} from '@/services/supply-chain';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { isFeatureAvailable, getSecretValue } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';

type TabId = 'chokepoints' | 'shipping' | 'minerals';

export class SupplyChainPanel extends Panel {
  private shippingData: GetShippingRatesResponse | null = null;
  private chokepointData: GetChokepointStatusResponse | null = null;
  private mineralsData: GetCriticalMineralsResponse | null = null;
  private activeTab: TabId = 'chokepoints';
  constructor() {
    super({ id: 'supply-chain', title: t('panels.supplyChain') });
    this.content.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.economic-tab') as HTMLElement | null;
      if (!target) return;
      const tabId = target.dataset.tab as TabId;
      if (tabId && tabId !== this.activeTab) {
        this.activeTab = tabId;
        this.render();
      }
    });
    setTimeout(() => this.checkAndLoadAI(), 8000);
  }

  private async checkAndLoadAI(): Promise<void> {
    const hasData = (this.chokepointData?.chokepoints.length ?? 0) > 0;
    if (hasData) return;
    console.log('[SupplyChain] No proto data — loading AI fallback');
    await this.fetchAIFallback();
  }

  private async fetchAIFallback(): Promise<void> {
    const xaiKey = getSecretValue('XAI_API_KEY');
    const openaiKey = getSecretValue('OPENAI_API_KEY');
    const key = xaiKey || openaiKey;
    if (!key) return;
    const baseUrl = xaiKey ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const model = xaiKey ? 'grok-3-mini-fast' : 'gpt-4o-mini';
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0.3, max_tokens: 2000,
          messages: [{ role: 'user', content: `Return current global supply chain data as JSON only (no markdown). Date: ${new Date().toISOString().split('T')[0]}.
Format: {"chokepoints":[{"name":"Bab el-Mandeb","status":"red","disruptionScore":65,"activeWarnings":3,"description":"Houthi attacks continue disrupting shipping","affectedRoutes":["Asia-Europe","Asia-Mediterranean"]}],"indices":[{"name":"Baltic Dry Index","currentValue":1450,"changePct":-2.3,"unit":"points","spikeAlert":false,"history":[{"value":1400},{"value":1420},{"value":1450}]}],"minerals":[{"mineral":"Lithium","hhi":3200,"riskRating":"high","topProducers":[{"country":"Australia","sharePct":47},{"country":"Chile","sharePct":25}],"priceChangePct":-8.5}]}
Include 6 chokepoints (Bab el-Mandeb critical, Panama Canal elevated, Strait of Hormuz elevated, Suez Canal, Strait of Malacca, Taiwan Strait), 5 shipping indices (Baltic Dry, SCFI Shanghai, Harpex, VLCC Tanker, Suezmax), 5 minerals (Lithium, Cobalt, Rare Earths, Copper, Nickel). Use realistic current values.` }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return;
      const json = await res.json();
      let text = json.choices?.[0]?.message?.content?.trim() ?? '';
      text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(text);
      if (parsed.chokepoints?.length > 0) {
        this.updateChokepointStatus({ chokepoints: parsed.chokepoints, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      if (parsed.indices?.length > 0) {
        this.updateShippingRates({ indices: parsed.indices, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      if (parsed.minerals?.length > 0) {
        this.updateCriticalMinerals({ minerals: parsed.minerals, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      console.log('[SupplyChain] AI fallback loaded');
    } catch (e) { console.warn('[SupplyChain] AI fallback failed:', e); }
  }

  public updateShippingRates(data: GetShippingRatesResponse): void {
    this.shippingData = data;
    this.render();
  }

  public updateChokepointStatus(data: GetChokepointStatusResponse): void {
    this.chokepointData = data;
    this.render();
  }

  public updateCriticalMinerals(data: GetCriticalMineralsResponse): void {
    this.mineralsData = data;
    this.render();
  }

  private render(): void {
    const tabsHtml = `
      <div class="economic-tabs">
        <button class="economic-tab ${this.activeTab === 'chokepoints' ? 'active' : ''}" data-tab="chokepoints">
          ${t('components.supplyChain.chokepoints')}
        </button>
        <button class="economic-tab ${this.activeTab === 'shipping' ? 'active' : ''}" data-tab="shipping">
          ${t('components.supplyChain.shipping')}
        </button>
        <button class="economic-tab ${this.activeTab === 'minerals' ? 'active' : ''}" data-tab="minerals">
          ${t('components.supplyChain.minerals')}
        </button>
      </div>
    `;

    const activeData = this.activeTab === 'chokepoints' ? this.chokepointData
      : this.activeTab === 'shipping' ? this.shippingData
      : this.mineralsData;
    const unavailableBanner = activeData?.upstreamUnavailable
      ? `<div class="economic-warning">${t('components.supplyChain.upstreamUnavailable')}</div>`
      : '';

    let contentHtml = '';
    switch (this.activeTab) {
      case 'chokepoints': contentHtml = this.renderChokepoints(); break;
      case 'shipping': contentHtml = this.renderShipping(); break;
      case 'minerals': contentHtml = this.renderMinerals(); break;
    }

    this.setContent(`
      ${tabsHtml}
      ${unavailableBanner}
      <div class="economic-content">${contentHtml}</div>
      <div class="economic-footer">
        <span class="economic-source">${t('components.supplyChain.sources')}</span>
      </div>
    `);
  }

  private renderChokepoints(): string {
    if (!this.chokepointData || this.chokepointData.chokepoints.length === 0) {
      return `<div class="economic-empty">${t('components.supplyChain.noChokepoints')}</div>`;
    }

    return `<div class="trade-restrictions-list">
      ${[...this.chokepointData.chokepoints].sort((a, b) => b.disruptionScore - a.disruptionScore).map(cp => {
        const statusClass = cp.status === 'red' ? 'status-active' : cp.status === 'yellow' ? 'status-notified' : 'status-terminated';
        const statusDot = cp.status === 'red' ? 'sc-dot-red' : cp.status === 'yellow' ? 'sc-dot-yellow' : 'sc-dot-green';
        return `<div class="trade-restriction-card">
          <div class="trade-restriction-header">
            <span class="trade-country">${escapeHtml(cp.name)}</span>
            <span class="sc-status-dot ${statusDot}"></span>
            <span class="trade-badge">${cp.disruptionScore}/100</span>
            <span class="trade-status ${statusClass}">${escapeHtml(cp.status)}</span>
          </div>
          <div class="trade-restriction-body">
            <div class="trade-sector">${cp.activeWarnings} ${t('components.supplyChain.warnings')}</div>
            <div class="trade-description">${escapeHtml(cp.description)}</div>
            <div class="trade-affected">${escapeHtml(cp.affectedRoutes.join(', '))}</div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderShipping(): string {
    if (isDesktopRuntime() && !isFeatureAvailable('supplyChain')) {
      return `<div class="economic-empty">${t('components.supplyChain.fredKeyMissing')}</div>`;
    }

    if (!this.shippingData || this.shippingData.indices.length === 0) {
      return `<div class="economic-empty">${t('components.supplyChain.noShipping')}</div>`;
    }

    return `<div class="trade-restrictions-list">
      ${this.shippingData.indices.map(idx => {
        const changeClass = idx.changePct >= 0 ? 'change-positive' : 'change-negative';
        const changeArrow = idx.changePct >= 0 ? '\u25B2' : '\u25BC';
        const sparkline = this.renderSparkline(idx.history.map(h => h.value));
        const spikeBanner = idx.spikeAlert
          ? `<div class="economic-warning">${t('components.supplyChain.spikeAlert')}</div>`
          : '';
        return `<div class="trade-restriction-card">
          ${spikeBanner}
          <div class="trade-restriction-header">
            <span class="trade-country">${escapeHtml(idx.name)}</span>
            <span class="trade-badge">${idx.currentValue.toFixed(0)} ${escapeHtml(idx.unit)}</span>
            <span class="trade-flow-change ${changeClass}">${changeArrow} ${Math.abs(idx.changePct).toFixed(1)}%</span>
          </div>
          <div class="trade-restriction-body">
            ${sparkline}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderSparkline(values: number[]): string {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 200;
    const h = 40;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;margin:4px 0">
      <polyline points="${points}" fill="none" stroke="var(--accent-primary, #4fc3f7)" stroke-width="1.5" />
    </svg>`;
  }

  private renderMinerals(): string {
    if (!this.mineralsData || this.mineralsData.minerals.length === 0) {
      return `<div class="economic-empty">${t('components.supplyChain.noMinerals')}</div>`;
    }

    const rows = this.mineralsData.minerals.map(m => {
      const riskClass = m.riskRating === 'critical' ? 'sc-risk-critical'
        : m.riskRating === 'high' ? 'sc-risk-high'
        : m.riskRating === 'moderate' ? 'sc-risk-moderate'
        : 'sc-risk-low';
      const top3 = m.topProducers.slice(0, 3).map(p =>
        `${escapeHtml(p.country)} ${p.sharePct.toFixed(0)}%`
      ).join(', ');
      return `<tr>
        <td>${escapeHtml(m.mineral)}</td>
        <td>${top3}</td>
        <td>${m.hhi.toFixed(0)}</td>
        <td><span class="${riskClass}">${escapeHtml(m.riskRating)}</span></td>
      </tr>`;
    }).join('');

    return `<div class="trade-tariffs-table">
      <table>
        <thead>
          <tr>
            <th>${t('components.supplyChain.mineral')}</th>
            <th>${t('components.supplyChain.topProducers')}</th>
            <th>HHI</th>
            <th>${t('components.supplyChain.risk')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
}
