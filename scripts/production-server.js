#!/usr/bin/env node
/**
 * Production server for WorldMonitor.
 * Serves the built static files from dist/ and proxies all API + RSS routes.
 * Designed to run behind Tailscale Funnel.
 *
 * Usage: node scripts/production-server.js
 * Port: 4173 (or PORT env var)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Load .env.local for API keys
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// Global error handlers — keep server running
process.on('uncaughtException', (err) => {
  console.error('[Production] Uncaught exception (server continues):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Production] Unhandled rejection:', err);
});

const PORT = parseInt(process.env.PORT || '4173', 10);
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
  /^https?:\/\/100\.\d+\.\d+\.\d+(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net(:\d+)?$/,
  /^https:\/\/(.*\.)?worldmonitor\.app$/,
  /^https:\/\/navada\.tail394c36\.ts\.net$/,
];

// ---- MIME types ----
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.map': 'application/json',
};

// ---- CORS helpers ----
function getCorsHeaders(origin) {
  const allowed = !origin || ALLOWED_ORIGINS.some(p => p.test(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? (origin || '*') : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WorldMonitor-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// ---- Proxy configuration (extracted from vite.config.ts) ----
const PROXY_ROUTES = {
  // API proxies
  '/api/yahoo': { target: 'https://query1.finance.yahoo.com', strip: '/api/yahoo' },
  '/api/earthquake': { target: 'https://earthquake.usgs.gov', strip: '/api/earthquake' },
  '/api/pizzint': { target: 'https://www.pizzint.watch', strip: '/api/pizzint', replaceWith: '/api' },
  '/api/cloudflare-radar': { target: 'https://api.cloudflare.com', strip: '/api/cloudflare-radar' },
  '/api/nga-msi': { target: 'https://msi.nga.mil', strip: '/api/nga-msi' },
  '/api/gdelt': { target: 'https://api.gdeltproject.org', strip: '/api/gdelt' },
  // FRED needs API key injection
  '/api/fred-data': { target: 'https://api.stlouisfed.org', strip: '/api/fred-data', fredRewrite: true },

  // RSS proxies — news
  '/rss/bbc': { target: 'https://feeds.bbci.co.uk', strip: '/rss/bbc' },
  '/rss/guardian': { target: 'https://www.theguardian.com', strip: '/rss/guardian' },
  '/rss/npr': { target: 'https://feeds.npr.org', strip: '/rss/npr' },
  '/rss/apnews': { target: 'https://rsshub.app/apnews', strip: '/rss/apnews' },
  '/rss/aljazeera': { target: 'https://www.aljazeera.com', strip: '/rss/aljazeera' },
  '/rss/cnn': { target: 'http://rss.cnn.com', strip: '/rss/cnn' },
  '/rss/hn': { target: 'https://hnrss.org', strip: '/rss/hn' },
  '/rss/arstechnica': { target: 'https://feeds.arstechnica.com', strip: '/rss/arstechnica' },
  '/rss/verge': { target: 'https://www.theverge.com', strip: '/rss/verge' },
  '/rss/cnbc': { target: 'https://www.cnbc.com', strip: '/rss/cnbc' },
  '/rss/marketwatch': { target: 'https://feeds.marketwatch.com', strip: '/rss/marketwatch' },
  '/rss/techcrunch': { target: 'https://techcrunch.com', strip: '/rss/techcrunch' },
  '/rss/googlenews': { target: 'https://news.google.com', strip: '/rss/googlenews' },
  '/rss/yahoonews': { target: 'https://finance.yahoo.com', strip: '/rss/yahoonews' },
  '/rss/venturebeat': { target: 'https://venturebeat.com', strip: '/rss/venturebeat' },
  '/rss/foreignpolicy': { target: 'https://foreignpolicy.com', strip: '/rss/foreignpolicy' },
  '/rss/ft': { target: 'https://www.ft.com', strip: '/rss/ft' },
  '/rss/reuters': { target: 'https://www.reutersagency.com', strip: '/rss/reuters' },

  // RSS proxies — defense/intel
  '/rss/defenseone': { target: 'https://www.defenseone.com', strip: '/rss/defenseone' },
  '/rss/warontherocks': { target: 'https://warontherocks.com', strip: '/rss/warontherocks' },
  '/rss/breakingdefense': { target: 'https://breakingdefense.com', strip: '/rss/breakingdefense' },
  '/rss/bellingcat': { target: 'https://www.bellingcat.com', strip: '/rss/bellingcat' },
  '/rss/warzone': { target: 'https://www.thedrive.com', strip: '/rss/warzone' },
  '/rss/defensegov': { target: 'https://www.defense.gov', strip: '/rss/defensegov' },
  '/rss/krebs': { target: 'https://krebsonsecurity.com', strip: '/rss/krebs' },
  '/rss/diplomat': { target: 'https://thediplomat.com', strip: '/rss/diplomat' },

  // RSS proxies — AI blogs
  '/rss/openai': { target: 'https://openai.com', strip: '/rss/openai' },
  '/rss/anthropic': { target: 'https://www.anthropic.com', strip: '/rss/anthropic' },
  '/rss/googleai': { target: 'https://blog.google', strip: '/rss/googleai' },
  '/rss/deepmind': { target: 'https://deepmind.google', strip: '/rss/deepmind' },
  '/rss/huggingface': { target: 'https://huggingface.co', strip: '/rss/huggingface' },
  '/rss/techreview': { target: 'https://www.technologyreview.com', strip: '/rss/techreview' },
  '/rss/arxiv': { target: 'https://rss.arxiv.org', strip: '/rss/arxiv' },

  // RSS proxies — government
  '/rss/whitehouse': { target: 'https://www.whitehouse.gov', strip: '/rss/whitehouse' },
  '/rss/statedept': { target: 'https://www.state.gov', strip: '/rss/statedept' },
  '/rss/state': { target: 'https://www.state.gov', strip: '/rss/state' },
  '/rss/defense': { target: 'https://www.defense.gov', strip: '/rss/defense' },
  '/rss/justice': { target: 'https://www.justice.gov', strip: '/rss/justice' },
  '/rss/cdc': { target: 'https://tools.cdc.gov', strip: '/rss/cdc' },
  '/rss/fema': { target: 'https://www.fema.gov', strip: '/rss/fema' },
  '/rss/dhs': { target: 'https://www.dhs.gov', strip: '/rss/dhs' },
  '/rss/fedreserve': { target: 'https://www.federalreserve.gov', strip: '/rss/fedreserve' },
  '/rss/sec': { target: 'https://www.sec.gov', strip: '/rss/sec' },
  '/rss/treasury': { target: 'https://home.treasury.gov', strip: '/rss/treasury' },
  '/rss/cisa': { target: 'https://www.cisa.gov', strip: '/rss/cisa' },

  // RSS proxies — think tanks
  '/rss/brookings': { target: 'https://www.brookings.edu', strip: '/rss/brookings' },
  '/rss/cfr': { target: 'https://www.cfr.org', strip: '/rss/cfr' },
  '/rss/csis': { target: 'https://www.csis.org', strip: '/rss/csis' },
};

// Sorted by longest prefix first for matching
const PROXY_PREFIXES = Object.keys(PROXY_ROUTES).sort((a, b) => b.length - a.length);

// ---- Proxy handler ----
function proxyRequest(req, res, route) {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  let targetPath = req.url;
  if (route.fredRewrite) {
    const parsed = new URL(req.url, 'http://localhost');
    const seriesId = parsed.searchParams.get('series_id');
    const start = parsed.searchParams.get('observation_start');
    const end = parsed.searchParams.get('observation_end');
    const apiKey = process.env.FRED_API_KEY || '';
    targetPath = `/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10${start ? `&observation_start=${start}` : ''}${end ? `&observation_end=${end}` : ''}`;
  } else if (route.replaceWith) {
    targetPath = req.url.replace(new RegExp(`^${route.strip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), route.replaceWith);
  } else {
    targetPath = req.url.replace(new RegExp(`^${route.strip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '');
  }
  if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

  const targetUrl = new URL(targetPath, route.target);
  const isHttps = targetUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  // Clean headers — remove undefined/null values and hop-by-hop headers
  const cleanHeaders = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    if (['host', 'origin', 'referer', 'connection', 'upgrade', 'transfer-encoding'].includes(key)) continue;
    cleanHeaders[key] = val;
  }
  cleanHeaders['host'] = targetUrl.hostname;

  const proxyReq = client.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: cleanHeaders,
      timeout: 30000,
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers, ...corsHeaders };
      delete headers['x-frame-options'];
      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    console.error(`[Proxy] ${route.target} error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('Bad Gateway');
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('Gateway Timeout');
  });

  req.pipe(proxyReq);
}

// ---- Sebuf API handler (delegates to Vite dev for now — runs both in parallel) ----
// The production build includes the sebuf handlers compiled into the frontend.
// For server-side sebuf routes, we proxy to the Vite dev server if it's running.
function proxySebufToViteDev(req, res) {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Proxy to Vite dev server for sebuf routes
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: 5174,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:5174' },
      timeout: 60000,
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers, ...corsHeaders };
      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'Backend unavailable' }));
  });

  req.pipe(proxyReq);
}

// ---- Static file server ----
function serveStatic(req, res) {
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);

  let urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/') urlPath = '/index.html';

  // Try exact file
  let filePath = path.join(DIST_DIR, urlPath);

  // Check for brotli-precompressed version
  const brPath = filePath + '.br';
  const gzPath = filePath + '.gz';

  const acceptEncoding = req.headers['accept-encoding'] || '';

  if (acceptEncoding.includes('br') && fs.existsSync(brPath)) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Encoding': 'br',
      'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      ...corsHeaders,
    });
    fs.createReadStream(brPath).pipe(res);
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback — serve index.html for non-file routes
    filePath = path.join(DIST_DIR, 'index.html');
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Not Found');
      return;
    }
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const cacheControl = urlPath.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300';

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Serve index.html for directory requests
      filePath = path.join(DIST_DIR, 'index.html');
    }
    const finalStat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': finalStat.size,
      'Cache-Control': cacheControl,
      ...corsHeaders,
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain', ...corsHeaders });
    res.end('Internal Server Error');
  }
}

// ---- Main server ----
const server = http.createServer((req, res) => {
  try {
  const url = req.url || '/';

  // API routes → proxy or sebuf
  if (url.startsWith('/api/') || url.startsWith('/rss/')) {
    // Check sebuf routes first: /api/{domain}/v1/*
    if (/^\/api\/[a-z-]+\/v1\//.test(url)) {
      proxySebufToViteDev(req, res);
      return;
    }

    // RSS proxy route for /api/rss-proxy
    if (url.startsWith('/api/rss-proxy')) {
      proxySebufToViteDev(req, res);
      return;
    }

    // YouTube live
    if (url.startsWith('/api/youtube/live')) {
      proxySebufToViteDev(req, res);
      return;
    }

    // Polymarket
    if (url.startsWith('/api/polymarket')) {
      proxySebufToViteDev(req, res);
      return;
    }

    // Find matching proxy route
    for (const prefix of PROXY_PREFIXES) {
      if (url.startsWith(prefix)) {
        proxyRequest(req, res, PROXY_ROUTES[prefix]);
        return;
      }
    }
  }

  // Static files
  serveStatic(req, res);
  } catch (err) {
    console.error('[Production] Request handler error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Production] NAVADA WorldMonitor serving on http://0.0.0.0:${PORT}`);
  console.log(`[Production] Static files: ${DIST_DIR}`);
  console.log(`[Production] Sebuf API proxy → http://127.0.0.1:5174`);
  console.log(`[Production] ${Object.keys(PROXY_ROUTES).length} proxy routes configured`);
});
