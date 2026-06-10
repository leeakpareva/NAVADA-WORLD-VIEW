# NAVADA World View — Customization Guide

How to change the data flowing into the dashboard. After any change below, redeploy with:

```powershell
docker compose -f C:\Users\leeak\NAVADA-WORLD-VIEW\docker-compose.yml up -d --build
```

(~5 min build on the ASUS. The public site updates the moment the container restarts.)

## 1. Add / remove / reorder panels

`src/config/panels.ts` — the `FULL_PANELS` object. Each entry:

```ts
'panel-id': { name: 'Display Name', enabled: true, priority: 1 },
```

- `enabled: false` hides a panel without deleting it.
- Order in the object = order in the grid (priority 1 panels first).
- Panel IDs map to components instantiated in `src/app/panel-layout.ts`.

## 2. Change news / RSS sources (Live News, regional panels, AI news)

`src/config/feeds.ts` — feed groups keyed by panel (`politics`, `ai`, `tech`, `europe`, `middleeast`, …).

```ts
ai: [
  { name: 'VentureBeat AI', url: rss('https://venturebeat.com/category/ai/feed/') },
  // add any RSS feed here:
  { name: 'My Source', url: rss('https://example.com/feed.xml') },
],
```

Any valid RSS/Atom URL works — the server proxies and parses it. Source quality tiers live in `SOURCE_TIERS` in the same file.

## 3. AI-generated panels (UK Unemployment, AI Companies, Job Losses, …)

These panels ask an LLM for current data. The prompt lives inside each component in `src/components/` (e.g. `UKUnemploymentPanel.ts` — edit the prompt string in `fetchData()` to change what's asked).

They call, in order: xAI (key on client, desktop only) → OpenAI direct (if key baked) → **`/api/ai-chat` server proxy** (uses `OPENAI_API_KEY` from `.env.local`, key never reaches the browser). The proxy is `api/ai-chat.js` — allowed models and token caps are set at the top of that file.

## 4. API keys / data-source credentials

`.env.local` in the repo root (server-side only, never committed). Restart the container after edits (no rebuild needed for server-side keys — but `VITE_*` vars are baked at build time and DO need a rebuild).

| Key | Unlocks | Where to get it (free) |
|-----|---------|------------------------|
| GROQ_API_KEY | Fast AI summaries (primary) | console.groq.com |
| FINNHUB_API_KEY | Live markets panel | finnhub.io |
| FRED_API_KEY | US economic indicators | fred.stlouisfed.org |
| EIA_API_KEY | Energy/oil analytics | eia.gov/opendata |
| NASA_FIRMS_API_KEY | Satellite fires layer | firms.modaps.eosdis.nasa.gov |
| ACLED_ACCESS_TOKEN | Conflict/protest events | acleddata.com |
| UCDP_ACCESS_TOKEN | UCDP conflict layer | ucdp.uu.se (API changed 2026 — token now required) |
| OPENAI_API_KEY | AI panels + summaries via /api/ai-chat | platform.openai.com (SET) |
| XAI_API_KEY | Grok country briefs | x.ai (SET) |
| CLOUDFLARE_API_TOKEN | Internet outages layer | (SET) |

## 5. Map layers

`src/config/panels.ts` — `FULL_MAP_LAYERS` toggles (conflicts, bases, hotspots, sanctions, weather, outages, natural, …). The URL `?layers=` query param overrides at view time.

## 6. Variants

`VITE_VARIANT` build arg: `full` (default), `tech`, `finance`, `happy`. Set in the Dockerfile build stage. Variant-specific panel sets live in `src/config/variants/`.

## Deployment architecture (June 2026)

```
Browser → https://navada-world-view.xyz
        → EC2 nginx (3.11.119.181, Let's Encrypt, auto-renews)
        → Tailscale → ASUS container navada-world-view:4173
            ├── serve-local.mjs  (static dist + /api proxy)
            └── local-api-server.mjs :46123 (all /api routes)

Also live: https://world.navada-edge-server.uk (Cloudflare Tunnel → same container)
Watchdog:  world-view-monitor container on EC2 — checks site + API + container
           every 5 min, Telegram alert to Lee after 3 consecutive failures.
DNS:       Vercel registrar (A records → EC2). No Vercel hosting.
```
