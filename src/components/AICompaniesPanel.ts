/**
 * AI Companies Panel — shows emerging AI companies globally.
 * Uses AI to fetch latest data about new/rising AI startups.
 * Auto-refreshes every 60 minutes.
 */

import { Panel } from './Panel';
import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';

interface AICompany {
  name: string;
  country: string;
  focus: string;
  funding: string;
  stage: string;
  founded: string;
  notable: string;
}

interface AICompaniesData {
  companies: AICompany[];
  totalAIStartups: string;
  totalFunding2024: string;
  topCountry: string;
  hottestSector: string;
}

const CACHE_TTL = 60 * 60 * 1000; // 60 min
let cachedData: AICompaniesData | null = null;
let cacheTimestamp = 0;

export class AICompaniesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'ai-companies', title: 'AI Companies Rising', showCount: false });
    void this.fetchData();
    this.refreshTimer = setInterval(() => this.fetchData(), 60 * 60 * 1000);
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  private async fetchData(): Promise<void> {
    if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
      this.render(cachedData);
      return;
    }

    this.showLoading('Scanning global AI landscape...');

    const prompt = `Return ONLY valid JSON (no markdown, no code fences) with the latest notable emerging AI companies globally. Include a mix from USA, Europe, Asia, and other regions. Structure:
{"companies":[{"name":"Mistral AI","country":"France","focus":"Foundation Models","funding":"$2B+","stage":"Series B","founded":"2023","notable":"Open-weight LLMs competing with GPT-4"},{"name":"Sakana AI","country":"Japan","focus":"Nature-inspired AI","funding":"$300M","stage":"Series A","founded":"2023","notable":"Founded by ex-Google Brain researchers"},{"name":"Cohere","country":"Canada","focus":"Enterprise LLMs","funding":"$970M","stage":"Series D","founded":"2019","notable":"Enterprise-focused NLP models"},{"name":"Stability AI","country":"UK","focus":"Generative Media","funding":"$260M","stage":"Series A","founded":"2019","notable":"Stable Diffusion, open source models"},{"name":"01.AI","country":"China","focus":"Foundation Models","funding":"$1B+","stage":"Series A","founded":"2023","notable":"Founded by AI pioneer Kai-Fu Lee"},{"name":"Poolside AI","country":"USA","focus":"Code Generation","funding":"$500M","stage":"Series A","founded":"2023","notable":"AI coding assistant backed by top VCs"},{"name":"xAI","country":"USA","focus":"Foundation Models","funding":"$6B","stage":"Series C","founded":"2023","notable":"Grok models by Elon Musk"},{"name":"Anthropic","country":"USA","focus":"AI Safety","funding":"$15B+","stage":"Series E","founded":"2021","notable":"Claude models, constitutional AI"},{"name":"Inflection AI","country":"USA","focus":"Personal AI","funding":"$1.5B","stage":"Series A","founded":"2022","notable":"Pi assistant, key talent moved to Microsoft"},{"name":"Aleph Alpha","country":"Germany","focus":"Sovereign AI","funding":"$500M+","stage":"Series B","founded":"2019","notable":"European AI sovereignty"}],"totalAIStartups":"35,000+","totalFunding2024":"$100B+","topCountry":"USA","hottestSector":"Foundation Models & Agents"}
Update ALL values to the latest available data as of ${new Date().toISOString().split('T')[0]}. Include 10-12 companies. Return ONLY JSON.`;

    const data = await this.callAI(prompt);
    if (data) {
      cachedData = data;
      cacheTimestamp = Date.now();
      this.render(data);
    } else {
      this.showError('Failed to load AI companies data');
    }
  }

  private async callAI(prompt: string): Promise<AICompaniesData | null> {
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

  private async fetchAI(url: string, key: string, model: string, prompt: string): Promise<AICompaniesData | null> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 2000, temperature: 0.3, messages: [{ role: 'user', content: prompt }] }),
        signal: abort.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      let raw = json.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      return JSON.parse(raw) as AICompaniesData;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  private render(d: AICompaniesData): void {
    const stageColor = (stage: string): string => {
      if (stage.includes('Seed')) return '#4caf50';
      if (stage.includes('A')) return '#2196f3';
      if (stage.includes('B')) return '#ff9800';
      if (stage.includes('C') || stage.includes('D') || stage.includes('E')) return '#e91e63';
      return '#9e9e9e';
    };

    this.setContent(`
      <div class="ai-companies-panel">
        <div class="ai-co-summary">
          <div class="ai-co-stat"><span class="ai-co-num">${escapeHtml(d.totalAIStartups)}</span><span class="ai-co-label">AI Startups</span></div>
          <div class="ai-co-stat"><span class="ai-co-num">${escapeHtml(d.totalFunding2024)}</span><span class="ai-co-label">Total Funding</span></div>
          <div class="ai-co-stat"><span class="ai-co-num">${escapeHtml(d.topCountry)}</span><span class="ai-co-label">Top Country</span></div>
          <div class="ai-co-stat"><span class="ai-co-num">${escapeHtml(d.hottestSector)}</span><span class="ai-co-label">Hottest Sector</span></div>
        </div>
        <div class="ai-co-list">
          ${d.companies.map(c => `
            <div class="ai-co-card">
              <div class="ai-co-card-header">
                <span class="ai-co-name">${escapeHtml(c.name)}</span>
                <span class="ai-co-badge" style="background:${stageColor(c.stage)}">${escapeHtml(c.stage)}</span>
              </div>
              <div class="ai-co-meta">
                <span class="ai-co-country">${escapeHtml(c.country)}</span>
                <span class="ai-co-dot">·</span>
                <span class="ai-co-focus">${escapeHtml(c.focus)}</span>
                <span class="ai-co-dot">·</span>
                <span class="ai-co-funding">${escapeHtml(c.funding)}</span>
              </div>
              <div class="ai-co-notable">${escapeHtml(c.notable)}</div>
            </div>
          `).join('')}
        </div>
        <div class="ai-co-source">Data: AI-generated intelligence · Updated ${new Date().toLocaleDateString()}</div>
      </div>
    `);
  }
}
