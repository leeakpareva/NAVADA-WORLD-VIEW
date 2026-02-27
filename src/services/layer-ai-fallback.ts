/**
 * AI-powered fallback for map layer data.
 * Called when APIs return empty data for layers that should show activity.
 * Uses xAI Grok (primary) → OpenAI (fallback).
 * Results cached for 15 minutes.
 */

import { getSecretValue, isFeatureAvailable } from '@/services/runtime-config';

// ---- Types matching existing interfaces ----

export interface AIProtestEvent {
  id: string;
  title: string;
  lat: number;
  lon: number;
  country: string;
  date: string;
  size: string;
  type: string;
}

export interface AIMilitaryFlight {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number;
  type: string;
  country: string;
}

export interface AIWeatherAlert {
  id: string;
  event: string;
  lat: number;
  lon: number;
  severity: string;
  area: string;
  onset: string;
}

export interface AICyberThreat {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  severity: string;
  target: string;
}

export interface AIHungerZone {
  id: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  level: number; // IPC 1-5
  levelName: string;
  populationAffected: number;
  description: string;
}

export interface AIOutage {
  id: string;
  country: string;
  lat: number;
  lon: number;
  severity: string;
  usersAffected: number;
  provider: string;
}

export interface AIFlightDelay {
  id: string;
  airport: string;
  code: string;
  lat: number;
  lon: number;
  delayMinutes: number;
  reason: string;
}

export interface AINaturalResource {
  id: string;
  resource: string;
  type: string; // 'oil' | 'gold' | 'diamond' | 'copper' | 'cobalt' | 'uranium' | 'gas' | 'iron' | 'bauxite' | 'platinum'
  country: string;
  region: string;
  lat: number;
  lon: number;
  production: string;
  globalShare: string;
  significance: string;
}

interface AILayerCache {
  protests: AIProtestEvent[];
  military: AIMilitaryFlight[];
  weather: AIWeatherAlert[];
  cyber: AICyberThreat[];
  hunger: AIHungerZone[];
  outages: AIOutage[];
  flights: AIFlightDelay[];
  naturalResources: AINaturalResource[];
  timestamp: number;
}

const CACHE_TTL = 15 * 60 * 1000;
let cache: AILayerCache | null = null;
let fetchInProgress: Promise<AILayerCache | null> | null = null;

// ---- AI helpers ----

async function callAI(prompt: string): Promise<string | null> {
  // Try xAI
  if (isFeatureAvailable('aiXai')) {
    const key = getSecretValue('XAI_API_KEY');
    if (key) {
      const result = await doFetch('https://api.x.ai/v1/chat/completions', key, 'grok-3-mini-fast', prompt);
      if (result) return result;
    }
  }
  // Fallback OpenAI
  const oaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
  if (oaiKey) return doFetch('https://api.openai.com/v1/chat/completions', oaiKey, 'gpt-4o-mini', prompt);
  return null;
}

async function doFetch(url: string, key: string, model: string, prompt: string): Promise<string | null> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 4000, temperature: 0.3, messages: [{ role: 'user', content: prompt }] }),
      signal: abort.signal,
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    let raw = json.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    return raw;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

function tryParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

// ---- Fetch all layer data in one AI call ----

const LAYER_PROMPT = `Return ONLY valid JSON (no markdown, no code fences) with current global intelligence data for map visualization. Use realistic current data as of ${new Date().toISOString().split('T')[0]}. Provide comprehensive global coverage across all continents.

{
  "protests": [
    {"id":"p1","title":"Anti-government protests","lat":48.85,"lon":2.35,"country":"France","date":"2026-02-27","size":"10,000+","type":"political"},
    {"id":"p2","title":"Cost of living demonstrations","lat":51.51,"lon":-0.12,"country":"UK","date":"2026-02-26","size":"5,000+","type":"economic"},
    {"id":"p3","title":"Pro-democracy rally","lat":13.75,"lon":100.5,"country":"Thailand","date":"2026-02-25","size":"20,000+","type":"political"},
    {"id":"p4","title":"Workers strike","lat":52.52,"lon":13.4,"country":"Germany","date":"2026-02-27","size":"8,000+","type":"labor"},
    {"id":"p5","title":"Student protests","lat":-34.6,"lon":-58.38,"country":"Argentina","date":"2026-02-26","size":"15,000+","type":"education"},
    {"id":"p6","title":"Environmental activists","lat":35.68,"lon":139.69,"country":"Japan","date":"2026-02-25","size":"3,000+","type":"environment"},
    {"id":"p7","title":"Election protests","lat":6.52,"lon":3.38,"country":"Nigeria","date":"2026-02-27","size":"25,000+","type":"political"},
    {"id":"p8","title":"Housing crisis march","lat":40.42,"lon":-3.7,"country":"Spain","date":"2026-02-26","size":"12,000+","type":"economic"},
    {"id":"p9","title":"Anti-corruption rally","lat":-6.2,"lon":106.85,"country":"Indonesia","date":"2026-02-27","size":"30,000+","type":"political"},
    {"id":"p10","title":"Teachers strike","lat":-1.29,"lon":36.82,"country":"Kenya","date":"2026-02-26","size":"6,000+","type":"labor"},
    {"id":"p11","title":"Land reform protests","lat":-25.75,"lon":28.23,"country":"South Africa","date":"2026-02-27","size":"18,000+","type":"political"},
    {"id":"p12","title":"Healthcare workers strike","lat":19.43,"lon":-99.13,"country":"Mexico","date":"2026-02-26","size":"7,000+","type":"labor"},
    {"id":"p13","title":"Farmers protest","lat":28.61,"lon":77.21,"country":"India","date":"2026-02-27","size":"50,000+","type":"economic"},
    {"id":"p14","title":"Anti-austerity march","lat":37.98,"lon":23.73,"country":"Greece","date":"2026-02-25","size":"9,000+","type":"economic"},
    {"id":"p15","title":"Press freedom rally","lat":41.01,"lon":28.98,"country":"Turkey","date":"2026-02-26","size":"4,000+","type":"political"}
  ],
  "military": [
    {"id":"m1","callsign":"FORTE12","lat":46.5,"lon":36.8,"altitude":55000,"type":"RQ-4 Global Hawk","country":"USA"},
    {"id":"m2","callsign":"JAKE11","lat":35.2,"lon":33.5,"altitude":25000,"type":"RC-135","country":"USA"},
    {"id":"m3","callsign":"LAGR223","lat":55.3,"lon":38.2,"altitude":30000,"type":"Il-76","country":"Russia"},
    {"id":"m4","callsign":"CNV4382","lat":32.1,"lon":34.8,"altitude":28000,"type":"Boeing 707","country":"Israel"},
    {"id":"m5","callsign":"DRAGON01","lat":24.5,"lon":120.3,"altitude":35000,"type":"P-8 Poseidon","country":"USA"},
    {"id":"m6","callsign":"RAF201","lat":53.5,"lon":-1.5,"altitude":22000,"type":"RC-135W","country":"UK"},
    {"id":"m7","callsign":"NAVY05","lat":10.5,"lon":65.2,"altitude":30000,"type":"P-8A Poseidon","country":"USA"},
    {"id":"m8","callsign":"CHIAF01","lat":30.5,"lon":121.5,"altitude":25000,"type":"Y-20","country":"China"},
    {"id":"m9","callsign":"FRAIR22","lat":44.0,"lon":5.0,"altitude":38000,"type":"Rafale","country":"France"},
    {"id":"m10","callsign":"SIGNT07","lat":60.5,"lon":25.0,"altitude":40000,"type":"Gulfstream RC-37","country":"USA"}
  ],
  "weather": [
    {"id":"w1","event":"Severe Thunderstorm","lat":30.27,"lon":-97.74,"severity":"Severe","area":"Central Texas","onset":"2026-02-27T14:00:00Z"},
    {"id":"w2","event":"Winter Storm Warning","lat":42.36,"lon":-71.06,"severity":"Extreme","area":"New England","onset":"2026-02-27T06:00:00Z"},
    {"id":"w3","event":"Cyclone Warning","lat":-18.1,"lon":49.3,"severity":"Extreme","area":"Madagascar Coast","onset":"2026-02-27T00:00:00Z"},
    {"id":"w4","event":"Flood Advisory","lat":51.5,"lon":-0.1,"severity":"Moderate","area":"London Basin","onset":"2026-02-27T12:00:00Z"},
    {"id":"w5","event":"Heat Warning","lat":-33.87,"lon":151.21,"severity":"Severe","area":"Greater Sydney","onset":"2026-02-27T08:00:00Z"},
    {"id":"w6","event":"Typhoon Watch","lat":14.6,"lon":121.0,"severity":"Extreme","area":"Luzon Philippines","onset":"2026-02-27T18:00:00Z"},
    {"id":"w7","event":"Sandstorm Alert","lat":24.5,"lon":54.5,"severity":"Severe","area":"UAE & Oman","onset":"2026-02-27T10:00:00Z"},
    {"id":"w8","event":"Heavy Snowfall","lat":43.07,"lon":141.35,"severity":"Severe","area":"Hokkaido Japan","onset":"2026-02-27T04:00:00Z"},
    {"id":"w9","event":"Flooding","lat":-23.55,"lon":-46.63,"severity":"Severe","area":"Sao Paulo Brazil","onset":"2026-02-27T15:00:00Z"},
    {"id":"w10","event":"Ice Storm Warning","lat":45.5,"lon":-73.57,"severity":"Extreme","area":"Montreal Canada","onset":"2026-02-27T02:00:00Z"},
    {"id":"w11","event":"Wildfire Danger","lat":-34.6,"lon":138.6,"severity":"Extreme","area":"South Australia","onset":"2026-02-27T09:00:00Z"},
    {"id":"w12","event":"Dense Fog Advisory","lat":22.3,"lon":114.17,"severity":"Moderate","area":"Hong Kong","onset":"2026-02-27T20:00:00Z"}
  ],
  "cyber": [
    {"id":"c1","name":"APT29 Campaign","lat":55.75,"lon":37.62,"type":"APT","severity":"Critical","target":"Government Networks"},
    {"id":"c2","name":"Ransomware Wave","lat":51.51,"lon":-0.12,"type":"Ransomware","severity":"High","target":"Healthcare Sector"},
    {"id":"c3","name":"DDoS Attack","lat":1.35,"lon":103.82,"type":"DDoS","severity":"Medium","target":"Financial Services"},
    {"id":"c4","name":"Supply Chain Compromise","lat":37.77,"lon":-122.42,"type":"Supply Chain","severity":"Critical","target":"Software Vendors"},
    {"id":"c5","name":"Phishing Campaign","lat":35.68,"lon":139.69,"type":"Phishing","severity":"High","target":"Enterprise Email"},
    {"id":"c6","name":"APT41 Intrusion","lat":39.9,"lon":116.4,"type":"APT","severity":"Critical","target":"Telecom Infrastructure"},
    {"id":"c7","name":"Wiper Malware","lat":50.45,"lon":30.52,"type":"Wiper","severity":"Critical","target":"Energy Grid"},
    {"id":"c8","name":"Banking Trojan","lat":-23.55,"lon":-46.63,"type":"Trojan","severity":"High","target":"Banking Sector"},
    {"id":"c9","name":"IoT Botnet","lat":52.37,"lon":4.89,"type":"Botnet","severity":"Medium","target":"Smart Devices"},
    {"id":"c10","name":"Zero-Day Exploit","lat":37.57,"lon":126.98,"type":"Zero-Day","severity":"Critical","target":"Mobile Devices"}
  ],
  "hunger": [
    {"id":"h1","country":"Somalia","region":"Bay & Bakool","lat":2.05,"lon":45.32,"level":5,"levelName":"Famine","populationAffected":4800000,"description":"Severe drought and conflict-driven food crisis"},
    {"id":"h2","country":"Yemen","region":"Al Hudaydah","lat":14.8,"lon":42.95,"level":4,"levelName":"Emergency","populationAffected":17400000,"description":"Ongoing conflict disrupting food supply chains"},
    {"id":"h3","country":"South Sudan","region":"Unity State","lat":6.2,"lon":29.6,"level":4,"levelName":"Emergency","populationAffected":7700000,"description":"Flooding and civil conflict causing acute hunger"},
    {"id":"h4","country":"Afghanistan","region":"Badghis Province","lat":35.2,"lon":63.5,"level":4,"levelName":"Emergency","populationAffected":15300000,"description":"Economic collapse post-Taliban takeover"},
    {"id":"h5","country":"Haiti","region":"Grand Anse","lat":18.65,"lon":-74.12,"level":4,"levelName":"Emergency","populationAffected":4900000,"description":"Gang violence blocking food distribution"},
    {"id":"h6","country":"Sudan","region":"Darfur","lat":13.5,"lon":25.3,"level":5,"levelName":"Famine","populationAffected":18000000,"description":"Civil war and displacement causing mass starvation"},
    {"id":"h7","country":"DRC","region":"North Kivu","lat":-1.67,"lon":29.22,"level":4,"levelName":"Emergency","populationAffected":6900000,"description":"Armed conflict displacing farming communities"},
    {"id":"h8","country":"Myanmar","region":"Rakhine State","lat":20.15,"lon":92.9,"level":3,"levelName":"Crisis","populationAffected":3200000,"description":"Military operations restricting food access"},
    {"id":"h9","country":"Ethiopia","region":"Tigray","lat":13.5,"lon":39.5,"level":3,"levelName":"Crisis","populationAffected":5600000,"description":"Post-conflict recovery with food insecurity"},
    {"id":"h10","country":"Gaza","region":"Gaza Strip","lat":31.4,"lon":34.4,"level":5,"levelName":"Famine","populationAffected":2200000,"description":"Complete siege blocking humanitarian aid"},
    {"id":"h11","country":"Nigeria","region":"Borno State","lat":11.85,"lon":13.15,"level":3,"levelName":"Crisis","populationAffected":4100000,"description":"Boko Haram insurgency disrupting agriculture"},
    {"id":"h12","country":"Madagascar","region":"Grand Sud","lat":-24.3,"lon":45.1,"level":3,"levelName":"Crisis","populationAffected":1900000,"description":"Recurring drought in southern regions"},
    {"id":"h13","country":"Burkina Faso","region":"Sahel Region","lat":14.0,"lon":-1.5,"level":4,"levelName":"Emergency","populationAffected":3600000,"description":"Jihadist insurgency cutting off food supply"},
    {"id":"h14","country":"Mali","region":"Mopti & Gao","lat":14.5,"lon":-4.0,"level":3,"levelName":"Crisis","populationAffected":2100000,"description":"Armed groups controlling food corridors"},
    {"id":"h15","country":"Chad","region":"Lac Province","lat":13.5,"lon":14.0,"level":3,"levelName":"Crisis","populationAffected":2800000,"description":"Refugee influx from Sudan straining food supply"},
    {"id":"h16","country":"CAR","region":"Bangui Corridor","lat":4.4,"lon":18.6,"level":4,"levelName":"Emergency","populationAffected":2900000,"description":"Armed conflict disrupting food markets"},
    {"id":"h17","country":"Mozambique","region":"Cabo Delgado","lat":-12.3,"lon":40.5,"level":3,"levelName":"Crisis","populationAffected":1500000,"description":"Insurgency displacing farming communities"},
    {"id":"h18","country":"Syria","region":"Northwest Syria","lat":36.2,"lon":36.6,"level":4,"levelName":"Emergency","populationAffected":4200000,"description":"Conflict and economic collapse"}
  ],
  "outages": [
    {"id":"o1","country":"Pakistan","lat":30.2,"lon":69.3,"severity":"Major","usersAffected":12000000,"provider":"Multiple ISPs"},
    {"id":"o2","country":"Myanmar","lat":19.8,"lon":96.2,"severity":"Critical","usersAffected":8000000,"provider":"State-controlled"},
    {"id":"o3","country":"Iran","lat":35.7,"lon":51.4,"severity":"Moderate","usersAffected":5000000,"provider":"Government throttling"},
    {"id":"o4","country":"Cuba","lat":23.1,"lon":-82.4,"severity":"Major","usersAffected":3000000,"provider":"ETECSA"},
    {"id":"o5","country":"Ethiopia","lat":9.0,"lon":38.7,"severity":"Major","usersAffected":6000000,"provider":"Ethio Telecom"},
    {"id":"o6","country":"Russia","lat":55.75,"lon":37.62,"severity":"Moderate","usersAffected":4000000,"provider":"Roskomnadzor blocks"},
    {"id":"o7","country":"China","lat":31.23,"lon":121.47,"severity":"Moderate","usersAffected":15000000,"provider":"Great Firewall tightening"},
    {"id":"o8","country":"Sudan","lat":15.6,"lon":32.5,"severity":"Critical","usersAffected":9000000,"provider":"War-related outage"},
    {"id":"o9","country":"Venezuela","lat":10.5,"lon":-66.9,"severity":"Major","usersAffected":2500000,"provider":"CANTV"},
    {"id":"o10","country":"North Korea","lat":39.02,"lon":125.75,"severity":"Critical","usersAffected":25000000,"provider":"Total blackout"}
  ],
  "flights": [
    {"id":"f1","airport":"JFK International","code":"JFK","lat":40.64,"lon":-73.78,"delayMinutes":45,"reason":"Weather"},
    {"id":"f2","airport":"Heathrow","code":"LHR","lat":51.47,"lon":-0.46,"delayMinutes":30,"reason":"Congestion"},
    {"id":"f3","airport":"Dubai International","code":"DXB","lat":25.25,"lon":55.36,"delayMinutes":20,"reason":"Sandstorm"},
    {"id":"f4","airport":"O'Hare International","code":"ORD","lat":41.97,"lon":-87.91,"delayMinutes":60,"reason":"Snow"},
    {"id":"f5","airport":"Narita","code":"NRT","lat":35.76,"lon":140.39,"delayMinutes":25,"reason":"Wind"},
    {"id":"f6","airport":"Sao Paulo Guarulhos","code":"GRU","lat":-23.43,"lon":-46.47,"delayMinutes":55,"reason":"Thunderstorm"},
    {"id":"f7","airport":"Istanbul Airport","code":"IST","lat":41.26,"lon":28.74,"delayMinutes":35,"reason":"Fog"},
    {"id":"f8","airport":"Sydney Kingsford Smith","code":"SYD","lat":-33.95,"lon":151.18,"delayMinutes":40,"reason":"Heat restrictions"},
    {"id":"f9","airport":"Mumbai Chhatrapati Shivaji","code":"BOM","lat":19.09,"lon":72.87,"delayMinutes":50,"reason":"Visibility"},
    {"id":"f10","airport":"Lagos Murtala Muhammed","code":"LOS","lat":6.58,"lon":3.32,"delayMinutes":70,"reason":"Equipment failure"}
  ],
  "naturalResources": [
    {"id":"nr1","resource":"Crude Oil","type":"oil","country":"Nigeria","region":"Niger Delta","lat":5.3,"lon":6.5,"production":"1.4M bbl/day","globalShare":"1.7%","significance":"Africa's largest oil producer, OPEC member"},
    {"id":"nr2","resource":"Natural Gas","type":"gas","country":"Nigeria","region":"Bonny Island LNG","lat":4.43,"lon":7.17,"production":"28B m3/yr","globalShare":"1.3%","significance":"Major LNG exporter to Europe"},
    {"id":"nr3","resource":"Gold","type":"gold","country":"Nigeria","region":"Zamfara & Osun States","lat":12.17,"lon":6.25,"production":"3 tonnes/yr","globalShare":"0.1%","significance":"Emerging artisanal gold sector"},
    {"id":"nr4","resource":"Tin & Columbite","type":"iron","country":"Nigeria","region":"Jos Plateau","lat":9.92,"lon":8.89,"production":"5,000 tonnes/yr","globalShare":"2%","significance":"Historic tin mining region"},
    {"id":"nr5","resource":"Bitumen","type":"oil","country":"Nigeria","region":"Ondo State","lat":6.8,"lon":4.8,"production":"Undeveloped","globalShare":"Potential 2nd largest","significance":"Estimated 42B barrels of bitumen reserves"},
    {"id":"nr6","resource":"Cobalt","type":"cobalt","country":"DRC","region":"Katanga Province","lat":-11.0,"lon":27.5,"production":"130,000 tonnes/yr","globalShare":"73%","significance":"Dominates global cobalt supply for EV batteries"},
    {"id":"nr7","resource":"Diamond","type":"diamond","country":"Botswana","region":"Orapa Mine","lat":-21.3,"lon":25.4,"production":"23M carats/yr","globalShare":"18%","significance":"World's most valuable diamond mine"},
    {"id":"nr8","resource":"Oil","type":"oil","country":"Saudi Arabia","region":"Ghawar Field","lat":25.4,"lon":49.6,"production":"3.8M bbl/day","globalShare":"5%","significance":"World's largest conventional oil field"},
    {"id":"nr9","resource":"Natural Gas","type":"gas","country":"Qatar","region":"North Field","lat":26.0,"lon":52.0,"production":"77B m3/yr","globalShare":"4.5%","significance":"Largest non-associated gas field"},
    {"id":"nr10","resource":"Gold","type":"gold","country":"South Africa","region":"Witwatersrand Basin","lat":-26.2,"lon":28.0,"production":"100 tonnes/yr","globalShare":"5.2%","significance":"World's deepest gold mines"},
    {"id":"nr11","resource":"Gold","type":"gold","country":"Ghana","region":"Ashanti Region","lat":6.7,"lon":-1.6,"production":"80 tonnes/yr","globalShare":"3.4%","significance":"Africa's 2nd largest gold producer"},
    {"id":"nr12","resource":"Oil","type":"oil","country":"Russia","region":"Western Siberia","lat":61.0,"lon":73.0,"production":"9.7M bbl/day","globalShare":"12%","significance":"Major global oil producer under sanctions"},
    {"id":"nr13","resource":"Copper","type":"copper","country":"Chile","region":"Atacama Desert","lat":-23.6,"lon":-70.4,"production":"5.6M tonnes/yr","globalShare":"27%","significance":"World's largest copper producer"},
    {"id":"nr14","resource":"Iron Ore","type":"iron","country":"Australia","region":"Pilbara","lat":-22.3,"lon":118.6,"production":"900M tonnes/yr","globalShare":"37%","significance":"Largest iron ore exporter"},
    {"id":"nr15","resource":"Uranium","type":"uranium","country":"Kazakhstan","region":"South Kazakhstan","lat":44.0,"lon":66.9,"production":"21,800 tonnes/yr","globalShare":"43%","significance":"World's top uranium producer"},
    {"id":"nr16","resource":"Bauxite","type":"bauxite","country":"Guinea","region":"Boke Region","lat":10.9,"lon":-14.3,"production":"100M tonnes/yr","globalShare":"28%","significance":"World's largest bauxite reserves"},
    {"id":"nr17","resource":"Platinum","type":"platinum","country":"South Africa","region":"Bushveld Complex","lat":-25.0,"lon":29.5,"production":"120 tonnes/yr","globalShare":"72%","significance":"Dominates global platinum supply"},
    {"id":"nr18","resource":"Oil","type":"oil","country":"Angola","region":"Cabinda Province","lat":-5.6,"lon":12.2,"production":"1.1M bbl/day","globalShare":"1.3%","significance":"Africa's 2nd largest oil producer"},
    {"id":"nr19","resource":"Coltan","type":"cobalt","country":"Rwanda","region":"Western Province","lat":-2.0,"lon":29.2,"production":"1,000 tonnes/yr","globalShare":"8%","significance":"Key electronics mineral"},
    {"id":"nr20","resource":"Lithium","type":"copper","country":"Australia","region":"Greenbushes","lat":-33.8,"lon":116.1,"production":"55,000 tonnes/yr","globalShare":"47%","significance":"World's largest lithium mine"},
    {"id":"nr21","resource":"Natural Gas","type":"gas","country":"Mozambique","region":"Rovuma Basin","lat":-11.3,"lon":40.5,"production":"Developing","globalShare":"Emerging","significance":"One of Africa's largest gas reserves"},
    {"id":"nr22","resource":"Manganese","type":"iron","country":"South Africa","region":"Kalahari Basin","lat":-27.5,"lon":22.5,"production":"18M tonnes/yr","globalShare":"30%","significance":"World's largest manganese reserves"},
    {"id":"nr23","resource":"Oil","type":"oil","country":"USA","region":"Permian Basin","lat":31.9,"lon":-102.1,"production":"5.5M bbl/day","globalShare":"7%","significance":"World's most productive oil basin"},
    {"id":"nr24","resource":"Rare Earths","type":"cobalt","country":"China","region":"Inner Mongolia","lat":40.8,"lon":109.9,"production":"210,000 tonnes/yr","globalShare":"60%","significance":"Dominates global rare earth production"},
    {"id":"nr25","resource":"Lithium","type":"copper","country":"Chile","region":"Salar de Atacama","lat":-23.5,"lon":-68.1,"production":"26,000 tonnes/yr","globalShare":"22%","significance":"World's 2nd largest lithium producer"},
    {"id":"nr26","resource":"Nickel","type":"cobalt","country":"Indonesia","region":"Sulawesi","lat":-2.5,"lon":121.5,"production":"1.6M tonnes/yr","globalShare":"48%","significance":"Dominant nickel smelting hub"},
    {"id":"nr27","resource":"Oil","type":"oil","country":"Iraq","region":"Basra Terminals","lat":30.5,"lon":47.8,"production":"4.5M bbl/day","globalShare":"5%","significance":"Major OPEC producer"},
    {"id":"nr28","resource":"Oil","type":"oil","country":"UAE","region":"Abu Dhabi Offshore","lat":24.4,"lon":54.3,"production":"3.2M bbl/day","globalShare":"3.8%","significance":"Gulf state producer expanding capacity"},
    {"id":"nr29","resource":"Natural Gas","type":"gas","country":"USA","region":"Marcellus Shale","lat":41.2,"lon":-77.0,"production":"934B m3/yr","globalShare":"24%","significance":"Largest natural gas producer globally"},
    {"id":"nr30","resource":"Oil","type":"oil","country":"Brazil","region":"Santos Basin Pre-salt","lat":-25.0,"lon":-43.0,"production":"3.0M bbl/day","globalShare":"3.5%","significance":"Deepwater pre-salt mega-fields"},
    {"id":"nr31","resource":"Diamond","type":"diamond","country":"Russia","region":"Yakutia","lat":62.0,"lon":130.0,"production":"30M carats/yr","globalShare":"25%","significance":"ALROSA, world's largest diamond producer"},
    {"id":"nr32","resource":"Copper","type":"copper","country":"Peru","region":"Apurimac","lat":-14.0,"lon":-72.8,"production":"2.4M tonnes/yr","globalShare":"10%","significance":"Major copper expansion projects"},
    {"id":"nr33","resource":"Gold","type":"gold","country":"China","region":"Shandong Province","lat":36.7,"lon":117.0,"production":"330 tonnes/yr","globalShare":"10%","significance":"World's largest gold producer"},
    {"id":"nr34","resource":"Coal","type":"iron","country":"India","region":"Jharkhand","lat":23.6,"lon":85.3,"production":"900M tonnes/yr","globalShare":"10%","significance":"2nd largest coal producer"},
    {"id":"nr35","resource":"Tin","type":"iron","country":"Indonesia","region":"Bangka Island","lat":-2.1,"lon":106.1,"production":"52,000 tonnes/yr","globalShare":"22%","significance":"Major tin exporter for electronics"},
    {"id":"nr36","resource":"Oil","type":"oil","country":"Canada","region":"Alberta Oil Sands","lat":56.7,"lon":-111.4,"production":"3.8M bbl/day","globalShare":"4.5%","significance":"3rd largest oil reserves globally"},
    {"id":"nr37","resource":"Natural Gas","type":"gas","country":"Norway","region":"North Sea","lat":61.5,"lon":3.5,"production":"114B m3/yr","globalShare":"3%","significance":"Europe's key gas supplier"},
    {"id":"nr38","resource":"Iron Ore","type":"iron","country":"Brazil","region":"Carajas Mine","lat":-6.0,"lon":-50.3,"production":"400M tonnes/yr","globalShare":"17%","significance":"Largest iron ore mine in the world"},
    {"id":"nr39","resource":"Oil","type":"oil","country":"Libya","region":"Sirte Basin","lat":29.0,"lon":18.0,"production":"1.2M bbl/day","globalShare":"1.4%","significance":"Africa's largest proven oil reserves"},
    {"id":"nr40","resource":"Cobalt","type":"cobalt","country":"Zambia","region":"Copperbelt","lat":-12.8,"lon":28.2,"production":"6,000 tonnes/yr","globalShare":"3%","significance":"Africa's 2nd largest cobalt producer"}
  ]
}

Update ALL values to realistic current data for ${new Date().toISOString().split('T')[0]}. Cover every continent. Return ONLY the JSON object.`;

async function fetchAllLayerData(): Promise<AILayerCache | null> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) return cache;
  if (fetchInProgress) return fetchInProgress;

  fetchInProgress = (async () => {
    console.log('[LayerAI] Fetching AI-generated layer data...');
    const raw = await callAI(LAYER_PROMPT);
    const parsed = tryParse<Omit<AILayerCache, 'timestamp'>>(raw);
    if (parsed) {
      cache = { ...parsed, timestamp: Date.now() };
      console.log('[LayerAI] AI layer data received');
      return cache;
    }
    console.warn('[LayerAI] AI layer data failed');
    return null;
  })();

  try { return await fetchInProgress; }
  finally { fetchInProgress = null; }
}

// ---- Public API ----

export async function getAIProtests(): Promise<AIProtestEvent[]> {
  const data = await fetchAllLayerData();
  return data?.protests ?? [];
}

export async function getAIMilitaryFlights(): Promise<AIMilitaryFlight[]> {
  const data = await fetchAllLayerData();
  return data?.military ?? [];
}

export async function getAIWeatherAlerts(): Promise<AIWeatherAlert[]> {
  const data = await fetchAllLayerData();
  return data?.weather ?? [];
}

export async function getAICyberThreats(): Promise<AICyberThreat[]> {
  const data = await fetchAllLayerData();
  return data?.cyber ?? [];
}

export async function getAIHungerZones(): Promise<AIHungerZone[]> {
  const data = await fetchAllLayerData();
  return data?.hunger ?? [];
}

export async function getAIOutages(): Promise<AIOutage[]> {
  const data = await fetchAllLayerData();
  return data?.outages ?? [];
}

export async function getAIFlightDelays(): Promise<AIFlightDelay[]> {
  const data = await fetchAllLayerData();
  return data?.flights ?? [];
}

export async function getAINaturalResources(): Promise<AINaturalResource[]> {
  const data = await fetchAllLayerData();
  return data?.naturalResources ?? [];
}

export function isAILayerAvailable(): boolean {
  const xaiKey = getSecretValue('XAI_API_KEY');
  const openaiKey = getSecretValue('OPENAI_API_KEY') || (import.meta as { env?: Record<string, string> }).env?.OPENAI_API_KEY;
  return !!(xaiKey || openaiKey);
}
