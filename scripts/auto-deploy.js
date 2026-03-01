#!/usr/bin/env node
/**
 * Auto-deploy script for WorldMonitor.
 * Polls GitHub (navada remote) every 2 minutes for new commits.
 * If changes found, pulls and lets Vite HMR handle the reload.
 *
 * Managed by PM2: pm2 start scripts/auto-deploy.js --name worldmonitor-deploy
 */

const { execSync } = require('child_process');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..');
const REMOTE = 'navada';
const BRANCH = 'main';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

function log(msg) {
  console.log(`[AutoDeploy ${new Date().toLocaleTimeString()}] ${msg}`);
}

function run(cmd, timeout = 30000) {
  return execSync(cmd, { cwd: REPO_DIR, encoding: 'utf-8', timeout }).trim();
}

function rebuild() {
  log('Rebuilding frontend (vite build)...');
  run('npx vite build', 120000);
  log('Build complete. Restarting worldmonitor via PM2...');
  run('pm2 restart worldmonitor');
  log('WorldMonitor restarted with new build.');
}

function checkAndPull() {
  try {
    // Fetch latest from remote
    run(`git fetch ${REMOTE} ${BRANCH} --quiet`);

    // Compare local HEAD with remote
    const local = run('git rev-parse HEAD');
    const remote = run(`git rev-parse ${REMOTE}/${BRANCH}`);

    if (local === remote) {
      return; // Already up to date — silent
    }

    // Check for uncommitted changes
    const status = run('git status --porcelain');
    if (status) {
      log('Local changes detected — stashing before pull');
      run('git stash push -m "auto-deploy-stash"');
    }

    log(`New commits found: ${local.slice(0, 7)} → ${remote.slice(0, 7)}`);
    const output = run(`git pull ${REMOTE} ${BRANCH}`);
    log(`Pull complete: ${output}`);

    // Pop stash if we stashed
    if (status) {
      try {
        run('git stash pop');
        log('Stash restored');
      } catch (e) {
        log('WARNING: Stash pop failed (merge conflict?) — stash preserved');
      }
    }

    // Rebuild and restart via PM2
    rebuild();
  } catch (err) {
    log(`Error: ${err.message}`);
  }
}

// Initial check
log(`Watching ${REMOTE}/${BRANCH} — polling every ${POLL_INTERVAL_MS / 1000}s`);
log(`Repo: ${REPO_DIR}`);
checkAndPull();

// Poll loop
setInterval(checkAndPull, POLL_INTERVAL_MS);
