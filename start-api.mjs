#!/usr/bin/env node
/**
 * Wrapper to start local-api-server under PM2.
 * PM2's fork mode changes process.argv, breaking the isMainModule() check
 * in local-api-server.mjs. This wrapper calls createLocalApiServer directly.
 */
import { createLocalApiServer } from './src-tauri/sidecar/local-api-server.mjs';

try {
  const app = await createLocalApiServer();
  await app.start();
} catch (error) {
  console.error('[local-api] startup failed', error);
  process.exit(1);
}
