/**
 * UK Unemployment Panel — fetches latest UK unemployment data via AI.
 * Auto-refreshes every 30 minutes with 10-minute cache.
 */

import { Panel } from './Panel';
import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface UKUnemploymentData {
  rate: number;
  change: number;
  totalUnemployed: string;
  youthRate: number;
  claimantCount: string;
  claimantChange: string;
  economicallyInactive: string;
  vacancies: string;
  avgEarnings: string;
  period: string;
}

const CACHE_TTL = 30 * 60 * 1000; // 30 min
let cachedData: UKUnemploymentData | null = null;
let cacheTimestamp = 0;

export class UKUnemploymentPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'uk-unemployment', title: 'UK Unemployment', showCount: false });
    void this.fetchData();
    this.refreshTimer = setInterval(() => this.fetchData(), 30 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  private async fetchData(): Promise<void> {
    if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
      this.render(cachedData);
      return;
    }

    this.showLoading('Loading UK employment data...');

    const prompt = `Return ONLY valid JSON (no markdown, no code fences) with the latest UK unemployment statistics. Use your most recent knowledge. Structure:
{"rate":4.3,"change":-0.1,"totalUnemployed":"1.5M","youthRate":12.1,"claimantCount":"1.6M","claimantChange":"+15,400","economicallyInactive":"21.6%","vacancies":"884K","avgEarnings":"+5.9%","period":"Dec 2025-Feb 2026"}
Update ALL values to the latest available ONS data. Return ONLY the JSON.`;

    const data = await this.callAI(prompt);
    if (data) {
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } else {
      this.showError('Failed to load UK unemployment data');
    }
  }

  private async callAI(prompt: string): Promise<UKUnemploymentData | null> {
    // Try xAI
    if (isFeatureAvailable('aiXai')) {
      const key = getSecretValue('XAI_API_KEY');
      if (key) {
        const result = await this.fetchAI('https://api.x.ai/v1/chat/completions', key, 'grok-3-mini-fast', prompt);
        if (result) return result;
      }
    }
    // Fallback OpenAI
    const oaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
    if (oaiKey) {
      return this.fetchAI('https://api.openai.com/v1/chat/completions', oaiKey, 'gpt-4o-mini', prompt);
    }
    return null;
  }

  private async fetchAI(url: string, key: string, model: string, prompt: string): Promise<UKUnemploymentData | null> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 500, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
        signal: abort.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      let raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      return JSON.parse(raw) as UKUnemploymentData;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  private render(d: UKUnemploymentData): void {
    const changeClass = d.change >= 0 ? 'stat-negative' : 'stat-positive';
    const changePrefix = d.change >= 0 ? '+' : '';
    this.setContent(`
      <div class="uk-unemployment-panel">
        <div class="uk-unemp-header">
          <div class="uk-unemp-rate">${d.rate}%</div>
          <div class="uk-unemp-change ${changeClass}">${changePrefix}${d.change}pp</div>
          <div class="uk-unemp-period">${escapeHtml(d.period)}</div>
        </div>
        <div class="uk-unemp-grid">
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Unemployed</span>
            <span class="uk-unemp-value">${escapeHtml(d.totalUnemployed)}</span>
          </div>
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Youth (16-24)</span>
            <span class="uk-unemp-value">${d.youthRate}%</span>
          </div>
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Claimants</span>
            <span class="uk-unemp-value">${escapeHtml(d.claimantCount)}</span>
          </div>
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Claimant Chg</span>
            <span class="uk-unemp-value">${escapeHtml(d.claimantChange)}</span>
          </div>
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Inactive</span>
            <span class="uk-unemp-value">${escapeHtml(d.economicallyInactive)}</span>
          </div>
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Vacancies</span>
            <span class="uk-unemp-value">${escapeHtml(d.vacancies)}</span>
          </div>
          <div class="uk-unemp-stat">
            <span class="uk-unemp-label">Avg Earnings</span>
            <span class="uk-unemp-value">${escapeHtml(d.avgEarnings)}</span>
          </div>
        </div>
        <div class="uk-unemp-source">Source: ONS Labour Market (AI-estimated)</div>
      </div>
    `);
  }
}
