import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { PopulationExposure } from '@/types';
import { formatPopulation } from '@/services/population-exposure';
import { t } from '@/services/i18n';
import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';

interface AIExposureData {
  events: Array<{
    eventId: string;
    eventName: string;
    eventType: string;
    lat: number;
    lon: number;
    exposedPopulation: number;
    exposureRadiusKm: number;
  }>;
}

const AI_CACHE_TTL = 15 * 60 * 1000; // 15 min
let aiCache: PopulationExposure[] | null = null;
let aiCacheTimestamp = 0;

export class PopulationExposurePanel extends Panel {
  private exposures: PopulationExposure[] = [];

  constructor() {
    super({
      id: 'population-exposure',
      title: t('panels.populationExposure'),
      showCount: true,
      trackActivity: true,
      infoTooltip: t('components.populationExposure.infoTooltip'),
    });
    this.showLoading(t('common.calculatingExposure'));
  }

  public setExposures(exposures: PopulationExposure[]): void {
    this.exposures = exposures;
    if (exposures.length === 0) {
      // Try AI fallback when no real data
      void this.loadAIFallback();
      return;
    }
    this.setCount(exposures.length);
    this.renderContent();
  }

  private async loadAIFallback(): Promise<void> {
    // Use cache if still valid
    if (aiCache && Date.now() - aiCacheTimestamp < AI_CACHE_TTL) {
      this.exposures = aiCache;
      this.setCount(aiCache.length);
      this.renderContent();
      return;
    }

    this.showLoading('Estimating global population exposure...');

    const prompt = `Return ONLY valid JSON (no markdown, no code fences) listing 12-15 current global conflicts, natural disasters, or crises where civilian populations are exposed. Include active conflicts, recent earthquakes, floods, wildfires. Structure:
{"events":[{"eventId":"ukr-001","eventName":"Ukraine-Russia Conflict (Eastern Front)","eventType":"conflict","lat":48.5,"lon":37.5,"exposedPopulation":4200000,"exposureRadiusKm":150},{"eventId":"gaza-001","eventName":"Gaza Humanitarian Crisis","eventType":"conflict","lat":31.4,"lon":34.4,"exposedPopulation":2300000,"exposureRadiusKm":25},{"eventId":"sudan-001","eventName":"Sudan Civil War (Khartoum)","eventType":"conflict","lat":15.6,"lon":32.5,"exposedPopulation":5000000,"exposureRadiusKm":200}]}
Use your latest knowledge as of ${new Date().toISOString().split('T')[0]}. Include realistic population exposure estimates. Return ONLY JSON.`;

    const data = await this.callAI(prompt);
    if (data && data.events.length > 0) {
      aiCache = data.events;
      aiCacheTimestamp = Date.now();
      this.exposures = data.events;
      this.setCount(data.events.length);
      this.renderContent();
    } else {
      this.setContent(`<div class="panel-empty">${t('common.noDataAvailable')}</div>`);
    }
  }

  private async callAI(prompt: string): Promise<AIExposureData | null> {
    if (isFeatureAvailable('aiXai')) {
      const key = getSecretValue('XAI_API_KEY');
      if (key) {
        const result = await this.fetchAI('https://api.x.ai/v1/chat/completions', key, 'grok-3-mini-fast', prompt);
        if (result) return result;
      }
    }
    const oaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
    if (oaiKey) return this.fetchAI('https://api.openai.com/v1/chat/completions', oaiKey, 'gpt-4o-mini', prompt);
    return null;
  }

  private async fetchAI(url: string, key: string, model: string, prompt: string): Promise<AIExposureData | null> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 1500, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
        signal: abort.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      let raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      return JSON.parse(raw) as AIExposureData;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  private renderContent(): void {
    if (this.exposures.length === 0) {
      this.setContent(`<div class="panel-empty">${t('common.noDataAvailable')}</div>`);
      return;
    }

    const totalAffected = this.exposures.reduce((sum, e) => sum + e.exposedPopulation, 0);

    const cards = this.exposures.slice(0, 30).map(e => {
      const typeIcon = this.getTypeIcon(e.eventType);
      const popClass = e.exposedPopulation >= 1_000_000 ? ' popexp-pop-large' : '';
      return `<div class="popexp-card">
        <div class="popexp-card-name">${typeIcon} ${escapeHtml(e.eventName)}</div>
        <div class="popexp-card-meta">
          <span class="popexp-card-pop${popClass}">${t('components.populationExposure.affectedCount', { count: formatPopulation(e.exposedPopulation) })}</span>
          <span class="popexp-card-radius">${t('components.populationExposure.radiusKm', { km: String(e.exposureRadiusKm) })}</span>
        </div>
      </div>`;
    }).join('');

    this.setContent(`
      <div class="popexp-panel-content">
        <div class="popexp-summary">
          <span class="popexp-label">${t('components.populationExposure.totalAffected')}</span>
          <span class="popexp-total">${formatPopulation(totalAffected)}</span>
        </div>
        <div class="popexp-list">${cards}</div>
      </div>
    `);
  }

  private getTypeIcon(type: string): string {
    switch (type) {
      case 'state-based':
      case 'non-state':
      case 'one-sided':
      case 'conflict':
      case 'battle':
        return '\u2694\uFE0F';
      case 'earthquake':
        return '\uD83C\uDF0D';
      case 'flood':
        return '\uD83C\uDF0A';
      case 'fire':
      case 'wildfire':
        return '\uD83D\uDD25';
      default:
        return '\uD83D\uDCCD';
    }
  }
}
