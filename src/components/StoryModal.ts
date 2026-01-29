import type { StoryData } from '@/services/story-data';
import { renderStoryToCanvas } from '@/services/story-renderer';

let modalEl: HTMLElement | null = null;
let currentDataUrl: string | null = null;

export function openStoryModal(data: StoryData): void {
  closeStoryModal();

  modalEl = document.createElement('div');
  modalEl.className = 'story-modal-overlay';
  modalEl.innerHTML = `
    <div class="story-modal">
      <div class="story-modal-content">
        <div class="story-loading">
          <div class="story-spinner"></div>
          <span>Generating story...</span>
        </div>
      </div>
      <div class="story-actions" style="display:none">
        <button class="story-btn story-download">Download PNG</button>
        <button class="story-btn story-share">Share</button>
        <button class="story-btn story-close">Close</button>
      </div>
    </div>
  `;

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeStoryModal();
  });
  modalEl.querySelector('.story-close')?.addEventListener('click', closeStoryModal);
  modalEl.querySelector('.story-download')?.addEventListener('click', downloadStory);
  modalEl.querySelector('.story-share')?.addEventListener('click', () => shareStory(data.countryName));

  document.body.appendChild(modalEl);

  // Render client-side on next frame
  requestAnimationFrame(() => {
    if (!modalEl) return;
    try {
      const canvas = renderStoryToCanvas(data);
      currentDataUrl = canvas.toDataURL('image/png');

      const content = modalEl.querySelector('.story-modal-content');
      if (content) {
        content.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'story-image';
        img.src = currentDataUrl;
        img.alt = `${data.countryName} Intelligence Story`;
        content.appendChild(img);
      }
      const actions = modalEl.querySelector('.story-actions') as HTMLElement;
      if (actions) actions.style.display = 'flex';
    } catch (err) {
      console.error('[StoryModal] Render error:', err);
      const content = modalEl?.querySelector('.story-modal-content');
      if (content) content.innerHTML = '<div class="story-error">Failed to generate story.</div>';
    }
  });
}

export function closeStoryModal(): void {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
    currentDataUrl = null;
  }
}

function downloadStory(): void {
  if (!currentDataUrl) return;
  const a = document.createElement('a');
  a.href = currentDataUrl;
  a.download = `worldmonitor-story-${Date.now()}.png`;
  a.click();
}

async function shareStory(countryName: string): Promise<void> {
  if (!currentDataUrl) return;

  try {
    const resp = await fetch(currentDataUrl);
    const blob = await resp.blob();
    const file = new File([blob], `${countryName.toLowerCase()}-worldmonitor.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: `${countryName} — WorldMonitor`,
        text: `Current intelligence snapshot for ${countryName}`,
        files: [file],
      });
      return;
    }
  } catch {
    // Web Share API not available or cancelled
  }

  try {
    const resp = await fetch(currentDataUrl);
    const blob = await resp.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    const btn = modalEl?.querySelector('.story-share');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { if (btn) btn.textContent = 'Share'; }, 2000);
    }
  } catch {
    downloadStory();
  }
}
