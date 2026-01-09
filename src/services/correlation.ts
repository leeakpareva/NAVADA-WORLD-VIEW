import type { ClusteredEvent, PredictionMarket, MarketData } from '@/types';
import { getSourceType, type SourceType } from '@/config/feeds';

export type SignalType =
  | 'prediction_leads_news'
  | 'news_leads_markets'
  | 'silent_divergence'
  | 'velocity_spike'
  | 'convergence'
  | 'triangulation'
  | 'flow_drop'
  | 'flow_price_divergence';

export interface CorrelationSignal {
  id: string;
  type: SignalType;
  title: string;
  description: string;
  confidence: number;
  timestamp: Date;
  data: {
    newsVelocity?: number;
    marketChange?: number;
    predictionShift?: number;
    relatedTopics?: string[];
  };
}

interface StreamSnapshot {
  newsVelocity: Map<string, number>;
  marketChanges: Map<string, number>;
  predictionChanges: Map<string, number>;
  timestamp: number;
}

const PREDICTION_SHIFT_THRESHOLD = 5;
const MARKET_MOVE_THRESHOLD = 2;
const NEWS_VELOCITY_THRESHOLD = 3;
const FLOW_PRICE_THRESHOLD = 1.5;
const ENERGY_COMMODITY_SYMBOLS = new Set(['CL=F', 'NG=F']);

const PIPELINE_KEYWORDS = ['pipeline', 'pipelines', 'line', 'terminal'];
const FLOW_DROP_KEYWORDS = [
  'flow', 'throughput', 'capacity', 'outage', 'leak', 'rupture', 'shutdown',
  'maintenance', 'curtailment', 'force majeure', 'halt', 'halted', 'reduced',
  'reduction', 'drop', 'offline', 'suspend', 'suspended', 'stoppage',
];

let previousSnapshot: StreamSnapshot | null = null;
const signalHistory: CorrelationSignal[] = [];
const recentSignalKeys = new Set<string>();

function generateSignalId(): string {
  return `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateDedupeKey(type: SignalType, identifier: string, value: number): string {
  // Round value to avoid minor fluctuations creating new signals
  const roundedValue = Math.round(value * 10) / 10;
  return `${type}:${identifier}:${roundedValue}`;
}

function isRecentDuplicate(key: string): boolean {
  return recentSignalKeys.has(key);
}

function markSignalSeen(key: string): void {
  recentSignalKeys.add(key);
  // Clean old keys after 30 minutes
  setTimeout(() => recentSignalKeys.delete(key), 30 * 60 * 1000);
}

function extractTopics(events: ClusteredEvent[]): Map<string, number> {
  const topics = new Map<string, number>();

  const keywords = [
    'iran', 'israel', 'ukraine', 'russia', 'china', 'taiwan', 'oil', 'crypto',
    'fed', 'interest', 'inflation', 'recession', 'war', 'sanctions', 'tariff',
    'ai', 'tech', 'layoff', 'trump', 'biden', 'election',
  ];

  for (const event of events) {
    const title = event.primaryTitle.toLowerCase();
    for (const kw of keywords) {
      if (title.includes(kw)) {
        const velocity = event.velocity?.sourcesPerHour ?? 0;
        topics.set(kw, (topics.get(kw) ?? 0) + velocity + event.sourceCount);
      }
    }
  }

  return topics;
}

function findRelatedTopics(prediction: string): string[] {
  const title = prediction.toLowerCase();
  const related: string[] = [];

  const mappings: Record<string, string[]> = {
    'iran': ['iran', 'israel', 'oil', 'sanctions'],
    'israel': ['israel', 'iran', 'war', 'gaza'],
    'ukraine': ['ukraine', 'russia', 'war', 'nato'],
    'russia': ['russia', 'ukraine', 'sanctions'],
    'china': ['china', 'taiwan', 'tariff', 'trade'],
    'taiwan': ['taiwan', 'china'],
    'trump': ['trump', 'election', 'tariff'],
    'fed': ['fed', 'interest', 'inflation', 'recession'],
    'bitcoin': ['crypto', 'bitcoin'],
    'recession': ['recession', 'fed', 'inflation'],
  };

  for (const [key, topics] of Object.entries(mappings)) {
    if (title.includes(key)) {
      related.push(...topics);
    }
  }

  return [...new Set(related)];
}

function includesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword));
}

function detectPipelineFlowDrops(events: ClusteredEvent[]): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];

  for (const event of events) {
    const titles = [
      event.primaryTitle,
      ...(event.allItems?.map(item => item.title) ?? []),
    ]
      .map(title => title.toLowerCase())
      .filter(Boolean);

    const hasPipeline = titles.some(title => includesKeyword(title, PIPELINE_KEYWORDS));
    const hasFlowDrop = titles.some(title => includesKeyword(title, FLOW_DROP_KEYWORDS));

    if (hasPipeline && hasFlowDrop) {
      const dedupeKey = generateDedupeKey('flow_drop', event.id, event.sourceCount);
      if (!isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'flow_drop',
          title: 'Pipeline Flow Drop',
          description: `"${event.primaryTitle.slice(0, 70)}..." indicates reduced flow or disruption`,
          confidence: Math.min(0.9, 0.4 + event.sourceCount / 10),
          timestamp: new Date(),
          data: {
            newsVelocity: event.sourceCount,
            relatedTopics: ['pipeline', 'flow'],
          },
        });
      }
    }
  }

  return signals;
}

// Convergence: Multiple diverse source types reporting same topic in short window
function detectConvergence(events: ClusteredEvent[]): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const WINDOW_MS = 60 * 60 * 1000; // 60 min window (relaxed from 30m)
  const now = Date.now();

  console.log(`[Convergence] Analyzing ${events.length} clusters`);

  let clustersWithItems = 0;
  let clustersWithEnoughItems = 0;

  for (const event of events) {
    if (event.allItems) clustersWithItems++;
    if (!event.allItems || event.allItems.length < 3) continue;
    clustersWithEnoughItems++;

    // Only consider recent events
    const recentItems = event.allItems.filter(
      item => now - item.pubDate.getTime() < WINDOW_MS
    );
    if (recentItems.length < 3) continue;

    // Count unique source types
    const sourceTypes = new Set<SourceType>();
    for (const item of recentItems) {
      const type = getSourceType(item.source);
      sourceTypes.add(type);
    }

    // Log clusters with multiple source types for debugging
    if (sourceTypes.size >= 2) {
      const types = Array.from(sourceTypes);
      console.log(`[Convergence] Cluster "${event.primaryTitle.slice(0, 40)}..." has ${sourceTypes.size} types: ${types.join(', ')}`);
    }

    // Convergence = 3+ different source types on same story
    if (sourceTypes.size >= 3) {
      const types = Array.from(sourceTypes).filter(t => t !== 'other');
      const dedupeKey = generateDedupeKey('convergence', event.id, sourceTypes.size);

      if (!isRecentDuplicate(dedupeKey) && types.length >= 3) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'convergence',
          title: 'Source Convergence',
          description: `"${event.primaryTitle.slice(0, 50)}..." reported by ${types.join(', ')} (${recentItems.length} sources in 30m)`,
          confidence: Math.min(0.95, 0.6 + sourceTypes.size * 0.1),
          timestamp: new Date(),
          data: {
            newsVelocity: recentItems.length,
            relatedTopics: types,
          },
        });
      }
    }
  }

  return signals;
}

// Triangulation: Wire + Gov + Intel sources align on same topic
function detectTriangulation(events: ClusteredEvent[]): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const CRITICAL_TYPES: SourceType[] = ['wire', 'gov', 'intel'];

  for (const event of events) {
    if (!event.allItems || event.allItems.length < 3) continue;

    const typePresent = new Set<SourceType>();
    for (const item of event.allItems) {
      const t = getSourceType(item.source);
      if (CRITICAL_TYPES.includes(t)) {
        typePresent.add(t);
      }
    }

    // All 3 critical types present = triangulation
    if (typePresent.size === 3) {
      const dedupeKey = generateDedupeKey('triangulation', event.id, 3);

      if (!isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'triangulation',
          title: 'Intel Triangulation',
          description: `Wire + Gov + Intel aligned: "${event.primaryTitle.slice(0, 45)}..."`,
          confidence: 0.9,
          timestamp: new Date(),
          data: {
            newsVelocity: event.sourceCount,
            relatedTopics: Array.from(typePresent),
          },
        });
      }
    }
  }

  return signals;
}

export function analyzeCorrelations(
  events: ClusteredEvent[],
  predictions: PredictionMarket[],
  markets: MarketData[]
): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const now = Date.now();

  const newsTopics = extractTopics(events);
  const pipelineFlowSignals = detectPipelineFlowDrops(events);
  const pipelineFlowMentions = pipelineFlowSignals.length;

  const currentSnapshot: StreamSnapshot = {
    newsVelocity: newsTopics,
    marketChanges: new Map(markets.map(m => [m.symbol, m.change ?? 0])),
    predictionChanges: new Map(predictions.map(p => [p.title.slice(0, 50), p.yesPrice])),
    timestamp: now,
  };

  if (!previousSnapshot) {
    previousSnapshot = currentSnapshot;
    return signals;
  }

  // Detect prediction shifts
  for (const pred of predictions) {
    const key = pred.title.slice(0, 50);
    const prev = previousSnapshot.predictionChanges.get(key);
    if (prev !== undefined) {
      const shift = Math.abs(pred.yesPrice - prev);
      if (shift >= PREDICTION_SHIFT_THRESHOLD) {
        const related = findRelatedTopics(pred.title);
        const newsActivity = related.reduce((sum, t) => sum + (newsTopics.get(t) ?? 0), 0);

        const dedupeKey = generateDedupeKey('prediction_leads_news', key, shift);
        if (newsActivity < NEWS_VELOCITY_THRESHOLD && !isRecentDuplicate(dedupeKey)) {
          markSignalSeen(dedupeKey);
          signals.push({
            id: generateSignalId(),
            type: 'prediction_leads_news',
            title: 'Prediction Market Shift',
            description: `"${pred.title.slice(0, 60)}..." moved ${shift > 0 ? '+' : ''}${shift.toFixed(1)}% with low news coverage`,
            confidence: Math.min(0.9, 0.5 + shift / 20),
            timestamp: new Date(),
            data: {
              predictionShift: shift,
              newsVelocity: newsActivity,
              relatedTopics: related,
            },
          });
        }
      }
    }
  }

  // Detect news velocity spikes without market reaction
  for (const [topic, velocity] of newsTopics) {
    const prevVelocity = previousSnapshot.newsVelocity.get(topic) ?? 0;
    if (velocity > NEWS_VELOCITY_THRESHOLD * 2 && velocity > prevVelocity * 2) {
      const dedupeKey = generateDedupeKey('velocity_spike', topic, velocity);
      if (!isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'velocity_spike',
          title: 'News Velocity Spike',
          description: `"${topic}" coverage surging: ${velocity.toFixed(1)} activity score`,
          confidence: Math.min(0.85, 0.4 + velocity / 20),
          timestamp: new Date(),
          data: {
            newsVelocity: velocity,
            relatedTopics: [topic],
          },
        });
      }
    }
  }

  // Detect silent market divergence
  for (const market of markets) {
    const change = Math.abs(market.change ?? 0);
    if (change >= MARKET_MOVE_THRESHOLD) {
      const relatedNews = Array.from(newsTopics.entries())
        .filter(([k]) => market.name.toLowerCase().includes(k) || k.includes(market.symbol.toLowerCase()))
        .reduce((sum, [, v]) => sum + v, 0);

      const dedupeKey = generateDedupeKey('silent_divergence', market.symbol, change);
      if (relatedNews < 2 && !isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'silent_divergence',
          title: 'Unexplained Market Move',
          description: `${market.name} moved ${market.change! > 0 ? '+' : ''}${market.change!.toFixed(2)}% with minimal news coverage`,
          confidence: Math.min(0.8, 0.4 + change / 10),
          timestamp: new Date(),
          data: {
            marketChange: market.change!,
            newsVelocity: relatedNews,
          },
        });
      }
    }
  }

  // Detect flow/price divergence for energy commodities
  for (const market of markets) {
    if (!ENERGY_COMMODITY_SYMBOLS.has(market.symbol)) continue;

    const change = market.change ?? 0;
    if (change >= FLOW_PRICE_THRESHOLD) {
      const relatedNews = Array.from(newsTopics.entries())
        .filter(([k]) => market.name.toLowerCase().includes(k) || k.includes(market.symbol.toLowerCase()))
        .reduce((sum, [, v]) => sum + v, 0);

      const dedupeKey = generateDedupeKey('flow_price_divergence', market.symbol, change);
      if (relatedNews < 2 && pipelineFlowMentions === 0 && !isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'flow_price_divergence',
          title: 'Flow/Price Divergence',
          description: `${market.name} up ${change.toFixed(2)}% without pipeline flow news`,
          confidence: Math.min(0.85, 0.4 + change / 8),
          timestamp: new Date(),
          data: {
            marketChange: change,
            newsVelocity: relatedNews,
            relatedTopics: ['pipeline', market.display],
          },
        });
      }
    }
  }

  previousSnapshot = currentSnapshot;

  // Add convergence and triangulation signals
  signals.push(...detectConvergence(events));
  signals.push(...detectTriangulation(events));
  signals.push(...pipelineFlowSignals);

  // Dedupe by type to avoid spam
  const uniqueSignals = signals.filter((sig, idx) =>
    signals.findIndex(s => s.type === sig.type) === idx
  );

  // Only return high-confidence signals
  return uniqueSignals.filter(s => s.confidence >= 0.6);
}

export function getRecentSignals(): CorrelationSignal[] {
  const cutoff = Date.now() - 30 * 60 * 1000; // Last 30 mins
  return signalHistory.filter(s => s.timestamp.getTime() > cutoff);
}

export function addToSignalHistory(signals: CorrelationSignal[]): void {
  signalHistory.push(...signals);
  // Keep only last 100 signals
  while (signalHistory.length > 100) {
    signalHistory.shift();
  }
}
