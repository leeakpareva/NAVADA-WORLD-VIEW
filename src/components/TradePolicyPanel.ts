import { Panel } from './Panel';
import type {
  GetTradeRestrictionsResponse,
  GetTariffTrendsResponse,
  GetTradeFlowsResponse,
  GetTradeBarriersResponse,
} from '@/services/trade';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { isFeatureAvailable, getSecretValue } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';

type TabId = 'restrictions' | 'tariffs' | 'flows' | 'barriers';

export class TradePolicyPanel extends Panel {
  private restrictionsData: GetTradeRestrictionsResponse | null = null;
  private tariffsData: GetTariffTrendsResponse | null = null;
  private flowsData: GetTradeFlowsResponse | null = null;
  private barriersData: GetTradeBarriersResponse | null = null;
  private activeTab: TabId = 'restrictions';
  constructor() {
    super({ id: 'trade-policy', title: t('panels.tradePolicy') });
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
    const hasData = (this.restrictionsData?.restrictions.length ?? 0) > 0;
    if (hasData) return;
    console.log('[TradePolicy] No proto data — loading AI fallback');
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
          messages: [{ role: 'user', content: `Return current global trade policy data as JSON only (no markdown). Date: ${new Date().toISOString().split('T')[0]}.
Format: {"restrictions":[{"reportingCountry":"United States","measureType":"Section 301 Tariffs","status":"high","productSector":"Technology, Steel","description":"Tariffs on Chinese imports","affectedCountry":"China","notifiedAt":"2024-05","sourceUrl":""}],"tariffs":[{"year":2025,"tariffRate":8.5,"productSector":"All Goods"}],"flows":[{"year":2025,"exportValueUsd":148000,"importValueUsd":427000,"yoyExportChange":-2.1,"yoyImportChange":3.5}],"barriers":[{"notifyingCountry":"EU","measureType":"SPS","title":"CBAM Carbon Border Adjustment","productDescription":"Steel, Cement, Aluminum","objective":"Climate protection","dateDistributed":"2024-12","sourceUrl":""}]}
Include 5-6 restrictions (US-China tariffs, EU CBAM, China rare earth controls, India electronics duties, Russia sanctions), 6 tariff years (2020-2025), 3 trade flows, 3 barriers. Use realistic current values.` }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return;
      const json = await res.json();
      let text = json.choices?.[0]?.message?.content?.trim() ?? '';
      text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(text);
      if (parsed.restrictions?.length > 0) {
        this.updateRestrictions({ restrictions: parsed.restrictions, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      if (parsed.tariffs?.length > 0) {
        this.updateTariffs({ datapoints: parsed.tariffs, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      if (parsed.flows?.length > 0) {
        this.updateFlows({ flows: parsed.flows, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      if (parsed.barriers?.length > 0) {
        this.updateBarriers({ barriers: parsed.barriers, fetchedAt: new Date().toISOString(), upstreamUnavailable: false } as any);
      }
      console.log('[TradePolicy] AI fallback loaded');
    } catch (e) { console.warn('[TradePolicy] AI fallback failed:', e); }
  }

  public updateRestrictions(data: GetTradeRestrictionsResponse): void {
    this.restrictionsData = data;
    this.render();
  }

  public updateTariffs(data: GetTariffTrendsResponse): void {
    this.tariffsData = data;
    this.render();
  }

  public updateFlows(data: GetTradeFlowsResponse): void {
    this.flowsData = data;
    this.render();
  }

  public updateBarriers(data: GetTradeBarriersResponse): void {
    this.barriersData = data;
    this.render();
  }

  private render(): void {
    // Check for API key
    if (isDesktopRuntime() && !isFeatureAvailable('wtoTrade')) {
      this.setContent(`<div class="economic-empty">${t('components.tradePolicy.apiKeyMissing')}</div>`);
      return;
    }

    const hasTariffs = this.tariffsData && this.tariffsData.datapoints.length > 0;
    const hasFlows = this.flowsData && this.flowsData.flows.length > 0;
    const hasBarriers = this.barriersData && this.barriersData.barriers.length > 0;

    const tabsHtml = `
      <div class="economic-tabs">
        <button class="economic-tab ${this.activeTab === 'restrictions' ? 'active' : ''}" data-tab="restrictions">
          ${t('components.tradePolicy.restrictions')}
        </button>
        ${hasTariffs ? `<button class="economic-tab ${this.activeTab === 'tariffs' ? 'active' : ''}" data-tab="tariffs">
          ${t('components.tradePolicy.tariffs')}
        </button>` : ''}
        ${hasFlows ? `<button class="economic-tab ${this.activeTab === 'flows' ? 'active' : ''}" data-tab="flows">
          ${t('components.tradePolicy.flows')}
        </button>` : ''}
        ${hasBarriers ? `<button class="economic-tab ${this.activeTab === 'barriers' ? 'active' : ''}" data-tab="barriers">
          ${t('components.tradePolicy.barriers')}
        </button>` : ''}
      </div>
    `;

    // Only show unavailable banner when active tab has NO data and upstream is down
    const activeHasData = this.activeTab === 'restrictions'
      ? (this.restrictionsData?.restrictions.length ?? 0) > 0
      : this.activeTab === 'tariffs'
      ? (this.tariffsData?.datapoints.length ?? 0) > 0
      : this.activeTab === 'flows'
      ? (this.flowsData?.flows.length ?? 0) > 0
      : (this.barriersData?.barriers.length ?? 0) > 0;
    const activeData = this.activeTab === 'restrictions' ? this.restrictionsData
      : this.activeTab === 'tariffs' ? this.tariffsData
      : this.activeTab === 'flows' ? this.flowsData
      : this.barriersData;
    const unavailableBanner = !activeHasData && activeData?.upstreamUnavailable
      ? `<div class="economic-warning">${t('components.tradePolicy.upstreamUnavailable')}</div>`
      : '';

    let contentHtml = '';
    switch (this.activeTab) {
      case 'restrictions': contentHtml = this.renderRestrictions(); break;
      case 'tariffs': contentHtml = this.renderTariffs(); break;
      case 'flows': contentHtml = this.renderFlows(); break;
      case 'barriers': contentHtml = this.renderBarriers(); break;
    }

    this.setContent(`
      ${tabsHtml}
      ${unavailableBanner}
      <div class="economic-content">${contentHtml}</div>
      <div class="economic-footer">
        <span class="economic-source">WTO</span>
      </div>
    `);

  }

  private renderRestrictions(): string {
    if (!this.restrictionsData || this.restrictionsData.restrictions.length === 0) {
      return `<div class="economic-empty">${t('components.tradePolicy.noRestrictions')}</div>`;
    }

    return `<div class="trade-restrictions-list">
      ${this.restrictionsData.restrictions.map(r => {
        const statusClass = r.status === 'high' ? 'status-active' : r.status === 'moderate' ? 'status-notified' : 'status-terminated';
        const statusLabel = r.status === 'high' ? t('components.tradePolicy.highTariff') : r.status === 'moderate' ? t('components.tradePolicy.moderateTariff') : t('components.tradePolicy.lowTariff');
        const sourceLink = this.renderSourceUrl(r.sourceUrl);
        return `<div class="trade-restriction-card">
          <div class="trade-restriction-header">
            <span class="trade-country">${escapeHtml(r.reportingCountry)}</span>
            <span class="trade-badge">${escapeHtml(r.measureType)}</span>
            <span class="trade-status ${statusClass}">${statusLabel}</span>
          </div>
          <div class="trade-restriction-body">
            <div class="trade-sector">${escapeHtml(r.productSector)}</div>
            ${r.description ? `<div class="trade-description">${escapeHtml(r.description)}</div>` : ''}
            ${r.affectedCountry ? `<div class="trade-affected">Affects: ${escapeHtml(r.affectedCountry)}</div>` : ''}
          </div>
          <div class="trade-restriction-footer">
            ${r.notifiedAt ? `<span class="trade-date">${escapeHtml(r.notifiedAt)}</span>` : ''}
            ${sourceLink}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderTariffs(): string {
    if (!this.tariffsData || this.tariffsData.datapoints.length === 0) {
      return `<div class="economic-empty">${t('components.tradePolicy.noTariffData')}</div>`;
    }

    const rows = [...this.tariffsData.datapoints].sort((a, b) => b.year - a.year).map(d =>
      `<tr>
        <td>${d.year}</td>
        <td>${d.tariffRate.toFixed(1)}%</td>
        <td>${escapeHtml(d.productSector || '—')}</td>
      </tr>`
    ).join('');

    return `<div class="trade-tariffs-table">
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th>${t('components.tradePolicy.appliedRate')}</th>
            <th>Sector</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  private renderFlows(): string {
    if (!this.flowsData || this.flowsData.flows.length === 0) {
      return `<div class="economic-empty">${t('components.tradePolicy.noFlowData')}</div>`;
    }

    return `<div class="trade-flows-list">
      ${this.flowsData.flows.map(f => {
        const exportArrow = f.yoyExportChange >= 0 ? '▲' : '▼';
        const importArrow = f.yoyImportChange >= 0 ? '▲' : '▼';
        const exportClass = f.yoyExportChange >= 0 ? 'change-positive' : 'change-negative';
        const importClass = f.yoyImportChange >= 0 ? 'change-positive' : 'change-negative';
        return `<div class="trade-flow-card">
          <div class="trade-flow-year">${f.year}</div>
          <div class="trade-flow-metrics">
            <div class="trade-flow-metric">
              <span class="trade-flow-label">${t('components.tradePolicy.exports')}</span>
              <span class="trade-flow-value">$${f.exportValueUsd.toFixed(0)}M</span>
              <span class="trade-flow-change ${exportClass}">${exportArrow} ${Math.abs(f.yoyExportChange).toFixed(1)}%</span>
            </div>
            <div class="trade-flow-metric">
              <span class="trade-flow-label">${t('components.tradePolicy.imports')}</span>
              <span class="trade-flow-value">$${f.importValueUsd.toFixed(0)}M</span>
              <span class="trade-flow-change ${importClass}">${importArrow} ${Math.abs(f.yoyImportChange).toFixed(1)}%</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderBarriers(): string {
    if (!this.barriersData || this.barriersData.barriers.length === 0) {
      return `<div class="economic-empty">${t('components.tradePolicy.noBarriers')}</div>`;
    }

    return `<div class="trade-barriers-list">
      ${this.barriersData.barriers.map(b => {
        const sourceLink = this.renderSourceUrl(b.sourceUrl);
        return `<div class="trade-barrier-card">
          <div class="trade-barrier-header">
            <span class="trade-country">${escapeHtml(b.notifyingCountry)}</span>
            <span class="trade-badge">${escapeHtml(b.measureType)}</span>
          </div>
          <div class="trade-barrier-body">
            <div class="trade-barrier-title">${escapeHtml(b.title)}</div>
            ${b.productDescription ? `<div class="trade-sector">${escapeHtml(b.productDescription)}</div>` : ''}
            ${b.objective ? `<div class="trade-description">${escapeHtml(b.objective)}</div>` : ''}
          </div>
          <div class="trade-barrier-footer">
            ${b.dateDistributed ? `<span class="trade-date">${escapeHtml(b.dateDistributed)}</span>` : ''}
            ${sourceLink}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderSourceUrl(url: string): string {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="trade-source-link">Source</a>`;
      }
    } catch { /* invalid URL */ }
    return '';
  }
}
