/** Entry point: settings, then fonts, then a loading board, then the game chunk. */

import './ui/styles.css';
import { waitForFonts } from './boot/font-gate';
import { initI18n, t, tList } from './i18n';
import { supportsWebGL2 } from './render/quality';
import { loadSettings } from './save/settings';

function showFailure(board: HTMLElement): void {
  board.className = 'boot-board plate plate-tin boot-failed';
  board.textContent = '';
  const message = document.createElement('p');
  message.textContent = t('boot.failed');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'plaque plaque-tomato';
  retry.textContent = t('boot.retry');
  retry.addEventListener('click', () => window.location.reload());
  board.append(message, retry);
}

async function boot(): Promise<void> {
  const settings = loadSettings();
  initI18n(settings.locale, settings.digits);
  document.documentElement.dataset.reduceMotion = settings.reduceMotion ? '1' : '0';

  await waitForFonts();

  const ui = document.getElementById('ui') as HTMLElement;
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

  // Shown only after the fonts are ready, so Bangla never flashes in a wrong face.
  const tips = tList('tips');
  const board = document.createElement('div');
  board.className = 'boot-board plate plate-tin';
  const loadingText = document.createElement('p');
  loadingText.className = 'boot-loading';
  loadingText.textContent = t('boot.loading');
  const tipLabel = document.createElement('span');
  tipLabel.className = 'boot-tip-label';
  tipLabel.textContent = t('boot.tipLabel');
  const tip = document.createElement('p');
  tip.className = 'boot-tip';
  tip.textContent = tips[Math.floor(Math.random() * tips.length)] ?? '';
  board.append(loadingText, tipLabel, tip);
  ui.appendChild(board);

  if (!supportsWebGL2()) {
    showFailure(board);
    return;
  }

  try {
    const { createGame } = await import('./game/game');
    const game = await createGame(ui, canvas);
    board.remove();
    game.begin();
    if (import.meta.env.DEV) (window as unknown as { __beporowa: unknown }).__beporowa = game;
  } catch (error) {
    console.error(error);
    showFailure(board);
  }
}

void boot();
