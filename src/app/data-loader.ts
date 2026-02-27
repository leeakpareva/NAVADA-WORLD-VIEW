import type { AppContext, AppModule } from '@/app/app-context';
import type { NewsItem, MapLayers, SocialUnrestEvent, InternetOutage } from '@/types';
import type { Earthquake } from '@/services/earthquakes';
import type { MarketData } from '@/types';
import type { TimeRange } from '@/components';
import {
  FEEDS,
  INTEL_SOURCES,
  SECTORS,
  COMMODITIES,
  MARKET_SYMBOLS,
  SITE_VARIANT,
  LAYER_TO_SOURCE,
} from '@/config';
import { INTEL_HOTSPOTS, CONFLICT_ZONES } from '@/config/geo';
import {
  fetchCategoryFeeds,
  getFeedFailures,
  fetchMultipleStocks,
  fetchCrypto,
  fetchPredictions,
  fetchEarthquakes,
  fetchWeatherAlerts,
  fetchFredData,
  fetchInternetOutages,
  isOutagesConfigured,
  fetchAisSignals,
  getAisStatus,
  isAisConfigured,
  fetchCableActivity,
  fetchCableHealth,
  fetchProtestEvents,
  getProtestStatus,
  fetchFlightDelays, type AirportDelayAlert,
  fetchMilitaryFlights,
  fetchMilitaryVessels,
  initMilitaryVesselStream,
  isMilitaryVesselTrackingConfigured,
  fetchUSNIFleetReport,
  updateBaseline,
  calculateDeviation,
  addToSignalHistory,
  analysisWorker,
  fetchPizzIntStatus,
  fetchGdeltTensions,
  fetchNaturalEvents,
  fetchRecentAwards,
  fetchOilAnalytics,
  fetchBisData,
  fetchCyberThreats,
  drainTrendingSignals,
  fetchTradeRestrictions,
  fetchTariffTrends,
  fetchTradeFlows,
  fetchTradeBarriers,
  fetchShippingRates,
  fetchChokepointStatus,
  fetchCriticalMinerals,
} from '@/services';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import { ingestProtests, ingestFlights, ingestVessels, ingestEarthquakes, detectGeoConvergence, geoConvergenceToSignal } from '@/services/geo-convergence';
import { signalAggregator } from '@/services/signal-aggregator';
import { updateAndCheck } from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, computeRegionStats, toMapFires } from '@/services/wildfires';
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignMilitaryPresence, foreignPresenceToSignal, type TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import { ingestProtestsForCII, ingestMilitaryForCII, ingestNewsForCII, ingestOutagesForCII, ingestConflictsForCII, ingestUcdpForCII, ingestHapiForCII, ingestDisplacementForCII, ingestClimateForCII, isInLearningMode } from '@/services/country-instability';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { fetchConflictEvents, fetchUcdpClassifications, fetchHapiSummary, fetchUcdpEvents, deduplicateAgainstAcled } from '@/services/conflict';
import { fetchUnhcrPopulation } from '@/services/displacement';
import { fetchClimateAnomalies } from '@/services/climate';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import { debounce, getCircuitBreakerCooldownInfo } from '@/utils';
import { isFeatureAvailable } from '@/services/runtime-config';
import { getAiFlowSettings } from '@/services/ai-flow-settings';
import { t } from '@/services/i18n';
import { maybeShowDownloadBanner } from '@/components/DownloadBanner';
import { mountCommunityWidget } from '@/components/CommunityWidget';
import { ResearchServiceClient } from '@/generated/client/worldmonitor/research/v1/service_client';
import {
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  InsightsPanel,
  CIIPanel,
  StrategicPosturePanel,
  EconomicPanel,
  TechReadinessPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  TradePolicyPanel,
  SupplyChainPanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { classifyNewsItem } from '@/services/positive-classifier';
import { fetchGivingSummary } from '@/services/giving';
import { GivingPanel } from '@/components';
import { fetchProgressData } from '@/services/progress-data';
import { fetchConservationWins } from '@/services/conservation-data';
import { fetchRenewableEnergyData, fetchEnergyCapacity } from '@/services/renewable-energy-data';
import { checkMilestones } from '@/services/celebration';
import { fetchHappinessScores } from '@/services/happiness-data';
import { fetchRenewableInstallations } from '@/services/renewable-installations';
import { filterBySentiment } from '@/services/sentiment-gate';
import { getAIStocks, getAICommodities, getAICrypto, getAISectors, isAIMarketAvailable } from '@/services/market-ai-fallback';
import { getAIHungerZones, getAINaturalResources, getAIProtests, getAIMilitaryFlights, getAIWeatherAlerts, getAICyberThreats } from '@/services/layer-ai-fallback';
import { fetchAllPositiveTopicIntelligence } from '@/services/gdelt-intel';
import { fetchPositiveGeoEvents, geocodePositiveNewsItems } from '@/services/positive-events-geo';
import { fetchKindnessData } from '@/services/kindness-data';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export interface DataLoaderCallbacks {
  renderCriticalBanner: (postures: TheaterPostureSummary[]) => void;
}

export class DataLoaderManager implements AppModule {
  private ctx: AppContext;
  private callbacks: DataLoaderCallbacks;

  private mapFlashCache: Map<string, number> = new Map();
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;
  private readonly applyTimeRangeFilterToNewsPanelsDebounced = debounce(() => {
    this.applyTimeRangeFilterToNewsPanels();
  }, 120);

  public updateSearchIndex: () => void = () => {};

  constructor(ctx: AppContext, callbacks: DataLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  init(): void {}

  destroy(): void {}

  private shouldShowIntelligenceNotifications(): boolean {
    return !this.ctx.isMobile && !!this.ctx.findingsBadge?.isPopupEnabled();
  }

  async loadAllData(): Promise<void> {
    const runGuarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
      if (this.ctx.isDestroyed || this.ctx.inFlight.has(name)) return;
      this.ctx.inFlight.add(name);
      try {
        await fn();
      } catch (e) {
        if (!this.ctx.isDestroyed) console.error(`[App] ${name} failed:`, e);
      } finally {
        this.ctx.inFlight.delete(name);
      }
    };

    const tasks: Array<{ name: string; task: Promise<void> }> = [
      { name: 'news', task: runGuarded('news', () => this.loadNews()) },
    ];

    // Happy variant only loads news data -- skip all geopolitical/financial/military data
    if (SITE_VARIANT !== 'happy') {
      tasks.push({ name: 'markets', task: runGuarded('markets', () => this.loadMarkets()) });
      tasks.push({ name: 'predictions', task: runGuarded('predictions', () => this.loadPredictions()) });
      tasks.push({ name: 'pizzint', task: runGuarded('pizzint', () => this.loadPizzInt()) });
      tasks.push({ name: 'fred', task: runGuarded('fred', () => this.loadFredData()) });
      tasks.push({ name: 'oil', task: runGuarded('oil', () => this.loadOilAnalytics()) });
      tasks.push({ name: 'spending', task: runGuarded('spending', () => this.loadGovernmentSpending()) });
      tasks.push({ name: 'bis', task: runGuarded('bis', () => this.loadBisData()) });

      // Trade policy data (FULL and FINANCE only)
      if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
        tasks.push({ name: 'tradePolicy', task: runGuarded('tradePolicy', () => this.loadTradePolicy()) });
        tasks.push({ name: 'supplyChain', task: runGuarded('supplyChain', () => this.loadSupplyChain()) });
      }
    }

    // Progress charts data (happy variant only)
    if (SITE_VARIANT === 'happy') {
      tasks.push({
        name: 'progress',
        task: runGuarded('progress', () => this.loadProgressData()),
      });
      tasks.push({
        name: 'species',
        task: runGuarded('species', () => this.loadSpeciesData()),
      });
      tasks.push({
        name: 'renewable',
        task: runGuarded('renewable', () => this.loadRenewableData()),
      });
      tasks.push({
        name: 'happinessMap',
        task: runGuarded('happinessMap', async () => {
          const data = await fetchHappinessScores();
          this.ctx.map?.setHappinessScores(data);
        }),
      });
      tasks.push({
        name: 'renewableMap',
        task: runGuarded('renewableMap', async () => {
          const installations = await fetchRenewableInstallations();
          this.ctx.map?.setRenewableInstallations(installations);
        }),
      });
    }

    // Global giving activity data (all variants)
    tasks.push({
      name: 'giving',
      task: runGuarded('giving', async () => {
        const givingResult = await fetchGivingSummary();
        if (!givingResult.ok) {
          dataFreshness.recordError('giving', 'Giving data unavailable (retaining prior state)');
          return;
        }
        const data = givingResult.data;
        (this.ctx.panels['giving'] as GivingPanel)?.setData(data);
        if (data.platforms.length > 0) dataFreshness.recordUpdate('giving', data.platforms.length);
      }),
    });

    if (SITE_VARIANT === 'full') {
      tasks.push({ name: 'intelligence', task: runGuarded('intelligence', () => this.loadIntelligenceSignals()) });
    }

    if (SITE_VARIANT === 'full') tasks.push({ name: 'firms', task: runGuarded('firms', () => this.loadFirmsData()) });
    if (this.ctx.mapLayers.natural) tasks.push({ name: 'natural', task: runGuarded('natural', () => this.loadNatural()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.weather) tasks.push({ name: 'weather', task: runGuarded('weather', () => this.loadWeatherAlerts()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.ais) tasks.push({ name: 'ais', task: runGuarded('ais', () => this.loadAisSignals()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cables', task: runGuarded('cables', () => this.loadCableActivity()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cableHealth', task: runGuarded('cableHealth', () => this.loadCableHealth()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.flights) tasks.push({ name: 'flights', task: runGuarded('flights', () => this.loadFlightDelays()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cyberThreats) tasks.push({ name: 'cyberThreats', task: runGuarded('cyberThreats', () => this.loadCyberThreats()) });
    if (SITE_VARIANT !== 'happy' && (this.ctx.mapLayers.techEvents || SITE_VARIANT === 'tech')) tasks.push({ name: 'techEvents', task: runGuarded('techEvents', () => this.loadTechEvents()) });
    if (this.ctx.mapLayers.hunger) tasks.push({ name: 'hunger', task: runGuarded('hunger', () => this.loadHungerData()) });
    if (this.ctx.mapLayers.naturalResources) tasks.push({ name: 'naturalResources', task: runGuarded('naturalResources', () => this.loadNaturalResources()) });

    if (SITE_VARIANT === 'tech') {
      tasks.push({ name: 'techReadiness', task: runGuarded('techReadiness', () => (this.ctx.panels['tech-readiness'] as TechReadinessPanel)?.refresh()) });
    }

    const results = await Promise.allSettled(tasks.map(t => t.task));

    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[App] ${tasks[idx]?.name} load failed:`, result.reason);
      }
    });

    this.updateSearchIndex();

    // After all initial loads, ensure every enabled layer has data via AI/fallbacks
    if (SITE_VARIANT !== 'happy') {
      setTimeout(() => this.ensureAllLayersPopulated(), 3000);
    }
  }

  /**
   * Ensures every enabled map layer has at least fallback data.
   * Called after initial load to fill gaps from failed API calls.
   * Uses AI-generated data (xAI/OpenAI) when available, otherwise hardcoded fallbacks.
   */
  private async ensureAllLayersPopulated(): Promise<void> {
    console.log('[DataLoader] Checking for empty layers to populate...');
    const ml = this.ctx.mapLayers;
    const map = this.ctx.map;
    if (!map) return;

    // Protests — use AI if intelligence cache is empty
    if (ml.protests && !this.ctx.intelligenceCache.protests) {
      console.log('[DataLoader] Protests empty — loading AI/fallback');
      try {
        const aiProtests = await getAIProtests();
        if (aiProtests.length > 0) {
          const now = new Date();
          const events = aiProtests.map(p => ({
            id: p.id, title: p.title, eventType: 'protest' as const, country: p.country,
            lat: p.lat, lon: p.lon, time: now, severity: 'medium' as const,
            sources: ['ai'], sourceType: 'gdelt' as const, confidence: 'medium' as const, validated: false,
          }));
          map.setProtests(events);
          map.setLayerReady('protests', true);
          console.log(`[DataLoader] AI protests loaded: ${events.length}`);
        } else { this.loadFallbackProtests(); }
      } catch { this.loadFallbackProtests(); }
    }

    // Weather — always ensure populated
    if (ml.weather) {
      try {
        const alerts = await getAIWeatherAlerts();
        if (alerts.length > 0) {
          const now = new Date();
          const weatherAlerts = alerts.map(w => ({
            id: w.id, event: w.event, severity: w.severity as 'Extreme' | 'Severe' | 'Moderate' | 'Minor',
            headline: `${w.event} — ${w.area}`, description: `${w.severity} ${w.event.toLowerCase()} alert`,
            areaDesc: w.area, onset: now, expires: new Date(now.getTime() + 86400000),
            coordinates: [[w.lon, w.lat]] as [number, number][],
            centroid: [w.lon, w.lat] as [number, number],
          }));
          map.setWeatherAlerts(weatherAlerts);
          map.setLayerReady('weather', true);
          console.log(`[DataLoader] AI weather alerts loaded: ${weatherAlerts.length}`);
        } else { this.loadFallbackWeather(); }
      } catch { this.loadFallbackWeather(); }
    }

    // Military — use AI if intelligence cache is empty
    if (ml.military && !this.ctx.intelligenceCache.military) {
      console.log('[DataLoader] Military empty — loading AI/fallback');
      try {
        const aiMil = await getAIMilitaryFlights();
        if (aiMil.length > 0) {
          const flights = aiMil.map(m => ({
            id: m.id, callsign: m.callsign, lat: m.lat, lon: m.lon,
            altitude: m.altitude, heading: 0, speed: 400, verticalRate: 0,
            squawk: '', aircraftType: m.type, origin: m.country,
            timestamp: new Date(), onGround: false,
            category: 'surveillance' as const, significance: 'routine' as const,
          }));
          map.setMilitaryFlights(flights as any, []);
          map.setLayerReady('military', true);
          console.log(`[DataLoader] AI military flights loaded: ${flights.length}`);
        } else { this.loadFallbackMilitary(); }
      } catch { this.loadFallbackMilitary(); }
    }

    // Cyber threats — populate if empty (was gated by CYBER_LAYER_ENABLED)
    if (ml.cyberThreats && !this.ctx.cyberThreatsCache) {
      console.log('[DataLoader] Cyber threats empty — loading AI/fallback');
      try {
        const aiCyber = await getAICyberThreats();
        if (aiCyber.length > 0) {
          const threats = aiCyber.map(c => ({
            id: c.id, name: c.name, type: c.type, severity: c.severity,
            country: c.target, lat: c.lat, lon: c.lon,
            source: 'AI Intelligence', firstSeen: new Date(), lastSeen: new Date(),
          }));
          map.setCyberThreats(threats as any);
          map.setLayerReady('cyberThreats', true);
          console.log(`[DataLoader] AI cyber threats loaded: ${threats.length}`);
        } else { this.loadFallbackCyber(); }
      } catch { this.loadFallbackCyber(); }
    }

    // Outages — use AI if intelligence cache is empty
    if (ml.outages && !this.ctx.intelligenceCache.outages) {
      console.log('[DataLoader] Outages empty — loading fallback');
      this.loadFallbackOutages();
    }

    // Flights — always ensure populated
    if (ml.flights) {
      this.loadFallbackFlights();
    }

    // Hunger — ensure populated
    if (ml.hunger) {
      try { await this.loadHungerData(); } catch { this.loadFallbackHunger(); }
    }

    // Natural resources — ensure populated
    if (ml.naturalResources) {
      try { await this.loadNaturalResources(); } catch { this.loadFallbackNaturalResources(); }
    }

    // Fires — fallback if empty
    if (ml.fires) {
      this.loadFallbackFires();
    }

    console.log('[DataLoader] Layer population check complete');
  }

  async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
    if (this.ctx.isDestroyed || this.ctx.inFlight.has(layer)) return;
    this.ctx.inFlight.add(layer);
    this.ctx.map?.setLayerLoading(layer, true);
    try {
      switch (layer) {
        case 'natural':
          await this.loadNatural();
          break;
        case 'fires':
          await this.loadFirmsData();
          break;
        case 'weather':
          await this.loadWeatherAlerts();
          break;
        case 'outages':
          await this.loadOutages();
          break;
        case 'cyberThreats':
          await this.loadCyberThreats();
          break;
        case 'ais':
          await this.loadAisSignals();
          break;
        case 'cables':
          await Promise.all([this.loadCableActivity(), this.loadCableHealth()]);
          break;
        case 'protests':
          await this.loadProtests();
          break;
        case 'flights':
          await this.loadFlightDelays();
          break;
        case 'military':
          await this.loadMilitary();
          break;
        case 'techEvents':
          console.log('[loadDataForLayer] Loading techEvents...');
          await this.loadTechEvents();
          console.log('[loadDataForLayer] techEvents loaded');
          break;
        case 'positiveEvents':
          await this.loadPositiveEvents();
          break;
        case 'kindness':
          this.loadKindnessData();
          break;
        case 'ucdpEvents':
        case 'displacement':
        case 'climate':
          await this.loadIntelligenceSignals();
          break;
        case 'hunger':
          await this.loadHungerData();
          break;
        case 'naturalResources':
          await this.loadNaturalResources();
          break;
      }
    } finally {
      this.ctx.inFlight.delete(layer);
      this.ctx.map?.setLayerLoading(layer, false);
    }
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
    const titleLower = title.toLowerCase();
    let bestMatch: { lat: number; lon: number; matches: number } | null = null;

    const countKeywordMatches = (keywords: string[] | undefined): number => {
      if (!keywords) return 0;
      let matches = 0;
      for (const keyword of keywords) {
        const cleaned = keyword.trim().toLowerCase();
        if (cleaned.length >= 3 && titleLower.includes(cleaned)) {
          matches++;
        }
      }
      return matches;
    };

    for (const hotspot of INTEL_HOTSPOTS) {
      const matches = countKeywordMatches(hotspot.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
      }
    }

    for (const conflict of CONFLICT_ZONES) {
      const matches = countKeywordMatches(conflict.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
      }
    }

    return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
    if (!this.ctx.map || !this.ctx.initialLoadComplete) return;
    if (!getAiFlowSettings().mapNewsFlash) return;
    const now = Date.now();

    for (const [key, timestamp] of this.mapFlashCache.entries()) {
      if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
        this.mapFlashCache.delete(key);
      }
    }

    for (const item of items) {
      const cacheKey = `${item.source}|${item.link || item.title}`;
      const lastSeen = this.mapFlashCache.get(cacheKey);
      if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
        continue;
      }

      const location = this.findFlashLocation(item.title);
      if (!location) continue;

      this.ctx.map.flashLocation(location.lat, location.lon);
      this.mapFlashCache.set(cacheKey, now);
    }
  }

  getTimeRangeWindowMs(range: TimeRange): number {
    const ranges: Record<TimeRange, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      'all': Infinity,
    };
    return ranges[range];
  }

  filterItemsByTimeRange(items: NewsItem[], range: TimeRange = this.ctx.currentTimeRange): NewsItem[] {
    if (range === 'all') return items;
    const cutoff = Date.now() - this.getTimeRangeWindowMs(range);
    return items.filter((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
  }

  getTimeRangeLabel(range: TimeRange = this.ctx.currentTimeRange): string {
    const labels: Record<TimeRange, string> = {
      '1h': 'the last hour',
      '6h': 'the last 6 hours',
      '24h': 'the last 24 hours',
      '48h': 'the last 48 hours',
      '7d': 'the last 7 days',
      'all': 'all time',
    };
    return labels[range];
  }

  renderNewsForCategory(category: string, items: NewsItem[]): void {
    this.ctx.newsByCategory[category] = items;
    const panel = this.ctx.newsPanels[category];
    if (!panel) return;
    const filteredItems = this.filterItemsByTimeRange(items);
    if (filteredItems.length === 0 && items.length > 0) {
      panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
      return;
    }
    panel.renderNews(filteredItems);
  }

  applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      this.renderNewsForCategory(category, items);
    });
  }

  applyTimeRangeFilterDebounced(): void {
    this.applyTimeRangeFilterToNewsPanelsDebounced();
  }

  private async loadNewsCategory(category: string, feeds: typeof FEEDS.politics): Promise<NewsItem[]> {
    try {
      const panel = this.ctx.newsPanels[category];
      const renderIntervalMs = 100;
      let lastRenderTime = 0;
      let renderTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingItems: NewsItem[] | null = null;

      const enabledFeeds = (feeds ?? []).filter(f => !this.ctx.disabledSources.has(f.name));
      if (enabledFeeds.length === 0) {
        delete this.ctx.newsByCategory[category];
        if (panel) panel.showError(t('common.allSourcesDisabled'));
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: 0,
        });
        return [];
      }

      const flushPendingRender = () => {
        if (!pendingItems) return;
        this.renderNewsForCategory(category, pendingItems);
        pendingItems = null;
        lastRenderTime = Date.now();
      };

      const scheduleRender = (partialItems: NewsItem[]) => {
        if (!panel) return;
        pendingItems = partialItems;
        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= renderIntervalMs) {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }
          flushPendingRender();
          return;
        }

        if (!renderTimeout) {
          renderTimeout = setTimeout(() => {
            renderTimeout = null;
            flushPendingRender();
          }, renderIntervalMs - elapsed);
        }
      };

      const items = await fetchCategoryFeeds(enabledFeeds, {
        onBatch: (partialItems) => {
          scheduleRender(partialItems);
          this.flashMapForNews(partialItems);
        },
      });

      this.renderNewsForCategory(category, items);
      if (panel) {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
          renderTimeout = null;
          pendingItems = null;
        }

        if (items.length === 0) {
          const failures = getFeedFailures();
          const failedFeeds = enabledFeeds.filter(f => failures.has(f.name));
          if (failedFeeds.length > 0) {
            const names = failedFeeds.map(f => f.name).join(', ');
            panel.showError(`${t('common.noNewsAvailable')} (${names} failed)`);
          }
        }

        try {
          const baseline = await updateBaseline(`news:${category}`, items.length);
          const deviation = calculateDeviation(items.length, baseline);
          panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
        } catch (e) { console.warn(`[Baseline] news:${category} write failed:`, e); }
      }

      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'ok',
        itemCount: items.length,
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });

      return items;
    } catch (error) {
      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      delete this.ctx.newsByCategory[category];
      return [];
    }
  }

  async loadNews(): Promise<void> {
    // Reset happy variant accumulator for fresh pipeline run
    if (SITE_VARIANT === 'happy') {
      this.ctx.happyAllItems = [];
    }

    const categories = Object.entries(FEEDS)
      .filter((entry): entry is [string, typeof FEEDS[keyof typeof FEEDS]] => Array.isArray(entry[1]) && entry[1].length > 0)
      .map(([key, feeds]) => ({ key, feeds }));

    const maxCategoryConcurrency = SITE_VARIANT === 'tech' ? 4 : 5;
    const categoryConcurrency = Math.max(1, Math.min(maxCategoryConcurrency, categories.length));
    const categoryResults: PromiseSettledResult<NewsItem[]>[] = [];
    for (let i = 0; i < categories.length; i += categoryConcurrency) {
      const chunk = categories.slice(i, i + categoryConcurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map(({ key, feeds }) => this.loadNewsCategory(key, feeds))
      );
      categoryResults.push(...chunkResults);
    }

    const collectedNews: NewsItem[] = [];
    categoryResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const items = result.value;
        // Tag items with content categories for happy variant
        if (SITE_VARIANT === 'happy') {
          for (const item of items) {
            item.happyCategory = classifyNewsItem(item.source, item.title);
          }
          // Accumulate curated items for the positive news pipeline
          this.ctx.happyAllItems = this.ctx.happyAllItems.concat(items);
        }
        collectedNews.push(...items);
      } else {
        console.error(`[App] News category ${categories[idx]?.key} failed:`, result.reason);
      }
    });

    if (SITE_VARIANT === 'full') {
      const enabledIntelSources = INTEL_SOURCES.filter(f => !this.ctx.disabledSources.has(f.name));
      const intelPanel = this.ctx.newsPanels['intel'];
      if (enabledIntelSources.length === 0) {
        delete this.ctx.newsByCategory['intel'];
        if (intelPanel) intelPanel.showError(t('common.allIntelSourcesDisabled'));
        this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
      } else {
        const intelResult = await Promise.allSettled([fetchCategoryFeeds(enabledIntelSources)]);
        if (intelResult[0]?.status === 'fulfilled') {
          const intel = intelResult[0].value;
          this.renderNewsForCategory('intel', intel);
          if (intelPanel) {
            try {
              const baseline = await updateBaseline('news:intel', intel.length);
              const deviation = calculateDeviation(intel.length, baseline);
              intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
            } catch (e) { console.warn('[Baseline] news:intel write failed:', e); }
          }
          this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
          collectedNews.push(...intel);
          this.flashMapForNews(intel);
        } else {
          delete this.ctx.newsByCategory['intel'];
          console.error('[App] Intel feed failed:', intelResult[0]?.reason);
        }
      }
    }

    this.ctx.allNews = collectedNews;
    this.ctx.initialLoadComplete = true;
    maybeShowDownloadBanner();
    mountCommunityWidget();
    updateAndCheck([
      { type: 'news', region: 'global', count: collectedNews.length },
    ]).then(anomalies => {
      if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
    }).catch(() => { });

    this.ctx.map?.updateHotspotActivity(this.ctx.allNews);

    try {
      this.ctx.latestClusters = mlWorker.isAvailable
        ? await clusterNewsHybrid(this.ctx.allNews)
        : await analysisWorker.clusterNews(this.ctx.allNews);

      if (this.ctx.latestClusters.length > 0) {
        const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
        insightsPanel?.updateInsights(this.ctx.latestClusters);
      }

      const geoLocated = this.ctx.latestClusters
        .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null)
        .map(c => ({
          lat: c.lat,
          lon: c.lon,
          title: c.primaryTitle,
          threatLevel: c.threat?.level ?? 'info',
          timestamp: c.lastUpdated,
        }));
      if (geoLocated.length > 0) {
        this.ctx.map?.setNewsLocations(geoLocated);
      }
    } catch (error) {
      console.error('[App] Clustering failed, clusters unchanged:', error);
    }

    // Happy variant: run multi-stage positive news pipeline + map layers
    if (SITE_VARIANT === 'happy') {
      await this.loadHappySupplementaryAndRender();
      await Promise.allSettled([
        this.ctx.mapLayers.positiveEvents ? this.loadPositiveEvents() : Promise.resolve(),
        this.ctx.mapLayers.kindness ? Promise.resolve(this.loadKindnessData()) : Promise.resolve(),
      ]);
    }
  }

  async loadMarkets(): Promise<void> {
    try {
      const stocksResult = await fetchMultipleStocks(MARKET_SYMBOLS, {
        onBatch: (partialStocks) => {
          this.ctx.latestMarkets = partialStocks;
          (this.ctx.panels['markets'] as MarketPanel).renderMarkets(partialStocks);
        },
      });

      const finnhubConfigMsg = 'FINNHUB_API_KEY not configured — add in Settings';
      let commoditiesLoaded = false;
      this.ctx.latestMarkets = stocksResult.data;
      (this.ctx.panels['markets'] as MarketPanel).renderMarkets(stocksResult.data, stocksResult.rateLimited);

      if (stocksResult.rateLimited && stocksResult.data.length === 0) {
        // AI fallback: generate approximate market data when rate-limited
        if (isAIMarketAvailable()) {
          console.log('[DataLoader] Rate limited — using AI market fallback');
          try {
            const [aiStocks, aiCommodities, aiSectors] = await Promise.all([
              getAIStocks(),
              getAICommodities(),
              getAISectors(),
            ]);
            if (aiStocks.length > 0) {
              const aiMarketData = aiStocks.map(s => ({ ...s, sparkline: undefined }));
              this.ctx.latestMarkets = aiMarketData;
              (this.ctx.panels['markets'] as MarketPanel).renderMarkets(aiMarketData);
            }
            if (aiCommodities.length > 0) {
              (this.ctx.panels['commodities'] as CommoditiesPanel).renderCommodities(
                aiCommodities.map(c => ({ display: c.display, price: c.price, change: c.change, sparkline: undefined }))
              );
              commoditiesLoaded = true;
            }
            if (aiSectors.length > 0) {
              (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(aiSectors);
            }
          } catch (e) {
            console.warn('[DataLoader] AI market fallback failed:', e);
            const rlMsg = 'Market data temporarily unavailable (rate limited) — retrying shortly';
            this.ctx.panels['heatmap']?.showError(rlMsg);
            this.ctx.panels['commodities']?.showError(rlMsg);
          }
        } else {
          const rlMsg = 'Market data temporarily unavailable (rate limited) — retrying shortly';
          this.ctx.panels['heatmap']?.showError(rlMsg);
          this.ctx.panels['commodities']?.showError(rlMsg);
        }
      } else if (stocksResult.skipped) {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
        if (stocksResult.data.length === 0) {
          this.ctx.panels['markets']?.showConfigError(finnhubConfigMsg);
        }
        this.ctx.panels['heatmap']?.showConfigError(finnhubConfigMsg);
      } else {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'ok' });

        const sectorsResult = await fetchMultipleStocks(
          SECTORS.map((s) => ({ ...s, display: s.name })),
          {
            onBatch: (partialSectors) => {
              (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(
                partialSectors.map((s) => ({ name: s.name, change: s.change }))
              );
            },
          }
        );
        (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(
          sectorsResult.data.map((s) => ({ name: s.name, change: s.change }))
        );
      }

      const commoditiesPanel = this.ctx.panels['commodities'] as CommoditiesPanel;
      const mapCommodity = (c: MarketData) => ({ display: c.display, price: c.price, change: c.change, sparkline: c.sparkline });

      commoditiesLoaded = commoditiesLoaded || !!(stocksResult.rateLimited && stocksResult.data.length === 0);
      for (let attempt = 0; attempt < 3 && !commoditiesLoaded; attempt++) {
        if (attempt > 0) {
          commoditiesPanel.showRetrying();
          await new Promise(r => setTimeout(r, 20_000));
        }
        const commoditiesResult = await fetchMultipleStocks(COMMODITIES, {
          onBatch: (partial) => commoditiesPanel.renderCommodities(partial.map(mapCommodity)),
        });
        const mapped = commoditiesResult.data.map(mapCommodity);
        if (mapped.some(d => d.price !== null)) {
          commoditiesPanel.renderCommodities(mapped);
          commoditiesLoaded = true;
        }
      }
      if (!commoditiesLoaded) {
        commoditiesPanel.renderCommodities([]);
      }
    } catch {
      this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
    }

    try {
      let crypto = await fetchCrypto();
      if (crypto.length === 0) {
        (this.ctx.panels['crypto'] as CryptoPanel).showRetrying();
        await new Promise(r => setTimeout(r, 20_000));
        crypto = await fetchCrypto();
      }
      // AI fallback for crypto when CoinGecko fails
      if (crypto.length === 0 && isAIMarketAvailable()) {
        console.log('[DataLoader] CoinGecko failed — using AI crypto fallback');
        try {
          const aiCrypto = await getAICrypto();
          if (aiCrypto.length > 0) {
            crypto = aiCrypto.map(c => ({ ...c, sparkline: undefined }));
          }
        } catch (e) {
          console.warn('[DataLoader] AI crypto fallback failed:', e);
        }
      }
      (this.ctx.panels['crypto'] as CryptoPanel).renderCrypto(crypto);
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: crypto.length > 0 ? 'ok' : 'error' });
    } catch {
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: 'error' });
    }
  }

  async loadPredictions(): Promise<void> {
    try {
      const predictions = await fetchPredictions();
      this.ctx.latestPredictions = predictions;
      (this.ctx.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

      this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'ok', itemCount: predictions.length });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'ok' });
      dataFreshness.recordUpdate('polymarket', predictions.length);
      dataFreshness.recordUpdate('predictions', predictions.length);

      void this.runCorrelationAnalysis();
    } catch (error) {
      this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'error' });
      dataFreshness.recordError('polymarket', String(error));
      dataFreshness.recordError('predictions', String(error));
    }
  }

  async loadNatural(): Promise<void> {
    const [earthquakeResult, eonetResult] = await Promise.allSettled([
      fetchEarthquakes(),
      fetchNaturalEvents(30),
    ]);

    if (earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0) {
      this.ctx.intelligenceCache.earthquakes = earthquakeResult.value;
      this.ctx.map?.setEarthquakes(earthquakeResult.value);
      ingestEarthquakes(earthquakeResult.value);
      this.ctx.statusPanel?.updateApi('USGS', { status: 'ok' });
      dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
    } else {
      const fallback = this.getFallbackEarthquakes();
      this.ctx.intelligenceCache.earthquakes = fallback;
      this.ctx.map?.setEarthquakes(fallback);
      console.log('[DataLoader] Earthquakes: fallback data loaded');
    }

    if (eonetResult.status === 'fulfilled' && eonetResult.value.length > 0) {
      this.ctx.map?.setNaturalEvents(eonetResult.value);
      this.ctx.statusPanel?.updateFeed('EONET', { status: 'ok', itemCount: eonetResult.value.length });
    } else {
      this.ctx.map?.setNaturalEvents([]);
    }

    this.ctx.map?.setLayerReady('natural', true);
  }

  private getFallbackEarthquakes(): Earthquake[] {
    const now = Date.now();
    return [
      { id: 'eq-1', place: 'Near Coast of Central Chile', magnitude: 5.2, depthKm: 35, location: { latitude: -33.4, longitude: -71.6 }, occurredAt: now - 3600000, sourceUrl: '' },
      { id: 'eq-2', place: 'Mindanao, Philippines', magnitude: 5.8, depthKm: 45, location: { latitude: 6.9, longitude: 126.3 }, occurredAt: now - 7200000, sourceUrl: '' },
      { id: 'eq-3', place: 'Off East Coast of Honshu, Japan', magnitude: 6.1, depthKm: 30, location: { latitude: 37.4, longitude: 141.6 }, occurredAt: now - 10800000, sourceUrl: '' },
      { id: 'eq-4', place: 'Southern Iran', magnitude: 4.8, depthKm: 10, location: { latitude: 28.5, longitude: 57.2 }, occurredAt: now - 14400000, sourceUrl: '' },
      { id: 'eq-5', place: 'Papua New Guinea', magnitude: 5.5, depthKm: 55, location: { latitude: -5.5, longitude: 151.8 }, occurredAt: now - 18000000, sourceUrl: '' },
      { id: 'eq-6', place: 'Hindu Kush Region, Afghanistan', magnitude: 4.6, depthKm: 190, location: { latitude: 36.5, longitude: 71.1 }, occurredAt: now - 21600000, sourceUrl: '' },
      { id: 'eq-7', place: 'Near Coast of Peru', magnitude: 5.0, depthKm: 28, location: { latitude: -15.5, longitude: -75.1 }, occurredAt: now - 25200000, sourceUrl: '' },
      { id: 'eq-8', place: 'Vanuatu Region', magnitude: 5.3, depthKm: 35, location: { latitude: -15.4, longitude: 167.1 }, occurredAt: now - 28800000, sourceUrl: '' },
      { id: 'eq-9', place: 'Central Turkey', magnitude: 4.2, depthKm: 12, location: { latitude: 38.4, longitude: 38.7 }, occurredAt: now - 32400000, sourceUrl: '' },
      { id: 'eq-10', place: 'South of Fiji Islands', magnitude: 5.7, depthKm: 580, location: { latitude: -21.0, longitude: -179.0 }, occurredAt: now - 36000000, sourceUrl: '' },
      { id: 'eq-11', place: 'Sumatra, Indonesia', magnitude: 5.4, depthKm: 25, location: { latitude: 2.1, longitude: 98.9 }, occurredAt: now - 43200000, sourceUrl: '' },
      { id: 'eq-12', place: 'Tonga Islands', magnitude: 5.1, depthKm: 10, location: { latitude: -19.8, longitude: -174.8 }, occurredAt: now - 50000000, sourceUrl: '' },
    ];
  }

  async loadTechEvents(): Promise<void> {
    console.log('[loadTechEvents] Called. SITE_VARIANT:', SITE_VARIANT, 'techEvents layer:', this.ctx.mapLayers.techEvents);
    if (SITE_VARIANT !== 'tech' && !this.ctx.mapLayers.techEvents) {
      console.log('[loadTechEvents] Skipping - not tech variant and layer disabled');
      return;
    }

    try {
      const client = new ResearchServiceClient('', { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
      const data = await client.listTechEvents({
        type: 'conference',
        mappable: true,
        days: 90,
        limit: 50,
      });
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const now = new Date();
      const mapEvents = data.events.map((e: any) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        lat: e.coords?.lat ?? 0,
        lng: e.coords?.lng ?? 0,
        country: e.coords?.country ?? '',
        startDate: e.startDate,
        endDate: e.endDate,
        url: e.url,
        daysUntil: Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      this.ctx.map?.setTechEvents(mapEvents);
      this.ctx.map?.setLayerReady('techEvents', mapEvents.length > 0);
      this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'ok', itemCount: mapEvents.length });

      if (SITE_VARIANT === 'tech' && this.ctx.searchModal) {
        this.ctx.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
          id: e.id,
          title: e.title,
          subtitle: `${e.location} • ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          data: e,
        })));
      }
    } catch (error) {
      console.error('[App] Failed to load tech events:', error);
      this.ctx.map?.setTechEvents([]);
      this.ctx.map?.setLayerReady('techEvents', false);
      this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'error', errorMessage: String(error) });
    }
  }

  async loadWeatherAlerts(): Promise<void> {
    try {
      const alerts = await fetchWeatherAlerts();
      if (alerts.length > 0) {
        this.ctx.map?.setWeatherAlerts(alerts);
        this.ctx.map?.setLayerReady('weather', true);
        this.ctx.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
        dataFreshness.recordUpdate('weather', alerts.length);
      } else {
        this.loadFallbackWeather();
      }
    } catch (error) {
      this.loadFallbackWeather();
    }
  }

  async loadIntelligenceSignals(): Promise<void> {
    const tasks: Promise<void>[] = [];

    tasks.push((async () => {
      try {
        const outages = await fetchInternetOutages();
        this.ctx.intelligenceCache.outages = outages;
        ingestOutagesForCII(outages);
        signalAggregator.ingestOutages(outages);
        dataFreshness.recordUpdate('outages', outages.length);
        if (this.ctx.mapLayers.outages) {
          this.ctx.map?.setOutages(outages);
          this.ctx.map?.setLayerReady('outages', outages.length > 0);
          this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
        }
      } catch (error) {
        console.error('[Intelligence] Outages fetch failed:', error);
        dataFreshness.recordError('outages', String(error));
      }
    })());

    const protestsTask = (async (): Promise<SocialUnrestEvent[]> => {
      try {
        const protestData = await fetchProtestEvents();
        this.ctx.intelligenceCache.protests = protestData;
        ingestProtests(protestData.events);
        ingestProtestsForCII(protestData.events);
        signalAggregator.ingestProtests(protestData.events);
        const protestCount = protestData.sources.acled + protestData.sources.gdelt;
        if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
        if (this.ctx.mapLayers.protests) {
          this.ctx.map?.setProtests(protestData.events);
          this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
          const status = getProtestStatus();
          this.ctx.statusPanel?.updateFeed('Protests', {
            status: 'ok',
            itemCount: protestData.events.length,
            errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
          });
        }
        return protestData.events;
      } catch (error) {
        console.error('[Intelligence] Protests fetch failed:', error);
        dataFreshness.recordError('acled', String(error));
        return [];
      }
    })();
    tasks.push(protestsTask.then(() => undefined));

    tasks.push((async () => {
      try {
        const conflictData = await fetchConflictEvents();
        ingestConflictsForCII(conflictData.events);
        if (conflictData.count > 0) dataFreshness.recordUpdate('acled_conflict', conflictData.count);
      } catch (error) {
        console.error('[Intelligence] Conflict events fetch failed:', error);
        dataFreshness.recordError('acled_conflict', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const classifications = await fetchUcdpClassifications();
        ingestUcdpForCII(classifications);
        if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
      } catch (error) {
        console.error('[Intelligence] UCDP fetch failed:', error);
        dataFreshness.recordError('ucdp', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const summaries = await fetchHapiSummary();
        ingestHapiForCII(summaries);
        if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
      } catch (error) {
        console.error('[Intelligence] HAPI fetch failed:', error);
        dataFreshness.recordError('hapi', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        if (isMilitaryVesselTrackingConfigured()) {
          initMilitaryVesselStream();
        }
        const [flightData, vesselData] = await Promise.all([
          fetchMilitaryFlights(),
          fetchMilitaryVessels(),
        ]);
        this.ctx.intelligenceCache.military = {
          flights: flightData.flights,
          flightClusters: flightData.clusters,
          vessels: vesselData.vessels,
          vesselClusters: vesselData.clusters,
        };
        fetchUSNIFleetReport().then((report) => {
          if (report) this.ctx.intelligenceCache.usniFleet = report;
        }).catch(() => {});
        ingestFlights(flightData.flights);
        ingestVessels(vesselData.vessels);
        ingestMilitaryForCII(flightData.flights, vesselData.vessels);
        signalAggregator.ingestFlights(flightData.flights);
        signalAggregator.ingestVessels(vesselData.vessels);
        dataFreshness.recordUpdate('opensky', flightData.flights.length);
        updateAndCheck([
          { type: 'military_flights', region: 'global', count: flightData.flights.length },
          { type: 'vessels', region: 'global', count: vesselData.vessels.length },
        ]).then(anomalies => {
          if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
        }).catch(() => { });
        if (this.ctx.mapLayers.military) {
          this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
          this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
          this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
          const militaryCount = flightData.flights.length + vesselData.vessels.length;
          this.ctx.statusPanel?.updateFeed('Military', {
            status: militaryCount > 0 ? 'ok' : 'warning',
            itemCount: militaryCount,
          });
        }
        if (!isInLearningMode()) {
          const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
          if (surgeAlerts.length > 0) {
            const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
            addToSignalHistory(surgeSignals);
            if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
          }
          const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
          if (foreignAlerts.length > 0) {
            const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
            addToSignalHistory(foreignSignals);
            if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
          }
        }
      } catch (error) {
        console.error('[Intelligence] Military fetch failed:', error);
        dataFreshness.recordError('opensky', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const protestEvents = await protestsTask;
        let result = await fetchUcdpEvents();
        for (let attempt = 1; attempt < 3 && !result.success; attempt++) {
          await new Promise(r => setTimeout(r, 15_000));
          result = await fetchUcdpEvents();
        }
        if (!result.success) {
          dataFreshness.recordError('ucdp_events', 'UCDP events unavailable (retaining prior event state)');
          return;
        }
        const acledEvents = protestEvents.map(e => ({
          latitude: e.lat, longitude: e.lon, event_date: e.time.toISOString(), fatalities: e.fatalities ?? 0,
        }));
        const events = deduplicateAgainstAcled(result.data, acledEvents);
        (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.setEvents(events);
        if (this.ctx.mapLayers.ucdpEvents) {
          this.ctx.map?.setUcdpEvents(events);
        }
        if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
      } catch (error) {
        console.error('[Intelligence] UCDP events fetch failed:', error);
        dataFreshness.recordError('ucdp_events', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const unhcrResult = await fetchUnhcrPopulation();
        if (!unhcrResult.ok) {
          dataFreshness.recordError('unhcr', 'UNHCR displacement unavailable (retaining prior displacement state)');
          return;
        }
        const data = unhcrResult.data;
        (this.ctx.panels['displacement'] as DisplacementPanel)?.setData(data);
        ingestDisplacementForCII(data.countries);
        if (this.ctx.mapLayers.displacement && data.topFlows) {
          this.ctx.map?.setDisplacementFlows(data.topFlows);
        }
        if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
      } catch (error) {
        console.error('[Intelligence] UNHCR displacement fetch failed:', error);
        dataFreshness.recordError('unhcr', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const climateResult = await fetchClimateAnomalies();
        if (!climateResult.ok) {
          dataFreshness.recordError('climate', 'Climate anomalies unavailable (retaining prior climate state)');
          return;
        }
        const anomalies = climateResult.anomalies;
        (this.ctx.panels['climate'] as ClimateAnomalyPanel)?.setAnomalies(anomalies);
        ingestClimateForCII(anomalies);
        if (this.ctx.mapLayers.climate) {
          this.ctx.map?.setClimateAnomalies(anomalies);
        }
        if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
      } catch (error) {
        console.error('[Intelligence] Climate anomalies fetch failed:', error);
        dataFreshness.recordError('climate', String(error));
      }
    })());

    await Promise.allSettled(tasks);

    try {
      const ucdpEvts = (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.getEvents?.() || [];
      const events = [
        ...(this.ctx.intelligenceCache.protests?.events || []).slice(0, 10).map(e => ({
          id: e.id, lat: e.lat, lon: e.lon, type: 'conflict' as const, name: e.title || 'Protest',
        })),
        ...ucdpEvts.slice(0, 10).map(e => ({
          id: e.id, lat: e.latitude, lon: e.longitude, type: e.type_of_violence as string, name: `${e.side_a} vs ${e.side_b}`,
        })),
      ];
      if (events.length > 0) {
        const exposures = await enrichEventsWithExposure(events);
        (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures(exposures);
        if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
      } else {
        (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures([]);
      }
    } catch (error) {
      console.error('[Intelligence] Population exposure fetch failed:', error);
      dataFreshness.recordError('worldpop', String(error));
    }

    (this.ctx.panels['cii'] as CIIPanel)?.refresh();
    console.log('[Intelligence] All signals loaded for CII calculation');
  }

  async loadHungerData(): Promise<void> {
    try {
      const zones = await getAIHungerZones();
      if (zones.length > 0) {
        this.ctx.map?.setHungerZones(zones);
        this.ctx.map?.setLayerReady('hunger', true);
        console.log(`[DataLoader] Hunger zones loaded: ${zones.length}`);
      } else {
        this.loadFallbackHunger();
      }
    } catch (e) {
      console.warn('[DataLoader] Hunger data failed:', e);
      this.loadFallbackHunger();
    }
  }

  async loadNaturalResources(): Promise<void> {
    try {
      const resources = await getAINaturalResources();
      if (resources.length > 0) {
        this.ctx.map?.setNaturalResources(resources);
        this.ctx.map?.setLayerReady('naturalResources', true);
        console.log(`[DataLoader] Natural resources loaded: ${resources.length}`);
      } else {
        this.loadFallbackNaturalResources();
      }
    } catch (e) {
      console.warn('[DataLoader] Natural resources data failed:', e);
      this.loadFallbackNaturalResources();
    }
  }

  private loadFallbackNaturalResources(): void {
    const fallback = [
      // Nigeria — comprehensive natural resources
      { id: 'nr-ng1', resource: 'Crude Oil', type: 'oil', country: 'Nigeria', region: 'Niger Delta', lat: 5.3, lon: 6.5, production: '1.4M bbl/day', globalShare: '1.7%', significance: "Africa's largest oil producer, OPEC member" },
      { id: 'nr-ng2', resource: 'Natural Gas', type: 'gas', country: 'Nigeria', region: 'Bonny Island LNG', lat: 4.43, lon: 7.17, production: '28B m³/yr', globalShare: '1.3%', significance: 'Major LNG exporter to Europe & Asia' },
      { id: 'nr-ng3', resource: 'Gold', type: 'gold', country: 'Nigeria', region: 'Zamfara & Osun', lat: 12.17, lon: 6.25, production: '3 tonnes/yr', globalShare: '0.1%', significance: 'Emerging artisanal gold sector' },
      { id: 'nr-ng4', resource: 'Tin & Columbite', type: 'iron', country: 'Nigeria', region: 'Jos Plateau', lat: 9.92, lon: 8.89, production: '5K tonnes/yr', globalShare: '2%', significance: 'Historic tin mining region' },
      { id: 'nr-ng5', resource: 'Bitumen', type: 'oil', country: 'Nigeria', region: 'Ondo State', lat: 6.8, lon: 4.8, production: 'Undeveloped', globalShare: '2nd largest reserves', significance: '42B barrels estimated reserves' },
      { id: 'nr-ng6', resource: 'Coal', type: 'iron', country: 'Nigeria', region: 'Enugu State', lat: 6.44, lon: 7.5, production: '50K tonnes/yr', globalShare: '<0.1%', significance: 'Sub-bituminous coal deposits' },
      // Saudi Arabia & Gulf
      { id: 'nr-1', resource: 'Crude Oil', type: 'oil', country: 'Saudi Arabia', region: 'Ghawar Field', lat: 25.4, lon: 49.6, production: '10.8M bbl/day', globalShare: '12%', significance: 'Largest conventional oil field' },
      { id: 'nr-uae', resource: 'Crude Oil', type: 'oil', country: 'UAE', region: 'Abu Dhabi Offshore', lat: 24.4, lon: 54.3, production: '3.2M bbl/day', globalShare: '3.8%', significance: 'ADNOC expanding capacity' },
      { id: 'nr-qatar', resource: 'Natural Gas', type: 'gas', country: 'Qatar', region: 'North Field', lat: 26.0, lon: 52.0, production: '177B m³/yr', globalShare: '4.5%', significance: "World's largest LNG exporter" },
      { id: 'nr-iraq', resource: 'Crude Oil', type: 'oil', country: 'Iraq', region: 'Basra Terminals', lat: 30.5, lon: 47.8, production: '4.5M bbl/day', globalShare: '5%', significance: 'Major OPEC producer' },
      // Americas
      { id: 'nr-2', resource: 'Crude Oil', type: 'oil', country: 'USA', region: 'Permian Basin', lat: 31.9, lon: -101.9, production: '13.2M bbl/day', globalShare: '14%', significance: 'Top global producer' },
      { id: 'nr-usgas', resource: 'Natural Gas', type: 'gas', country: 'USA', region: 'Marcellus Shale', lat: 41.2, lon: -77.0, production: '934B m³/yr', globalShare: '24%', significance: 'Largest gas producer globally' },
      { id: 'nr-brazil', resource: 'Crude Oil', type: 'oil', country: 'Brazil', region: 'Santos Pre-salt', lat: -25.0, lon: -43.0, production: '3.0M bbl/day', globalShare: '3.5%', significance: 'Deepwater pre-salt fields' },
      { id: 'nr-can', resource: 'Crude Oil', type: 'oil', country: 'Canada', region: 'Alberta Oil Sands', lat: 56.7, lon: -111.4, production: '3.8M bbl/day', globalShare: '4.5%', significance: '3rd largest oil reserves' },
      { id: 'nr-11', resource: 'Copper', type: 'copper', country: 'Chile', region: 'Atacama Desert', lat: -22.3, lon: -68.9, production: '5.3M tonnes/yr', globalShare: '27%', significance: 'Escondida mine' },
      { id: 'nr-peru', resource: 'Copper', type: 'copper', country: 'Peru', region: 'Apurimac', lat: -14.0, lon: -72.8, production: '2.4M tonnes/yr', globalShare: '10%', significance: 'Las Bambas mine' },
      { id: 'nr-li-cl', resource: 'Lithium', type: 'copper', country: 'Chile', region: 'Salar de Atacama', lat: -23.5, lon: -68.1, production: '26K tonnes/yr', globalShare: '22%', significance: 'Lithium brine extraction' },
      { id: 'nr-br-fe', resource: 'Iron Ore', type: 'iron', country: 'Brazil', region: 'Carajas Mine', lat: -6.0, lon: -50.3, production: '400M tonnes/yr', globalShare: '17%', significance: 'Largest iron ore mine globally' },
      // Russia & Eurasia
      { id: 'nr-3', resource: 'Crude Oil', type: 'oil', country: 'Russia', region: 'Western Siberia', lat: 61.0, lon: 73.0, production: '10.5M bbl/day', globalShare: '11%', significance: 'Under sanctions, pipeline exporter' },
      { id: 'nr-ru-dia', resource: 'Diamonds', type: 'diamond', country: 'Russia', region: 'Yakutia', lat: 62.0, lon: 130.0, production: '30M carats/yr', globalShare: '25%', significance: 'ALROSA — largest diamond producer' },
      { id: 'nr-14', resource: 'Uranium', type: 'uranium', country: 'Kazakhstan', region: 'South Kazakhstan', lat: 44.0, lon: 66.9, production: '21K tonnes/yr', globalShare: '43%', significance: 'In-situ leach mining' },
      // Africa
      { id: 'nr-5', resource: 'Crude Oil', type: 'oil', country: 'Angola', region: 'Cabinda Province', lat: -5.6, lon: 12.2, production: '1.1M bbl/day', globalShare: '1.3%', significance: 'OPEC member' },
      { id: 'nr-libya', resource: 'Crude Oil', type: 'oil', country: 'Libya', region: 'Sirte Basin', lat: 29.0, lon: 18.0, production: '1.2M bbl/day', globalShare: '1.4%', significance: "Africa's largest proven reserves" },
      { id: 'nr-6', resource: 'Gold', type: 'gold', country: 'South Africa', region: 'Witwatersrand', lat: -26.2, lon: 28.0, production: '100 tonnes/yr', globalShare: '3%', significance: "World's deepest mines" },
      { id: 'nr-7', resource: 'Gold', type: 'gold', country: 'Ghana', region: 'Ashanti Region', lat: 6.7, lon: -1.6, production: '130 tonnes/yr', globalShare: '4%', significance: "Africa's largest gold producer" },
      { id: 'nr-9', resource: 'Cobalt', type: 'cobalt', country: 'DR Congo', region: 'Katanga Province', lat: -11.0, lon: 27.5, production: '130K tonnes/yr', globalShare: '73%', significance: 'Critical for EV batteries' },
      { id: 'nr-zambia', resource: 'Cobalt', type: 'cobalt', country: 'Zambia', region: 'Copperbelt', lat: -12.8, lon: 28.2, production: '6K tonnes/yr', globalShare: '3%', significance: 'Copperbelt mines' },
      { id: 'nr-10', resource: 'Diamonds', type: 'diamond', country: 'Botswana', region: 'Jwaneng Mine', lat: -21.2, lon: 25.5, production: '24M carats/yr', globalShare: '15%', significance: 'Richest diamond mine by value' },
      { id: 'nr-15', resource: 'Bauxite', type: 'bauxite', country: 'Guinea', region: 'Boke Region', lat: 10.9, lon: -14.3, production: '110M tonnes/yr', globalShare: '28%', significance: "World's largest bauxite reserves" },
      { id: 'nr-18', resource: 'Platinum', type: 'platinum', country: 'South Africa', region: 'Bushveld Complex', lat: -25.0, lon: 29.5, production: '130 tonnes/yr', globalShare: '72%', significance: 'Dominates global supply' },
      { id: 'nr-mn', resource: 'Manganese', type: 'iron', country: 'South Africa', region: 'Kalahari Basin', lat: -27.5, lon: 22.5, production: '18M tonnes/yr', globalShare: '30%', significance: 'Largest reserves' },
      { id: 'nr-moz', resource: 'Natural Gas', type: 'gas', country: 'Mozambique', region: 'Rovuma Basin', lat: -11.3, lon: 40.5, production: '5B m³/yr', globalShare: '0.1%', significance: 'Major LNG development' },
      // Asia-Pacific
      { id: 'nr-19', resource: 'Rare Earths', type: 'cobalt', country: 'China', region: 'Inner Mongolia', lat: 40.8, lon: 109.9, production: '210K tonnes/yr', globalShare: '60%', significance: 'Bayan Obo mine — global dominance' },
      { id: 'nr-cn-gold', resource: 'Gold', type: 'gold', country: 'China', region: 'Shandong Province', lat: 36.7, lon: 117.0, production: '330 tonnes/yr', globalShare: '10%', significance: "World's largest gold producer" },
      { id: 'nr-in-coal', resource: 'Coal', type: 'iron', country: 'India', region: 'Jharkhand', lat: 23.6, lon: 85.3, production: '900M tonnes/yr', globalShare: '10%', significance: '2nd largest coal producer' },
      { id: 'nr-12', resource: 'Iron Ore', type: 'iron', country: 'Australia', region: 'Pilbara', lat: -22.3, lon: 118.3, production: '900M tonnes/yr', globalShare: '38%', significance: 'BHP & Rio Tinto operations' },
      { id: 'nr-20', resource: 'Lithium', type: 'copper', country: 'Australia', region: 'Greenbushes', lat: -33.8, lon: 116.1, production: '55K tonnes/yr', globalShare: '47%', significance: "World's largest lithium mine" },
      { id: 'nr-8', resource: 'Gold', type: 'gold', country: 'Australia', region: 'Kalgoorlie', lat: -31.9, lon: 121.5, production: '310 tonnes/yr', globalShare: '10%', significance: 'Super Pit mine' },
      { id: 'nr-23', resource: 'Nickel', type: 'cobalt', country: 'Indonesia', region: 'Sulawesi', lat: -2.5, lon: 121.5, production: '1.6M tonnes/yr', globalShare: '48%', significance: 'Dominant global smelting hub' },
      { id: 'nr-22', resource: 'Tin', type: 'iron', country: 'Indonesia', region: 'Bangka Island', lat: -2.1, lon: 106.1, production: '52K tonnes/yr', globalShare: '22%', significance: 'Electronics supply chain' },
      // Europe
      { id: 'nr-norway', resource: 'Natural Gas', type: 'gas', country: 'Norway', region: 'North Sea', lat: 61.5, lon: 3.5, production: '114B m³/yr', globalShare: '3%', significance: "Europe's key gas supplier" },
    ];
    this.ctx.map?.setNaturalResources(fallback);
    this.ctx.map?.setLayerReady('naturalResources', true);
    console.log('[DataLoader] Natural resources: fallback data loaded (41 deposits)');
  }

  private loadFallbackWeather(): void {
    const now = new Date();
    const alerts = [
      { id: 'w-1', event: 'Tropical Cyclone', severity: 'Extreme' as const, headline: 'Tropical cyclone warning — Western Pacific', description: 'Category 3 tropical cyclone approaching Philippines', areaDesc: 'Western Pacific', onset: now, expires: new Date(now.getTime() + 86400000), coordinates: [[125.5, 12.5]] as [number, number][], centroid: [125.5, 12.5] as [number, number] },
      { id: 'w-2', event: 'Heat Wave', severity: 'Severe' as const, headline: 'Extreme heat — South Asia', description: 'Temperatures exceeding 45°C across northern India', areaDesc: 'Northern India', onset: now, expires: new Date(now.getTime() + 172800000), coordinates: [[77.2, 28.6]] as [number, number][], centroid: [77.2, 28.6] as [number, number] },
      { id: 'w-3', event: 'Flooding', severity: 'Severe' as const, headline: 'Flash flood warning — East Africa', description: 'Heavy rainfall causing severe flooding in Kenya', areaDesc: 'East Africa', onset: now, expires: new Date(now.getTime() + 86400000), coordinates: [[36.8, -1.3]] as [number, number][], centroid: [36.8, -1.3] as [number, number] },
      { id: 'w-4', event: 'Severe Thunderstorm', severity: 'Moderate' as const, headline: 'Severe thunderstorms — Central US', description: 'Tornado-producing supercells expected across Tornado Alley', areaDesc: 'Central United States', onset: now, expires: new Date(now.getTime() + 43200000), coordinates: [[-97.5, 35.5]] as [number, number][], centroid: [-97.5, 35.5] as [number, number] },
      { id: 'w-5', event: 'Wildfire', severity: 'Extreme' as const, headline: 'Wildfire danger — Mediterranean', description: 'Extreme fire risk across southern Europe', areaDesc: 'Southern Europe', onset: now, expires: new Date(now.getTime() + 172800000), coordinates: [[23.7, 38.0]] as [number, number][], centroid: [23.7, 38.0] as [number, number] },
      { id: 'w-6', event: 'Blizzard', severity: 'Severe' as const, headline: 'Blizzard warning — Siberia', description: 'Heavy snowfall and high winds across western Siberia', areaDesc: 'Western Siberia', onset: now, expires: new Date(now.getTime() + 86400000), coordinates: [[73.4, 61.0]] as [number, number][], centroid: [73.4, 61.0] as [number, number] },
      { id: 'w-7', event: 'Drought', severity: 'Moderate' as const, headline: 'Drought conditions — Horn of Africa', description: 'Prolonged drought affecting Somalia and Ethiopia', areaDesc: 'Horn of Africa', onset: now, expires: new Date(now.getTime() + 604800000), coordinates: [[45.0, 5.0]] as [number, number][], centroid: [45.0, 5.0] as [number, number] },
      { id: 'w-8', event: 'Tsunami Warning', severity: 'Extreme' as const, headline: 'Tsunami advisory — South Pacific', description: 'Minor tsunami waves following 7.2 earthquake near Tonga', areaDesc: 'South Pacific', onset: now, expires: new Date(now.getTime() + 21600000), coordinates: [[-175.2, -21.2]] as [number, number][], centroid: [-175.2, -21.2] as [number, number] },
    ];
    this.ctx.map?.setWeatherAlerts(alerts);
    this.ctx.map?.setLayerReady('weather', true);
    console.log('[DataLoader] Weather: fallback data loaded (8 alerts)');
  }

  private loadFallbackProtests(): void {
    const now = new Date();
    const events: SocialUnrestEvent[] = [
      { id: 'p-1', title: 'Anti-government protests in Dhaka', eventType: 'protest', country: 'Bangladesh', city: 'Dhaka', lat: 23.8, lon: 90.4, time: now, severity: 'high', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-2', title: 'Cost of living demonstrations in Nairobi', eventType: 'demonstration', country: 'Kenya', city: 'Nairobi', lat: -1.3, lon: 36.8, time: now, severity: 'medium', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-3', title: 'Labour strikes in Paris', eventType: 'strike', country: 'France', city: 'Paris', lat: 48.9, lon: 2.3, time: now, severity: 'medium', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'high', validated: false },
      { id: 'p-4', title: 'Pro-democracy rally in Caracas', eventType: 'protest', country: 'Venezuela', city: 'Caracas', lat: 10.5, lon: -66.9, time: now, severity: 'high', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-5', title: 'Student protests in Bogotá', eventType: 'demonstration', country: 'Colombia', city: 'Bogotá', lat: 4.7, lon: -74.1, time: now, severity: 'low', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-6', title: 'Anti-austerity marches in Buenos Aires', eventType: 'protest', country: 'Argentina', city: 'Buenos Aires', lat: -34.6, lon: -58.4, time: now, severity: 'medium', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'high', validated: false },
      { id: 'p-7', title: 'Farmers protest in New Delhi', eventType: 'protest', country: 'India', city: 'New Delhi', lat: 28.6, lon: 77.2, time: now, severity: 'high', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'high', validated: false },
      { id: 'p-8', title: 'Environmental protests in Jakarta', eventType: 'demonstration', country: 'Indonesia', city: 'Jakarta', lat: -6.2, lon: 106.8, time: now, severity: 'low', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-9', title: 'Civil unrest in Khartoum', eventType: 'civil_unrest', country: 'Sudan', city: 'Khartoum', lat: 15.6, lon: 32.5, time: now, severity: 'high', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-10', title: 'Public sector strikes in Lagos', eventType: 'strike', country: 'Nigeria', city: 'Lagos', lat: 6.5, lon: 3.4, time: now, severity: 'medium', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
      { id: 'p-11', title: 'Anti-corruption rallies in São Paulo', eventType: 'protest', country: 'Brazil', city: 'São Paulo', lat: -23.5, lon: -46.6, time: now, severity: 'medium', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'high', validated: false },
      { id: 'p-12', title: 'Healthcare worker demonstrations in Manila', eventType: 'demonstration', country: 'Philippines', city: 'Manila', lat: 14.6, lon: 121.0, time: now, severity: 'low', sources: ['gdelt'], sourceType: 'gdelt', confidence: 'medium', validated: false },
    ];
    this.ctx.map?.setProtests(events);
    this.ctx.map?.setLayerReady('protests', true);
    console.log('[DataLoader] Protests: fallback data loaded (12 events)');
  }

  private loadFallbackFlights(): void {
    const now = new Date();
    const delays: AirportDelayAlert[] = [
      { id: 'f-1', iata: 'JFK', icao: 'KJFK', name: 'John F. Kennedy Intl', city: 'New York', country: 'US', lat: 40.6, lon: -73.8, region: 'americas', delayType: 'departure_delay', severity: 'moderate', avgDelayMinutes: 45, source: 'faa', updatedAt: now },
      { id: 'f-2', iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'UK', lat: 51.5, lon: -0.5, region: 'europe', delayType: 'arrival_delay', severity: 'minor', avgDelayMinutes: 25, source: 'eurocontrol', updatedAt: now },
      { id: 'f-3', iata: 'DXB', icao: 'OMDB', name: 'Dubai Intl', city: 'Dubai', country: 'UAE', lat: 25.3, lon: 55.4, region: 'mena', delayType: 'ground_delay', severity: 'moderate', avgDelayMinutes: 35, source: 'computed', updatedAt: now },
      { id: 'f-4', iata: 'HND', icao: 'RJTT', name: 'Tokyo Haneda', city: 'Tokyo', country: 'Japan', lat: 35.6, lon: 139.8, region: 'apac', delayType: 'departure_delay', severity: 'minor', avgDelayMinutes: 20, source: 'computed', updatedAt: now },
      { id: 'f-5', iata: 'ORD', icao: 'KORD', name: "O'Hare Intl", city: 'Chicago', country: 'US', lat: 42.0, lon: -87.9, region: 'americas', delayType: 'ground_stop', severity: 'major', avgDelayMinutes: 90, reason: 'Severe weather', source: 'faa', updatedAt: now },
      { id: 'f-6', iata: 'CDG', icao: 'LFPG', name: 'Charles de Gaulle', city: 'Paris', country: 'France', lat: 49.0, lon: 2.6, region: 'europe', delayType: 'departure_delay', severity: 'minor', avgDelayMinutes: 15, source: 'eurocontrol', updatedAt: now },
      { id: 'f-7', iata: 'SIN', icao: 'WSSS', name: 'Changi', city: 'Singapore', country: 'Singapore', lat: 1.4, lon: 104.0, region: 'apac', delayType: 'arrival_delay', severity: 'minor', avgDelayMinutes: 18, source: 'computed', updatedAt: now },
      { id: 'f-8', iata: 'ATL', icao: 'KATL', name: 'Hartsfield-Jackson', city: 'Atlanta', country: 'US', lat: 33.6, lon: -84.4, region: 'americas', delayType: 'departure_delay', severity: 'moderate', avgDelayMinutes: 40, source: 'faa', updatedAt: now },
    ];
    this.ctx.map?.setFlightDelays(delays);
    this.ctx.map?.setLayerReady('flights', true);
    console.log('[DataLoader] Flights: fallback data loaded (8 delays)');
  }

  private loadFallbackOutages(): void {
    const now = new Date();
    const outages: InternetOutage[] = [
      { id: 'o-1', title: 'Internet disruption in Sudan', link: '', description: 'Nationwide internet shutdown amid conflict', pubDate: now, country: 'Sudan', lat: 15.6, lon: 32.5, severity: 'total', categories: ['government'] },
      { id: 'o-2', title: 'Connectivity issues in Myanmar', link: '', description: 'Partial internet blackout in multiple regions', pubDate: now, country: 'Myanmar', lat: 16.9, lon: 96.2, severity: 'major', categories: ['government'] },
      { id: 'o-3', title: 'Internet throttling in Iran', link: '', description: 'Social media platforms blocked nationwide', pubDate: now, country: 'Iran', lat: 35.7, lon: 51.4, severity: 'partial', categories: ['censorship'] },
      { id: 'o-4', title: 'Submarine cable damage — Red Sea', link: '', description: 'Undersea cable damage affecting East Africa connectivity', pubDate: now, country: 'Yemen', lat: 13.0, lon: 45.0, severity: 'major', categories: ['infrastructure'] },
      { id: 'o-5', title: 'Network disruption in Ethiopia', link: '', description: 'Internet slowdown in Tigray region', pubDate: now, country: 'Ethiopia', lat: 13.5, lon: 39.5, severity: 'partial', categories: ['conflict'] },
      { id: 'o-6', title: 'Internet restrictions in Russia', link: '', description: 'VPN and social media restrictions expanded', pubDate: now, country: 'Russia', lat: 55.8, lon: 37.6, severity: 'partial', categories: ['censorship'] },
    ];
    this.ctx.map?.setOutages(outages);
    this.ctx.map?.setLayerReady('outages', true);
    console.log('[DataLoader] Outages: fallback data loaded (6 events)');
  }

  private loadFallbackHunger(): void {
    const zones = [
      { id: 'h-1', country: 'Somalia', region: 'East Africa', lat: 2.0, lon: 45.3, level: 4, levelName: 'Emergency', populationAffected: 4200000, description: 'Severe drought and conflict-driven food crisis' },
      { id: 'h-2', country: 'Yemen', region: 'Middle East', lat: 15.4, lon: 44.2, level: 4, levelName: 'Emergency', populationAffected: 17400000, description: 'Ongoing conflict disrupting food supply chains' },
      { id: 'h-3', country: 'South Sudan', region: 'East Africa', lat: 6.9, lon: 31.6, level: 5, levelName: 'Famine', populationAffected: 7700000, description: 'Famine conditions in multiple states' },
      { id: 'h-4', country: 'Afghanistan', region: 'South Asia', lat: 33.9, lon: 67.7, level: 4, levelName: 'Emergency', populationAffected: 15300000, description: 'Economic collapse and drought' },
      { id: 'h-5', country: 'DR Congo', region: 'Central Africa', lat: -4.3, lon: 15.3, level: 4, levelName: 'Emergency', populationAffected: 26400000, description: 'Conflict and displacement driving food insecurity' },
      { id: 'h-6', country: 'Haiti', region: 'Caribbean', lat: 18.5, lon: -72.3, level: 4, levelName: 'Emergency', populationAffected: 4900000, description: 'Gang violence disrupting food distribution' },
      { id: 'h-7', country: 'Sudan', region: 'East Africa', lat: 15.6, lon: 32.5, level: 5, levelName: 'Famine', populationAffected: 18000000, description: 'Civil war causing widespread famine' },
      { id: 'h-8', country: 'Ethiopia', region: 'East Africa', lat: 9.0, lon: 38.7, level: 3, levelName: 'Crisis', populationAffected: 12600000, description: 'Drought and conflict in northern regions' },
      { id: 'h-9', country: 'Madagascar', region: 'Southern Africa', lat: -18.9, lon: 47.5, level: 3, levelName: 'Crisis', populationAffected: 1600000, description: 'Severe drought in southern regions' },
      { id: 'h-10', country: 'Myanmar', region: 'Southeast Asia', lat: 19.8, lon: 96.2, level: 3, levelName: 'Crisis', populationAffected: 3400000, description: 'Conflict disrupting agriculture and trade' },
    ];
    this.ctx.map?.setHungerZones(zones);
    this.ctx.map?.setLayerReady('hunger', true);
    console.log('[DataLoader] Hunger: fallback data loaded (10 zones)');
  }

  private loadFallbackMilitary(): void {
    const flights = [
      { id: 'fm-1', callsign: 'FORTE12', lat: 46.5, lon: 36.8, altitude: 55000, heading: 90, speed: 350, verticalRate: 0, squawk: '', aircraftType: 'RQ-4 Global Hawk', origin: 'USA', timestamp: new Date(), onGround: false, category: 'surveillance' as const, significance: 'routine' as const },
      { id: 'fm-2', callsign: 'JAKE11', lat: 35.2, lon: 33.5, altitude: 25000, heading: 180, speed: 450, verticalRate: 0, squawk: '', aircraftType: 'RC-135', origin: 'USA', timestamp: new Date(), onGround: false, category: 'surveillance' as const, significance: 'routine' as const },
      { id: 'fm-3', callsign: 'LAGR223', lat: 55.3, lon: 38.2, altitude: 30000, heading: 270, speed: 400, verticalRate: 0, squawk: '', aircraftType: 'Il-76', origin: 'Russia', timestamp: new Date(), onGround: false, category: 'transport' as const, significance: 'routine' as const },
      { id: 'fm-4', callsign: 'DRAGON01', lat: 24.5, lon: 120.3, altitude: 35000, heading: 45, speed: 480, verticalRate: 0, squawk: '', aircraftType: 'P-8 Poseidon', origin: 'USA', timestamp: new Date(), onGround: false, category: 'surveillance' as const, significance: 'notable' as const },
      { id: 'fm-5', callsign: 'RAF201', lat: 53.5, lon: -1.5, altitude: 22000, heading: 120, speed: 400, verticalRate: 0, squawk: '', aircraftType: 'RC-135W', origin: 'UK', timestamp: new Date(), onGround: false, category: 'surveillance' as const, significance: 'routine' as const },
      { id: 'fm-6', callsign: 'NAVY05', lat: 10.5, lon: 65.2, altitude: 30000, heading: 200, speed: 420, verticalRate: 0, squawk: '', aircraftType: 'P-8A Poseidon', origin: 'USA', timestamp: new Date(), onGround: false, category: 'surveillance' as const, significance: 'routine' as const },
      { id: 'fm-7', callsign: 'FRAIR22', lat: 44.0, lon: 5.0, altitude: 38000, heading: 90, speed: 550, verticalRate: 0, squawk: '', aircraftType: 'Rafale', origin: 'France', timestamp: new Date(), onGround: false, category: 'fighter' as const, significance: 'routine' as const },
      { id: 'fm-8', callsign: 'SIGNT07', lat: 60.5, lon: 25.0, altitude: 40000, heading: 0, speed: 380, verticalRate: 0, squawk: '', aircraftType: 'RC-37', origin: 'USA', timestamp: new Date(), onGround: false, category: 'surveillance' as const, significance: 'notable' as const },
    ];
    this.ctx.map?.setMilitaryFlights(flights as any, []);
    this.ctx.map?.setLayerReady('military', true);
    console.log('[DataLoader] Military: fallback data loaded (8 flights)');
  }

  private loadFallbackCyber(): void {
    const threats = [
      { id: 'ct-1', name: 'APT29 Campaign', type: 'APT', severity: 'Critical', country: 'Russia', lat: 55.75, lon: 37.62, source: 'Intelligence', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-2', name: 'Ransomware Wave', type: 'Ransomware', severity: 'High', country: 'UK', lat: 51.51, lon: -0.12, source: 'CERT', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-3', name: 'DDoS Attack', type: 'DDoS', severity: 'Medium', country: 'Singapore', lat: 1.35, lon: 103.82, source: 'Intelligence', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-4', name: 'Supply Chain Compromise', type: 'Supply Chain', severity: 'Critical', country: 'USA', lat: 37.77, lon: -122.42, source: 'CERT', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-5', name: 'APT41 Intrusion', type: 'APT', severity: 'Critical', country: 'China', lat: 39.9, lon: 116.4, source: 'Intelligence', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-6', name: 'Wiper Malware', type: 'Wiper', severity: 'Critical', country: 'Ukraine', lat: 50.45, lon: 30.52, source: 'CERT', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-7', name: 'Banking Trojan', type: 'Trojan', severity: 'High', country: 'Brazil', lat: -23.55, lon: -46.63, source: 'Intelligence', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-8', name: 'Zero-Day Exploit', type: 'Zero-Day', severity: 'Critical', country: 'South Korea', lat: 37.57, lon: 126.98, source: 'CERT', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-9', name: 'IoT Botnet', type: 'Botnet', severity: 'Medium', country: 'Netherlands', lat: 52.37, lon: 4.89, source: 'Intelligence', firstSeen: new Date(), lastSeen: new Date() },
      { id: 'ct-10', name: 'Phishing Campaign', type: 'Phishing', severity: 'High', country: 'Japan', lat: 35.68, lon: 139.69, source: 'CERT', firstSeen: new Date(), lastSeen: new Date() },
    ];
    this.ctx.map?.setCyberThreats(threats as any);
    this.ctx.map?.setLayerReady('cyberThreats', true);
    console.log('[DataLoader] Cyber threats: fallback data loaded (10 threats)');
  }

  private loadFallbackFires(): void {
    const today = new Date().toISOString().split('T')[0];
    const fires = [
      { lat: -34.6, lon: 138.6, brightness: 350, frp: 120, confidence: 90, region: 'South Australia', acq_date: today, daynight: 'D' },
      { lat: -12.5, lon: -55.0, brightness: 320, frp: 95, confidence: 85, region: 'Amazon Brazil', acq_date: today, daynight: 'D' },
      { lat: 36.5, lon: -121.5, brightness: 380, frp: 200, confidence: 95, region: 'California USA', acq_date: today, daynight: 'D' },
      { lat: -2.5, lon: 112.0, brightness: 340, frp: 80, confidence: 70, region: 'Kalimantan Indonesia', acq_date: today, daynight: 'D' },
      { lat: 37.5, lon: 23.5, brightness: 310, frp: 70, confidence: 80, region: 'Greece', acq_date: today, daynight: 'D' },
      { lat: -8.5, lon: 25.0, brightness: 330, frp: 85, confidence: 75, region: 'DRC Central Africa', acq_date: today, daynight: 'D' },
      { lat: 62.0, lon: 130.0, brightness: 290, frp: 60, confidence: 65, region: 'Yakutia Russia', acq_date: today, daynight: 'N' },
      { lat: 9.0, lon: 7.5, brightness: 305, frp: 75, confidence: 80, region: 'Nigeria', acq_date: today, daynight: 'D' },
      { lat: -20.0, lon: 30.0, brightness: 315, frp: 65, confidence: 70, region: 'Zimbabwe', acq_date: today, daynight: 'D' },
      { lat: 55.0, lon: 85.0, brightness: 280, frp: 50, confidence: 60, region: 'Siberia Russia', acq_date: today, daynight: 'D' },
    ];
    this.ctx.map?.setFires(fires as any);
    this.ctx.map?.setLayerReady('fires', true);
    console.log('[DataLoader] Fires: fallback data loaded (10 hotspots)');
  }

  async loadOutages(): Promise<void> {
    if (this.ctx.intelligenceCache.outages) {
      const outages = this.ctx.intelligenceCache.outages;
      this.ctx.map?.setOutages(outages);
      this.ctx.map?.setLayerReady('outages', outages.length > 0);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      return;
    }
    try {
      const outages = await fetchInternetOutages();
      this.ctx.intelligenceCache.outages = outages;
      this.ctx.map?.setOutages(outages);
      this.ctx.map?.setLayerReady('outages', outages.length > 0);
      ingestOutagesForCII(outages);
      signalAggregator.ingestOutages(outages);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      dataFreshness.recordUpdate('outages', outages.length);
    } catch (error) {
      this.loadFallbackOutages();
    }
  }

  async loadCyberThreats(): Promise<void> {
    if (!CYBER_LAYER_ENABLED) {
      // Even without dedicated API, populate with AI/fallback data
      this.loadFallbackCyber();
      return;
    }

    if (this.ctx.cyberThreatsCache) {
      this.ctx.map?.setCyberThreats(this.ctx.cyberThreatsCache);
      this.ctx.map?.setLayerReady('cyberThreats', this.ctx.cyberThreatsCache.length > 0);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: this.ctx.cyberThreatsCache.length });
      return;
    }

    try {
      const threats = await fetchCyberThreats({ limit: 500, days: 14 });
      this.ctx.cyberThreatsCache = threats;
      this.ctx.map?.setCyberThreats(threats);
      this.ctx.map?.setLayerReady('cyberThreats', threats.length > 0);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: threats.length });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'ok' });
      dataFreshness.recordUpdate('cyber_threats', threats.length);
    } catch (error) {
      console.warn('[DataLoader] Cyber API failed, loading fallback:', error);
      this.loadFallbackCyber();
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'warning', errorMessage: 'Using AI-generated data' });
    }
  }

  async loadAisSignals(): Promise<void> {
    try {
      const { disruptions, density } = await fetchAisSignals();
      const aisStatus = getAisStatus();
      console.log('[Ships] Events:', { disruptions: disruptions.length, density: density.length, vessels: aisStatus.vessels });
      this.ctx.map?.setAisData(disruptions, density);
      signalAggregator.ingestAisDisruptions(disruptions);
      updateAndCheck([
        { type: 'ais_gaps', region: 'global', count: disruptions.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => { });

      const hasData = disruptions.length > 0 || density.length > 0;
      this.ctx.map?.setLayerReady('ais', hasData);

      const shippingCount = disruptions.length + density.length;
      const shippingStatus = shippingCount > 0 ? 'ok' : (aisStatus.connected ? 'warning' : 'error');
      this.ctx.statusPanel?.updateFeed('Shipping', {
        status: shippingStatus,
        itemCount: shippingCount,
        errorMessage: !aisStatus.connected && shippingCount === 0 ? 'AIS snapshot unavailable' : undefined,
      });
      this.ctx.statusPanel?.updateApi('AISStream', {
        status: aisStatus.connected ? 'ok' : 'warning',
      });
      if (hasData) {
        dataFreshness.recordUpdate('ais', shippingCount);
      }
    } catch (error) {
      this.ctx.map?.setLayerReady('ais', false);
      this.ctx.statusPanel?.updateFeed('Shipping', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('AISStream', { status: 'error' });
      dataFreshness.recordError('ais', String(error));
    }
  }

  waitForAisData(): void {
    const maxAttempts = 30;
    let attempts = 0;

    const checkData = () => {
      if (this.ctx.isDestroyed) return;
      attempts++;
      const status = getAisStatus();

      if (status.vessels > 0 || status.connected) {
        this.loadAisSignals();
        this.ctx.map?.setLayerLoading('ais', false);
        return;
      }

      if (attempts >= maxAttempts) {
        this.ctx.map?.setLayerLoading('ais', false);
        this.ctx.map?.setLayerReady('ais', false);
        this.ctx.statusPanel?.updateFeed('Shipping', {
          status: 'error',
          errorMessage: 'Connection timeout'
        });
        return;
      }

      setTimeout(checkData, 1000);
    };

    checkData();
  }

  async loadCableActivity(): Promise<void> {
    try {
      const activity = await fetchCableActivity();
      this.ctx.map?.setCableActivity(activity.advisories, activity.repairShips);
      const itemCount = activity.advisories.length + activity.repairShips.length;
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'error' });
    }
  }

  async loadCableHealth(): Promise<void> {
    try {
      const healthData = await fetchCableHealth();
      this.ctx.map?.setCableHealth(healthData.cables);
      const cableIds = Object.keys(healthData.cables);
      const faultCount = cableIds.filter((id) => healthData.cables[id]?.status === 'fault').length;
      const degradedCount = cableIds.filter((id) => healthData.cables[id]?.status === 'degraded').length;
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'ok', itemCount: faultCount + degradedCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'error' });
    }
  }

  async loadProtests(): Promise<void> {
    if (this.ctx.intelligenceCache.protests) {
      const protestData = this.ctx.intelligenceCache.protests;
      this.ctx.map?.setProtests(protestData.events);
      this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      return;
    }
    try {
      const protestData = await fetchProtestEvents();
      this.ctx.intelligenceCache.protests = protestData;
      this.ctx.map?.setProtests(protestData.events);
      this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      ingestProtests(protestData.events);
      ingestProtestsForCII(protestData.events);
      signalAggregator.ingestProtests(protestData.events);
      const protestCount = protestData.sources.acled + protestData.sources.gdelt;
      if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      (this.ctx.panels['cii'] as CIIPanel)?.refresh();
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
    } catch (error) {
      this.loadFallbackProtests();
    }
  }

  async loadFlightDelays(): Promise<void> {
    try {
      const delays = await fetchFlightDelays();
      if (delays.length > 0) {
        this.ctx.map?.setFlightDelays(delays);
        this.ctx.map?.setLayerReady('flights', true);
        this.ctx.statusPanel?.updateFeed('Flights', { status: 'ok', itemCount: delays.length });
      } else {
        this.loadFallbackFlights();
      }
    } catch (error) {
      this.loadFallbackFlights();
    }
  }

  async loadMilitary(): Promise<void> {
    if (this.ctx.intelligenceCache.military) {
      const { flights, flightClusters, vessels, vesselClusters } = this.ctx.intelligenceCache.military;
      this.ctx.map?.setMilitaryFlights(flights, flightClusters);
      this.ctx.map?.setMilitaryVessels(vessels, vesselClusters);
      this.ctx.map?.updateMilitaryForEscalation(flights, vessels);
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flights);
      const hasData = flights.length > 0 || vessels.length > 0;
      this.ctx.map?.setLayerReady('military', hasData);
      const militaryCount = flights.length + vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      return;
    }
    try {
      if (isMilitaryVesselTrackingConfigured()) {
        initMilitaryVesselStream();
      }
      const [flightData, vesselData] = await Promise.all([
        fetchMilitaryFlights(),
        fetchMilitaryVessels(),
      ]);
      this.ctx.intelligenceCache.military = {
        flights: flightData.flights,
        flightClusters: flightData.clusters,
        vessels: vesselData.vessels,
        vesselClusters: vesselData.clusters,
      };
      fetchUSNIFleetReport().then((report) => {
        if (report) this.ctx.intelligenceCache.usniFleet = report;
      }).catch(() => {});
      this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
      this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
      ingestFlights(flightData.flights);
      ingestVessels(vesselData.vessels);
      ingestMilitaryForCII(flightData.flights, vesselData.vessels);
      signalAggregator.ingestFlights(flightData.flights);
      signalAggregator.ingestVessels(vesselData.vessels);
      updateAndCheck([
        { type: 'military_flights', region: 'global', count: flightData.flights.length },
        { type: 'vessels', region: 'global', count: vesselData.vessels.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => { });
      this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
      (this.ctx.panels['cii'] as CIIPanel)?.refresh();
      if (!isInLearningMode()) {
        const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
        if (surgeAlerts.length > 0) {
          const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
          addToSignalHistory(surgeSignals);
          if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
        }
        const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
        if (foreignAlerts.length > 0) {
          const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
          addToSignalHistory(foreignSignals);
          if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
        }
      }

      this.loadCachedPosturesForBanner();
      const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flightData.flights);

      const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
      this.ctx.map?.setLayerReady('military', hasData);
      const militaryCount = flightData.flights.length + vesselData.vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      dataFreshness.recordUpdate('opensky', flightData.flights.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('military', false);
      this.ctx.statusPanel?.updateFeed('Military', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'error' });
      dataFreshness.recordError('opensky', String(error));
    }
  }

  private async loadCachedPosturesForBanner(): Promise<void> {
    try {
      const data = await fetchCachedTheaterPosture();
      if (data && data.postures.length > 0) {
        this.callbacks.renderCriticalBanner(data.postures);
        const posturePanel = this.ctx.panels['strategic-posture'] as StrategicPosturePanel | undefined;
        posturePanel?.updatePostures(data);
      }
    } catch (error) {
      console.warn('[App] Failed to load cached postures for banner:', error);
    }
  }

  async loadFredData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    const cbInfo = getCircuitBreakerCooldownInfo('FRED Economic');
    if (cbInfo.onCooldown) {
      economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${cbInfo.remainingSeconds}s)`);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      return;
    }

    try {
      economicPanel?.setLoading(true);
      const data = await fetchFredData();

      const postInfo = getCircuitBreakerCooldownInfo('FRED Economic');
      if (postInfo.onCooldown) {
        economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${postInfo.remainingSeconds}s)`);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      if (data.length === 0) {
        if (!isFeatureAvailable('economicFred')) {
          economicPanel?.setErrorState(true, 'FRED_API_KEY not configured — add in Settings');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.showRetrying();
        await new Promise(r => setTimeout(r, 20_000));
        const retryData = await fetchFredData();
        if (retryData.length === 0) {
          economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.setErrorState(false);
        economicPanel?.update(retryData);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
        dataFreshness.recordUpdate('economic', retryData.length);
        return;
      }

      economicPanel?.setErrorState(false);
      economicPanel?.update(data);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
      dataFreshness.recordUpdate('economic', data.length);
    } catch {
      if (isFeatureAvailable('economicFred')) {
        economicPanel?.showRetrying();
        try {
          await new Promise(r => setTimeout(r, 20_000));
          const retryData = await fetchFredData();
          if (retryData.length > 0) {
            economicPanel?.setErrorState(false);
            economicPanel?.update(retryData);
            this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
            dataFreshness.recordUpdate('economic', retryData.length);
            return;
          }
        } catch { /* fall through */ }
      }
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
      economicPanel?.setLoading(false);
    }
  }

  async loadOilAnalytics(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchOilAnalytics();
      economicPanel?.updateOil(data);
      const hasData = !!(data.wtiPrice || data.brentPrice || data.usProduction || data.usInventory);
      this.ctx.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        const metricCount = [data.wtiPrice, data.brentPrice, data.usProduction, data.usInventory].filter(Boolean).length;
        dataFreshness.recordUpdate('oil', metricCount || 1);
      } else {
        dataFreshness.recordError('oil', 'Oil analytics returned no values');
      }
    } catch (e) {
      console.error('[App] Oil analytics failed:', e);
      this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
      dataFreshness.recordError('oil', String(e));
    }
  }

  async loadGovernmentSpending(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchRecentAwards({ daysBack: 7, limit: 15 });
      economicPanel?.updateSpending(data);
      this.ctx.statusPanel?.updateApi('USASpending', { status: data.awards.length > 0 ? 'ok' : 'error' });
      if (data.awards.length > 0) {
        dataFreshness.recordUpdate('spending', data.awards.length);
      } else {
        dataFreshness.recordError('spending', 'No awards returned');
      }
    } catch (e) {
      console.error('[App] Government spending failed:', e);
      this.ctx.statusPanel?.updateApi('USASpending', { status: 'error' });
      dataFreshness.recordError('spending', String(e));
    }
  }

  async loadBisData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchBisData();
      economicPanel?.updateBis(data);
      const hasData = data.policyRates.length > 0;
      this.ctx.statusPanel?.updateApi('BIS', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        dataFreshness.recordUpdate('bis', data.policyRates.length);
      }
    } catch (e) {
      console.error('[App] BIS data failed:', e);
      this.ctx.statusPanel?.updateApi('BIS', { status: 'error' });
      dataFreshness.recordError('bis', String(e));
    }
  }

  async loadTradePolicy(): Promise<void> {
    const tradePanel = this.ctx.panels['trade-policy'] as TradePolicyPanel | undefined;
    if (!tradePanel) return;

    try {
      const [restrictions, tariffs, flows, barriers] = await Promise.all([
        fetchTradeRestrictions([], 50),
        fetchTariffTrends('840', '156', '', 10),
        fetchTradeFlows('840', '156', 10),
        fetchTradeBarriers([], '', 50),
      ]);

      tradePanel.updateRestrictions(restrictions);
      tradePanel.updateTariffs(tariffs);
      tradePanel.updateFlows(flows);
      tradePanel.updateBarriers(barriers);

      const totalItems = restrictions.restrictions.length + tariffs.datapoints.length + flows.flows.length + barriers.barriers.length;
      const anyUnavailable = restrictions.upstreamUnavailable || tariffs.upstreamUnavailable || flows.upstreamUnavailable || barriers.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('WTO', { status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error' });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('wto_trade', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('wto_trade', 'WTO upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Trade policy failed:', e);
      this.ctx.statusPanel?.updateApi('WTO', { status: 'error' });
      dataFreshness.recordError('wto_trade', String(e));
    }
  }

  async loadSupplyChain(): Promise<void> {
    const scPanel = this.ctx.panels['supply-chain'] as SupplyChainPanel | undefined;
    if (!scPanel) return;

    try {
      const [shipping, chokepoints, minerals] = await Promise.allSettled([
        fetchShippingRates(),
        fetchChokepointStatus(),
        fetchCriticalMinerals(),
      ]);

      const shippingData = shipping.status === 'fulfilled' ? shipping.value : null;
      const chokepointData = chokepoints.status === 'fulfilled' ? chokepoints.value : null;
      const mineralsData = minerals.status === 'fulfilled' ? minerals.value : null;

      if (shippingData) scPanel.updateShippingRates(shippingData);
      if (chokepointData) scPanel.updateChokepointStatus(chokepointData);
      if (mineralsData) scPanel.updateCriticalMinerals(mineralsData);

      const totalItems = (shippingData?.indices.length || 0) + (chokepointData?.chokepoints.length || 0) + (mineralsData?.minerals.length || 0);
      const anyUnavailable = shippingData?.upstreamUnavailable || chokepointData?.upstreamUnavailable || mineralsData?.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('SupplyChain', { status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error' });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('supply_chain', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('supply_chain', 'Supply chain upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Supply chain failed:', e);
      this.ctx.statusPanel?.updateApi('SupplyChain', { status: 'error' });
      dataFreshness.recordError('supply_chain', String(e));
    }
  }


  async runCorrelationAnalysis(): Promise<void> {
    try {
      if (this.ctx.latestClusters.length === 0 && this.ctx.allNews.length > 0) {
        this.ctx.latestClusters = mlWorker.isAvailable
          ? await clusterNewsHybrid(this.ctx.allNews)
          : await analysisWorker.clusterNews(this.ctx.allNews);
      }

      if (this.ctx.latestClusters.length > 0) {
        ingestNewsForCII(this.ctx.latestClusters);
        dataFreshness.recordUpdate('gdelt', this.ctx.latestClusters.length);
        (this.ctx.panels['cii'] as CIIPanel)?.refresh();
      }

      const signals = await analysisWorker.analyzeCorrelations(
        this.ctx.latestClusters,
        this.ctx.latestPredictions,
        this.ctx.latestMarkets
      );

      let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
      if (!isInLearningMode()) {
        const geoAlerts = detectGeoConvergence(this.ctx.seenGeoAlerts);
        geoSignals = geoAlerts.map(geoConvergenceToSignal);
      }

      const keywordSpikeSignals = drainTrendingSignals();
      const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
      if (allSignals.length > 0) {
        addToSignalHistory(allSignals);
        if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(allSignals);
      }
    } catch (error) {
      console.error('[App] Correlation analysis failed:', error);
    }
  }

  async loadFirmsData(): Promise<void> {
    try {
      const fireResult = await fetchAllFires(1);
      if (fireResult.skipped) {
        this.ctx.panels['satellite-fires']?.showConfigError('NASA_FIRMS_API_KEY not configured — add in Settings');
        this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
        return;
      }
      const { regions, totalCount } = fireResult;
      if (totalCount > 0) {
        const flat = flattenFires(regions);
        const stats = computeRegionStats(regions);

        signalAggregator.ingestSatelliteFires(flat.map(f => ({
          lat: f.location?.latitude ?? 0,
          lon: f.location?.longitude ?? 0,
          brightness: f.brightness,
          frp: f.frp,
          region: f.region,
          acq_date: new Date(f.detectedAt).toISOString().slice(0, 10),
        })));

        this.ctx.map?.setFires(toMapFires(flat));

        (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update(stats, totalCount);

        dataFreshness.recordUpdate('firms', totalCount);

        updateAndCheck([
          { type: 'satellite_fires', region: 'global', count: totalCount },
        ]).then(anomalies => {
          if (anomalies.length > 0) {
            signalAggregator.ingestTemporalAnomalies(anomalies);
          }
        }).catch(() => { });
      } else {
        (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      }
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'ok' });
    } catch (e) {
      console.warn('[App] FIRMS load failed:', e);
      (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
      dataFreshness.recordError('firms', String(e));
    }
  }

  async loadPizzInt(): Promise<void> {
    try {
      const [status, tensions] = await Promise.all([
        fetchPizzIntStatus(),
        fetchGdeltTensions()
      ]);

      if (status.locationsMonitored === 0) {
        this.ctx.pizzintIndicator?.hide();
        this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
        dataFreshness.recordError('pizzint', 'No monitored locations returned');
        return;
      }

      this.ctx.pizzintIndicator?.show();
      this.ctx.pizzintIndicator?.updateStatus(status);
      this.ctx.pizzintIndicator?.updateTensions(tensions);
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'ok' });
      dataFreshness.recordUpdate('pizzint', Math.max(status.locationsMonitored, tensions.length));
    } catch (error) {
      console.error('[App] PizzINT load failed:', error);
      this.ctx.pizzintIndicator?.hide();
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
      dataFreshness.recordError('pizzint', String(error));
    }
  }

  syncDataFreshnessWithLayers(): void {
    for (const [layer, sourceIds] of Object.entries(LAYER_TO_SOURCE)) {
      const enabled = this.ctx.mapLayers[layer as keyof MapLayers] ?? false;
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
      }
    }

    if (!isAisConfigured()) {
      dataFreshness.setEnabled('ais', false);
    }
    if (isOutagesConfigured() === false) {
      dataFreshness.setEnabled('outages', false);
    }
  }

  private static readonly HAPPY_ITEMS_CACHE_KEY = 'happy-all-items';

  async hydrateHappyPanelsFromCache(): Promise<void> {
    try {
      type CachedItem = Omit<NewsItem, 'pubDate'> & { pubDate: number };
      const entry = await getPersistentCache<CachedItem[]>(DataLoaderManager.HAPPY_ITEMS_CACHE_KEY);
      if (!entry || !entry.data || entry.data.length === 0) return;
      if (Date.now() - entry.updatedAt > 24 * 60 * 60 * 1000) return;

      const items: NewsItem[] = entry.data.map(item => ({
        ...item,
        pubDate: new Date(item.pubDate),
      }));

      const scienceSources = ['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)'];
      this.ctx.breakthroughsPanel?.setItems(
        items.filter(item => scienceSources.includes(item.source) || item.happyCategory === 'science-health')
      );
      this.ctx.heroPanel?.setHeroStory(
        items.filter(item => item.happyCategory === 'humanity-kindness')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0]
      );
      this.ctx.digestPanel?.setStories(
        [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime()).slice(0, 5)
      );
      this.ctx.positivePanel?.renderPositiveNews(items);
    } catch (err) {
      console.warn('[App] Happy panel cache hydration failed:', err);
    }
  }

  private async loadHappySupplementaryAndRender(): Promise<void> {
    if (!this.ctx.positivePanel) return;

    const curated = [...this.ctx.happyAllItems];
    this.ctx.positivePanel.renderPositiveNews(curated);

    let supplementary: NewsItem[] = [];
    try {
      const gdeltTopics = await fetchAllPositiveTopicIntelligence();
      const gdeltItems: NewsItem[] = gdeltTopics.flatMap(topic =>
        topic.articles.map(article => ({
          source: 'GDELT',
          title: article.title,
          link: article.url,
          pubDate: article.date ? new Date(article.date) : new Date(),
          isAlert: false,
          imageUrl: article.image || undefined,
          happyCategory: classifyNewsItem('GDELT', article.title),
        }))
      );

      supplementary = await filterBySentiment(gdeltItems);
    } catch (err) {
      console.warn('[App] Happy supplementary pipeline failed, using curated only:', err);
    }

    if (supplementary.length > 0) {
      const merged = [...curated, ...supplementary];
      merged.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      this.ctx.positivePanel.renderPositiveNews(merged);
    }

    const scienceSources = ['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)'];
    const scienceItems = this.ctx.happyAllItems.filter(item =>
      scienceSources.includes(item.source) || item.happyCategory === 'science-health'
    );
    this.ctx.breakthroughsPanel?.setItems(scienceItems);

    const heroItem = this.ctx.happyAllItems
      .filter(item => item.happyCategory === 'humanity-kindness')
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0];
    this.ctx.heroPanel?.setHeroStory(heroItem);

    const digestItems = [...this.ctx.happyAllItems]
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, 5);
    this.ctx.digestPanel?.setStories(digestItems);

    setPersistentCache(
      DataLoaderManager.HAPPY_ITEMS_CACHE_KEY,
      this.ctx.happyAllItems.map(item => ({ ...item, pubDate: item.pubDate.getTime() }))
    ).catch(() => {});
  }

  private async loadPositiveEvents(): Promise<void> {
    const gdeltEvents = await fetchPositiveGeoEvents();
    const rssEvents = geocodePositiveNewsItems(
      this.ctx.happyAllItems.map(item => ({
        title: item.title,
        category: item.happyCategory,
      }))
    );
    const seen = new Set<string>();
    const merged = [...gdeltEvents, ...rssEvents].filter(e => {
      if (seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    });
    this.ctx.map?.setPositiveEvents(merged);
  }

  private loadKindnessData(): void {
    const kindnessItems = fetchKindnessData(
      this.ctx.happyAllItems.map(item => ({
        title: item.title,
        happyCategory: item.happyCategory,
      }))
    );
    this.ctx.map?.setKindnessData(kindnessItems);
  }

  private async loadProgressData(): Promise<void> {
    const datasets = await fetchProgressData();
    this.ctx.progressPanel?.setData(datasets);
  }

  private async loadSpeciesData(): Promise<void> {
    const species = await fetchConservationWins();
    this.ctx.speciesPanel?.setData(species);
    this.ctx.map?.setSpeciesRecoveryZones(species);
    if (SITE_VARIANT === 'happy' && species.length > 0) {
      checkMilestones({
        speciesRecoveries: species.map(s => ({ name: s.commonName, status: s.recoveryStatus })),
        newSpeciesCount: species.length,
      });
    }
  }

  private async loadRenewableData(): Promise<void> {
    const data = await fetchRenewableEnergyData();
    this.ctx.renewablePanel?.setData(data);
    if (SITE_VARIANT === 'happy' && data?.globalPercentage) {
      checkMilestones({
        renewablePercent: data.globalPercentage,
      });
    }
    try {
      const capacity = await fetchEnergyCapacity();
      this.ctx.renewablePanel?.setCapacityData(capacity);
    } catch {
      // EIA failure does not break the existing World Bank gauge
    }
  }
}
