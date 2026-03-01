import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface CareerDomain {
  id: string;
  name: string;
  icon: string;
  level: 'dominant' | 'strong' | 'established';
  score: number; // 0-100
  years: number;
  highlights: string[];
  tools: string[];
}

interface CareerMetric {
  label: string;
  value: string;
  icon: string;
}

export class StrategicPosturePanel extends Panel {
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'strategic-posture',
      title: 'AI Strategic Position',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'Lee Akpareva — Principal AI Consultant & Full-Stack Engineer. 17+ years across AI/ML, cloud architecture, full-stack development, and enterprise leadership.',
    });
    this.render();
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => {
      if (!this.element.classList.contains('hidden')) {
        this.render();
      }
    }, 60 * 60 * 1000); // refresh every hour (static data, just updates timestamp)
  }

  private getDomains(): CareerDomain[] {
    return [
      {
        id: 'ai-ml',
        name: 'AI / Machine Learning',
        icon: '🧠',
        level: 'dominant',
        score: 95,
        years: 5,
        highlights: [
          'AI Centre of Excellence at Generali UK',
          '6 Copilot agents deployed enterprise-wide',
          'QLoRA fine-tuning (Qwen, Llama)',
          'RAG pipelines — ChromaDB, Pinecone, LangChain',
          'YOLOv8 computer vision & medical AI',
        ],
        tools: ['PyTorch', 'HF Transformers', 'LangChain', 'Azure AI', 'OpenAI', 'CrewAI'],
      },
      {
        id: 'fullstack',
        name: 'Full-Stack Engineering',
        icon: '⚡',
        level: 'dominant',
        score: 92,
        years: 10,
        highlights: [
          '15+ production apps shipped',
          'NAVADA ecosystem — robotics, OSINT, ML lab',
          'ALEX autonomous agent (multi-modal)',
          'Raven Terminal — AI code learning platform',
          'WorldMonitor real-time intelligence dashboard',
        ],
        tools: ['TypeScript', 'React', 'Next.js', 'Node.js', 'Python', 'FastAPI', 'D3.js'],
      },
      {
        id: 'leadership',
        name: 'Leadership & Governance',
        icon: '🎯',
        level: 'strong',
        score: 88,
        years: 17,
        highlights: [
          'Hired by COO as sole AI architect at Generali',
          'Program Director — team of 27, £800K budget',
          '50+ staff upskilled in AI/ML workshops',
          'Enterprise governance frameworks & standards',
          'Cross-functional teams of 30+ at scale',
        ],
        tools: ['PRINCE2', 'Scrum', 'SAFe', 'ITIL', 'CISM', 'Azure DevOps'],
      },
      {
        id: 'cloud-infra',
        name: 'Cloud & Infrastructure',
        icon: '☁️',
        level: 'strong',
        score: 85,
        years: 8,
        highlights: [
          'Azure AI Foundry & AWS Solutions Architect',
          'Docker, Kubernetes, CI/CD pipelines',
          'Home server — Tailscale, PM2, auto-deploy',
          'PostgreSQL, Redis, DuckDB, ChromaDB',
          'Edge deployment — Raspberry Pi + MediaPipe',
        ],
        tools: ['Azure', 'AWS', 'GCP', 'Docker', 'Vercel', 'Tailscale', 'GitHub Actions'],
      },
      {
        id: 'commercial',
        name: 'Commercial & Strategy',
        icon: '📊',
        level: 'established',
        score: 82,
        years: 17,
        highlights: [
          'Farfetch — £2.3B GMV marketplace',
          'Programme budgets up to £5M',
          'DHL — blockchain supply chain',
          'Informa — food portfolio, £800K budget',
          'Insurance, finance, healthcare, aviation',
        ],
        tools: ['Blockchain', 'DeFi', 'Supply Chain', 'E-Commerce', 'InsurTech'],
      },
    ];
  }

  private getKeyMetrics(): CareerMetric[] {
    return [
      { label: 'Experience', value: '17+ yrs', icon: '📅' },
      { label: 'Apps Shipped', value: '15+', icon: '🚀' },
      { label: 'Team Size', value: '30+', icon: '👥' },
      { label: 'Certs', value: '20+', icon: '🏅' },
      { label: 'Staff Trained', value: '50+', icon: '🎓' },
      { label: 'Industries', value: '8+', icon: '🏢' },
    ];
  }

  private getLevelBadge(level: string): string {
    switch (level) {
      case 'dominant':
        return '<span class="posture-badge posture-critical">DOMINANT</span>';
      case 'strong':
        return '<span class="posture-badge posture-elevated">STRONG</span>';
      default:
        return '<span class="posture-badge posture-normal">ESTABLISHED</span>';
    }
  }

  private getScoreBar(score: number, level: string): string {
    const color = level === 'dominant' ? '#ef5350' : level === 'strong' ? '#ffa726' : '#66bb6a';
    return `
      <div class="sp-score-bar">
        <div class="sp-score-fill" style="width:${score}%;background:${color}"></div>
        <span class="sp-score-label">${score}%</span>
      </div>
    `;
  }

  private renderDomain(d: CareerDomain): string {
    const isTop = d.level === 'dominant';

    if (!isTop) {
      // Compact view for non-dominant domains
      return `
        <div class="posture-theater posture-compact" style="cursor:default">
          <span class="posture-name">${d.icon} ${escapeHtml(d.name)}</span>
          <div class="posture-chips">
            <span class="posture-chip air">${d.years}y</span>
          </div>
          ${this.getLevelBadge(d.level)}
        </div>
      `;
    }

    // Expanded view for dominant domains
    return `
      <div class="posture-theater posture-expanded ${d.level === 'dominant' ? 'critical' : 'elevated'}" style="cursor:default">
        <div class="posture-theater-header">
          <span class="posture-name">${d.icon} ${escapeHtml(d.name)}</span>
          ${this.getLevelBadge(d.level)}
        </div>
        ${this.getScoreBar(d.score, d.level)}
        <div class="posture-forces">
          <div class="posture-force-row">
            <span class="posture-domain">KEY</span>
            <div class="posture-stats">
              ${d.highlights.slice(0, 3).map(h => `<span class="posture-stat" title="${escapeHtml(h)}">▸ ${escapeHtml(h.length > 35 ? h.slice(0, 33) + '…' : h)}</span>`).join('')}
            </div>
          </div>
          <div class="posture-force-row">
            <span class="posture-domain">STACK</span>
            <div class="posture-stats">
              ${d.tools.map(t => `<span class="posture-chip air">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="posture-footer">
          <span class="posture-trend trend-up">↗ ${d.years}+ years</span>
        </div>
      </div>
    `;
  }

  private render(): void {
    const domains = this.getDomains();
    const metrics = this.getKeyMetrics();
    const now = new Date().toLocaleTimeString();

    const html = `
      <div class="posture-panel">
        <div class="sp-header-card">
          <div class="sp-identity">
            <div class="sp-name">Lee Akpareva</div>
            <div class="sp-role">Principal AI Consultant · Full-Stack Engineer</div>
            <div class="sp-org">Generali UK — Hired by COO · AI Centre of Excellence</div>
          </div>
          <div class="sp-overall-badge">
            <span class="posture-badge posture-critical" style="font-size:11px;padding:3px 10px">STRONG POSITION</span>
          </div>
        </div>

        <div class="sp-metrics-grid">
          ${metrics.map(m => `
            <div class="sp-metric">
              <span class="sp-metric-icon">${m.icon}</span>
              <span class="sp-metric-value">${m.value}</span>
              <span class="sp-metric-label">${m.label}</span>
            </div>
          `).join('')}
        </div>

        ${domains.map(d => this.renderDomain(d)).join('')}

        <div class="sp-certs-row">
          <span class="posture-domain">CERTS</span>
          <div class="posture-stats" style="flex-wrap:wrap;gap:3px">
            ${['Azure AI', 'AWS SA', 'IBM FS', 'PRINCE2', 'Scrum', 'SAFe', 'CISM', 'Blockchain'].map(c => `<span class="posture-chip air">${c}</span>`).join('')}
          </div>
        </div>

        <div class="sp-education-row">
          <span class="posture-domain">EDU</span>
          <div class="posture-stats" style="flex-wrap:wrap;gap:3px">
            ${['MBA', 'MSc PM', 'LLB Law', 'CSM Fashion'].map(e => `<span class="posture-chip naval">${e}</span>`).join('')}
          </div>
        </div>

        <div class="posture-footer">
          <span class="posture-updated">Updated ${now}</span>
        </div>
      </div>
    `;

    this.setContent(html);

    // Inject scoped styles
    this.injectStyles();
  }

  private injectStyles(): void {
    const styleId = 'sp-career-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .sp-header-card {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 8px 10px;
        margin-bottom: 6px;
        background: rgba(255,255,255,0.03);
        border-radius: 6px;
        border-left: 3px solid #ef5350;
      }
      .sp-identity { flex: 1; }
      .sp-name {
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        letter-spacing: 0.5px;
      }
      .sp-role {
        font-size: 11px;
        color: #90caf9;
        margin-top: 2px;
      }
      .sp-org {
        font-size: 10px;
        color: rgba(255,255,255,0.5);
        margin-top: 2px;
      }
      .sp-overall-badge {
        flex-shrink: 0;
        margin-left: 8px;
        margin-top: 2px;
      }
      .sp-metrics-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 4px;
        margin-bottom: 6px;
      }
      .sp-metric {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px 2px;
        background: rgba(255,255,255,0.03);
        border-radius: 4px;
      }
      .sp-metric-icon { font-size: 14px; }
      .sp-metric-value {
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        margin-top: 2px;
      }
      .sp-metric-label {
        font-size: 8px;
        color: rgba(255,255,255,0.5);
        text-transform: uppercase;
        letter-spacing: 0.3px;
        margin-top: 1px;
      }
      .sp-score-bar {
        height: 6px;
        background: rgba(255,255,255,0.08);
        border-radius: 3px;
        margin: 4px 0 6px;
        position: relative;
        overflow: hidden;
      }
      .sp-score-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.8s ease;
      }
      .sp-score-label {
        position: absolute;
        right: 4px;
        top: -1px;
        font-size: 8px;
        color: rgba(255,255,255,0.7);
        font-weight: 600;
      }
      .sp-certs-row, .sp-education-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        margin-top: 3px;
        background: rgba(255,255,255,0.02);
        border-radius: 4px;
      }
      .posture-stat {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 220px;
      }
      @media (max-width: 768px) {
        .sp-metrics-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Keep public API compatible for panel-layout.ts
  public setLocationClickHandler(_handler: (lat: number, lon: number) => void): void {
    // No-op — career panel doesn't have map interactions
  }

  public getPostures(): never[] {
    return [];
  }

  public updatePostures(_data?: unknown): void {
    // No-op — career data is static
  }

  public refresh(): void {
    this.render();
  }

  public override show(): void {
    const wasHidden = this.element.classList.contains('hidden');
    super.show();
    if (wasHidden) {
      this.render();
    }
  }

  public destroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    super.destroy();
  }
}
