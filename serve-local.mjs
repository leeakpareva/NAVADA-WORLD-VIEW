#!/usr/bin/env node
/**
 * WorldMonitor Local Server — HP Laptop Permanent Setup
 *
 * Serves the built frontend (dist/) AND proxies /api/* requests
 * to the local API server (local-api-server.mjs on port 46123).
 *
 * Binds to 0.0.0.0 so it's accessible via Tailscale and LAN.
 * Run via PM2 for persistence.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = parseInt(process.env.WM_PORT || '4173', 10);
const API_PORT = parseInt(process.env.LOCAL_API_PORT || '46123', 10);
const TRADING_API_PORT = parseInt(process.env.TRADING_API_PORT || '5678', 10);
const HOST = '0.0.0.0';

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(DIST_DIR, urlPath);
  const normalizedPath = path.normalize(filePath);

  // Prevent directory traversal
  if (!normalizedPath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Check for pre-compressed brotli version
  const brPath = filePath + '.br';
  const acceptEncoding = req.headers['accept-encoding'] || '';

  if (acceptEncoding.includes('br') && fs.existsSync(brPath)) {
    const mime = getMimeType(filePath);
    const stat = fs.statSync(brPath);
    const isAsset = urlPath.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Encoding': 'br',
      'Content-Length': stat.size,
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Vary': 'Accept-Encoding',
    });
    fs.createReadStream(brPath).pipe(res);
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: serve index.html for non-file routes
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  const mime = getMimeType(filePath);
  const stat = fs.statSync(filePath);
  const isAsset = urlPath.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

function proxyToApi(req, res, port = API_PORT) {
  const options = {
    hostname: '127.0.0.1',
    port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Replace CORS origin to match the frontend's origin
    const headers = { ...proxyRes.headers };
    headers['access-control-allow-origin'] = '*';
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] API server error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API server unavailable', detail: err.message }));
  });

  req.pipe(proxyReq);
}

// Main server
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/trading/')) {
    proxyToApi(req, res, TRADING_API_PORT);
  } else if (url.pathname.startsWith('/api/')) {
    proxyToApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[worldmonitor] Dashboard: http://${HOST}:${PORT}`);
  console.log(`[worldmonitor] API proxy: /api/* -> http://127.0.0.1:${API_PORT}`);
  console.log(`[worldmonitor] Trading proxy: /api/trading/* -> http://127.0.0.1:${TRADING_API_PORT}`);
  console.log(`[worldmonitor] LAN: http://192.168.0.36:${PORT}`);
  console.log(`[worldmonitor] Tailscale: https://navada.tail394c36.ts.net`);
});
