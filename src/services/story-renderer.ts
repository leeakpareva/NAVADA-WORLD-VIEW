import type { StoryData } from './story-data';

const W = 1080;
const H = 1920;

const LEVEL_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', elevated: '#eab308', normal: '#22c55e', low: '#3b82f6',
};
const THREAT_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', info: '#3b82f6',
};

export function renderStoryToCanvas(data: StoryData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  let y = 0;

  // -- Header bar --
  y = 50;
  ctx.fillStyle = '#666';
  ctx.font = '700 28px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('WORLDMONITOR', 60, y + 24);
  ctx.letterSpacing = '0px';
  const dateStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  ctx.font = '400 22px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#555';
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - 60 - dateW, y + 24);

  // Header line
  y += 50;
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, y);
  ctx.lineTo(W - 60, y);
  ctx.stroke();

  // -- Country name --
  y += 55;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 72px Inter, system-ui, sans-serif';
  ctx.fillText(data.countryName.toUpperCase(), 60, y);

  // -- CII Score --
  const levelColor = LEVEL_COLORS[data.cii?.level || 'normal'] || '#888';
  const score = data.cii?.score ?? 0;
  y += 50;
  ctx.fillStyle = levelColor;
  ctx.font = '600 36px Inter, system-ui, sans-serif';
  ctx.fillText(`${score}/100`, 60, y);

  const trendText = data.cii?.trend === 'rising' ? ' ↑ RISING' : data.cii?.trend === 'falling' ? ' ↓ FALLING' : ' → STABLE';
  const scoreW = ctx.measureText(`${score}/100`).width;
  ctx.font = '400 28px Inter, system-ui, sans-serif';
  ctx.fillText(trendText, 60 + scoreW + 16, y);

  // Level badge
  const levelLabel = (data.cii?.level || 'normal').toUpperCase();
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  const badgeW = ctx.measureText(levelLabel).width + 28;
  const badgeX = 60 + scoreW + 16 + ctx.measureText(trendText).width + 20;
  ctx.fillStyle = levelColor;
  roundRect(ctx, badgeX, y - 22, badgeW, 30, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(levelLabel, badgeX + 14, y - 1);

  // Score bar
  y += 30;
  ctx.fillStyle = '#1a1a2e';
  roundRect(ctx, 60, y, W - 120, 12, 6);
  ctx.fill();
  ctx.fillStyle = levelColor;
  roundRect(ctx, 60, y, (W - 120) * score / 100, 12, 6);
  ctx.fill();

  // Component scores
  if (data.cii?.components) {
    y += 34;
    ctx.fillStyle = '#888';
    ctx.font = '400 20px Inter, system-ui, sans-serif';
    ctx.fillText(`U:${data.cii.components.unrest}    S:${data.cii.components.security}    I:${data.cii.components.information}`, 60, y);
  }

  // -- Headlines --
  if (data.news.length > 0) {
    y += 40;
    drawSeparator(ctx, y);
    y += 35;
    ctx.fillStyle = '#555';
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('TOP HEADLINES', 60, y);
    ctx.letterSpacing = '0px';

    for (const item of data.news.slice(0, 5)) {
      y += 40;
      const tc = THREAT_COLORS[item.threatLevel] || '#3b82f6';
      const label = item.threatLevel.toUpperCase();
      ctx.fillStyle = tc;
      ctx.font = '700 18px Inter, system-ui, sans-serif';
      ctx.fillText(label, 60, y);

      ctx.fillStyle = '#ccc';
      ctx.font = '400 22px Inter, system-ui, sans-serif';
      const title = item.title.length > 65 ? item.title.slice(0, 62) + '...' : item.title;
      ctx.fillText(title, 150, y);
    }

    y += 30;
    const sourceCount = data.news.reduce((s, n) => s + (n.sourceCount || 1), 0);
    const alertCount = data.news.filter(n => n.threatLevel === 'critical' || n.threatLevel === 'high').length;
    ctx.fillStyle = '#555';
    ctx.font = '400 18px Inter, system-ui, sans-serif';
    let statsText = `${sourceCount} sources`;
    if (alertCount > 0) statsText += `  •  ${alertCount} alerts`;
    ctx.fillText(statsText, 60, y);
  }

  // -- Military Posture --
  if (data.theater) {
    y += 40;
    drawSeparator(ctx, y);
    y += 35;
    ctx.fillStyle = '#555';
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('MILITARY POSTURE', 60, y);
    ctx.letterSpacing = '0px';

    const postureColor = data.theater.postureLevel === 'critical' ? '#ef4444'
      : data.theater.postureLevel === 'elevated' ? '#f97316' : '#22c55e';

    y += 40;
    ctx.fillStyle = postureColor;
    ctx.font = '600 28px Inter, system-ui, sans-serif';
    ctx.fillText(`${data.theater.theaterName}: ${data.theater.postureLevel.toUpperCase()}`, 60, y);

    y += 36;
    ctx.fillStyle = '#aaa';
    ctx.font = '400 22px Inter, system-ui, sans-serif';
    ctx.fillText(`✈ ${data.theater.totalAircraft} aircraft    ⚓ ${data.theater.totalVessels} vessels`, 60, y);

    if (data.theater.fighters || data.theater.tankers || data.theater.awacs) {
      y += 32;
      ctx.fillStyle = '#777';
      ctx.font = '400 20px Inter, system-ui, sans-serif';
      const parts: string[] = [];
      if (data.theater.fighters) parts.push(`Fighters: ${data.theater.fighters}`);
      if (data.theater.tankers) parts.push(`Tankers: ${data.theater.tankers}`);
      if (data.theater.awacs) parts.push(`AWACS: ${data.theater.awacs}`);
      ctx.fillText(parts.join('    '), 60, y);
    }

    if (data.theater.strikeCapable) {
      y += 32;
      ctx.fillStyle = '#ef4444';
      ctx.font = '700 20px Inter, system-ui, sans-serif';
      ctx.fillText('STRIKE CAPABLE', 60, y);
    }
  }

  // -- Predictions --
  if (data.markets.length > 0) {
    y += 40;
    drawSeparator(ctx, y);
    y += 35;
    ctx.fillStyle = '#555';
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('PREDICTION MARKETS', 60, y);
    ctx.letterSpacing = '0px';

    for (const m of data.markets.slice(0, 4)) {
      y += 38;
      const title = m.title.length > 45 ? m.title.slice(0, 42) + '...' : m.title;
      ctx.fillStyle = '#ccc';
      ctx.font = '400 22px Inter, system-ui, sans-serif';
      ctx.fillText(title, 60, y);

      const pct = `${Math.round(m.yesPrice * 100)}%`;
      ctx.fillStyle = '#eab308';
      ctx.font = '700 22px Inter, system-ui, sans-serif';
      const pctW = ctx.measureText(pct).width;
      ctx.fillText(pct, W - 60 - pctW, y);
    }
  }

  // -- Threat Breakdown --
  const hasThreats = data.threats.critical + data.threats.high + data.threats.medium > 0;
  if (hasThreats) {
    y += 40;
    drawSeparator(ctx, y);
    y += 35;
    ctx.fillStyle = '#555';
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('THREAT BREAKDOWN', 60, y);
    ctx.letterSpacing = '0px';

    y += 36;
    let tx = 60;
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    if (data.threats.critical) {
      ctx.fillStyle = '#ef4444';
      const t = `${data.threats.critical} Critical`;
      ctx.fillText(t, tx, y);
      tx += ctx.measureText(t).width + 24;
    }
    if (data.threats.high) {
      ctx.fillStyle = '#f97316';
      const t = `${data.threats.high} High`;
      ctx.fillText(t, tx, y);
      tx += ctx.measureText(t).width + 24;
    }
    if (data.threats.medium) {
      ctx.fillStyle = '#eab308';
      ctx.fillText(`${data.threats.medium} Medium`, tx, y);
    }

    if (data.threats.categories.length > 0) {
      y += 30;
      ctx.fillStyle = '#777';
      ctx.font = '400 20px Inter, system-ui, sans-serif';
      ctx.fillText(data.threats.categories.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' · '), 60, y);
    }
  }

  // -- Footer --
  const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, H - 80);
  ctx.lineTo(W - 60, H - 80);
  ctx.stroke();

  ctx.fillStyle = '#444';
  ctx.font = '400 20px Inter, system-ui, sans-serif';
  ctx.fillText('worldmonitor.app', 60, H - 45);
  const tw = ctx.measureText(timeStr).width;
  ctx.fillText(timeStr, W - 60 - tw, H - 45);

  return canvas;
}

function drawSeparator(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, y);
  ctx.lineTo(W - 60, y);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
