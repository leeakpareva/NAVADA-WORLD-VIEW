/**
 * Countdown Panel — Days left in 2026 with live ticking timer.
 * Shows days, hours, minutes, seconds remaining plus year progress bar.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

const YEAR_END = new Date('2027-01-01T00:00:00').getTime();
const YEAR_START = new Date('2026-01-01T00:00:00').getTime();
const TOTAL_MS = YEAR_END - YEAR_START;

export class CountdownPanel extends Panel {
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'countdown-2026', title: 'Days Left in 2026', showCount: false });
    this.tick();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  public destroy(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    super.destroy();
  }

  private tick(): void {
    const now = Date.now();
    const remaining = Math.max(0, YEAR_END - now);
    const elapsed = now - YEAR_START;
    const progress = Math.min(100, Math.max(0, (elapsed / TOTAL_MS) * 100));

    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

    const dayOfYear = Math.ceil(elapsed / (1000 * 60 * 60 * 24));
    const weekNum = Math.ceil(dayOfYear / 7);
    const quarter = Math.ceil((new Date().getMonth() + 1) / 3);

    this.setContent(`
      <div class="countdown-panel">
        <div class="countdown-main">
          <span class="countdown-number">${days}</span>
          <span class="countdown-label">Days Remaining in 2026</span>
        </div>
        <div class="countdown-progress">
          <div class="countdown-progress-bar" style="width:${progress.toFixed(1)}%"></div>
        </div>
        <div class="countdown-details">
          <div class="countdown-detail">
            <span class="countdown-detail-num">${days}</span>
            <span class="countdown-detail-label">Days</span>
          </div>
          <div class="countdown-detail">
            <span class="countdown-detail-num">${String(hours).padStart(2, '0')}</span>
            <span class="countdown-detail-label">Hours</span>
          </div>
          <div class="countdown-detail">
            <span class="countdown-detail-num">${String(minutes).padStart(2, '0')}</span>
            <span class="countdown-detail-label">Mins</span>
          </div>
          <div class="countdown-detail">
            <span class="countdown-detail-num">${String(seconds).padStart(2, '0')}</span>
            <span class="countdown-detail-label">Secs</span>
          </div>
        </div>
        <div class="countdown-milestones">
          <div class="countdown-milestone">
            <span class="milestone-date">Progress</span>
            <span class="milestone-event">${progress.toFixed(1)}% of 2026 complete</span>
            <span class="milestone-days">Q${quarter}</span>
          </div>
          <div class="countdown-milestone">
            <span class="milestone-date">Week</span>
            <span class="milestone-event">Week ${weekNum} of 52</span>
            <span class="milestone-days">Day ${dayOfYear}</span>
          </div>
        </div>
      </div>
    `);
  }
}
