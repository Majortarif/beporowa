/** The friends board: a name, a room code to share, who is in, and the host's start button. */

import { EVENT_BY_ID, RACE_EVENTS } from '../config/race-events';
import { onI18nChange, t } from '../i18n';
import type { NetStatus, RoomPeer } from '../online/net-session';
import { flowerSvg } from './ornaments';

export interface FriendsActions {
  connectAndCreate(name: string): void;
  connectAndJoin(name: string, code: string, spectate: boolean): void;
  start(eventId: string): void;
  leave(): void;
  close(): void;
}

export interface FriendsView {
  configured: boolean;
  status: NetStatus;
  code: string | null;
  myId: number;
  hostId: number;
  peers: readonly RoomPeer[];
  message: string;
  name: string;
}

/** Races friends can run: anything with a line to follow, except the boss with its police. */
export function friendEvents(): string[] {
  return RACE_EVENTS.filter((event) => event.mode !== 'drift' && event.mode !== 'takedown' && event.mode !== 'boss').map((event) => event.id);
}

export class FriendsScreen {
  readonly element: HTMLElement;
  private readonly q = <T extends HTMLElement>(selector: string): T => this.element.querySelector(selector) as T;
  private view: FriendsView | null = null;

  constructor(private readonly actions: FriendsActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-friends';
    this.element.innerHTML = `
      <div class="board board-menu board-wide">
        <div class="board-corner board-corner-tl">${flowerSvg('#c58cff', '#f2a20c', '#efe3c8')}</div>
        <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>
        <h2 class="menu-title" data-t="friends.title"></h2>
        <p class="friends-status" role="status" aria-live="polite"></p>
        <p class="friends-offline" data-t="friends.notConfigured"></p>
        <div class="friends-lobby">
          <label class="friends-field"><span data-t="friends.name"></span><input class="friends-name" type="text" maxlength="24" autocomplete="nickname" /></label>
          <div class="friends-row">
            <button type="button" class="plaque plaque-tomato" data-action="create" data-t="friends.create"></button>
          </div>
          <div class="friends-row">
            <label class="friends-field friends-code-field"><span data-t="friends.code"></span><input class="friends-code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" /></label>
            <button type="button" class="plaque plaque-teal" data-action="join" data-t="friends.join"></button>
            <button type="button" class="plaque plaque-soot" data-action="watch" data-t="friends.watch"></button>
          </div>
        </div>
        <div class="friends-room">
          <p class="friends-room-code"></p>
          <ul class="friends-peers"></ul>
          <div class="friends-host">
            <label class="friends-field"><span data-t="friends.event"></span><select class="friends-event"></select></label>
            <button type="button" class="plaque plaque-tomato plaque-big" data-action="start" data-t="friends.start"></button>
          </div>
          <p class="friends-wait" data-t="friends.waitHost"></p>
          <button type="button" class="plaque plaque-soot" data-action="leave" data-t="friends.leave"></button>
        </div>
        <p class="friends-note" data-t="friends.note"></p>
        <button type="button" class="plaque plaque-indigo" data-action="back" data-t="settings.back"></button>
      </div>`;
    const name = (): string => this.q<HTMLInputElement>('.friends-name').value;
    this.q('[data-action="create"]').addEventListener('click', () => this.actions.connectAndCreate(name()));
    this.q('[data-action="join"]').addEventListener('click', () => this.actions.connectAndJoin(name(), this.q<HTMLInputElement>('.friends-code').value, false));
    this.q('[data-action="watch"]').addEventListener('click', () => this.actions.connectAndJoin(name(), this.q<HTMLInputElement>('.friends-code').value, true));
    this.q('[data-action="start"]').addEventListener('click', () => this.actions.start(this.q<HTMLSelectElement>('.friends-event').value));
    this.q('[data-action="leave"]').addEventListener('click', () => this.actions.leave());
    this.q('[data-action="back"]').addEventListener('click', () => this.actions.close());
    this.q<HTMLInputElement>('.friends-code').addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    onI18nChange(() => this.render());
  }

  show(view: FriendsView): void {
    this.view = view;
    const nameInput = this.q<HTMLInputElement>('.friends-name');
    if (!nameInput.value) nameInput.value = view.name;
    this.render();
  }

  private render(): void {
    const view = this.view;
    this.element.querySelectorAll<HTMLElement>('[data-t]').forEach((element) => {
      element.textContent = t(element.dataset.t as string);
    });
    if (!view) return;
    const inRoom = view.code !== null;
    this.q('.friends-offline').hidden = view.configured;
    this.q('.friends-lobby').hidden = !view.configured || inRoom;
    this.q('.friends-room').hidden = !inRoom;
    this.q('.friends-status').textContent = view.message || t(`friends.status.${view.status}`);
    if (!inRoom) return;
    this.q('.friends-room-code').textContent = t('friends.roomCode', { code: view.code ?? '' });
    const list = this.q('.friends-peers');
    list.replaceChildren();
    for (const peer of view.peers) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = peer.name;
      const badges = document.createElement('span');
      badges.className = 'friends-badges';
      const tags: string[] = [];
      if (peer.id === view.hostId) tags.push(t('friends.host'));
      if (peer.id === view.myId) tags.push(t('friends.you'));
      if (peer.spectator) tags.push(t('friends.watcher'));
      else tags.push(t(`car.${peer.car}.name`));
      badges.textContent = tags.join(' · ');
      item.append(name, badges);
      list.appendChild(item);
    }
    const isHost = view.hostId === view.myId;
    this.q('.friends-host').hidden = !isHost;
    this.q('.friends-wait').hidden = isHost;
    const select = this.q<HTMLSelectElement>('.friends-event');
    if (select.options.length === 0 || select.dataset.locale !== t('app.name')) {
      const chosen = select.value;
      select.replaceChildren();
      for (const id of friendEvents()) {
        if (!EVENT_BY_ID.has(id)) continue;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = t(`race.event.${id}.name`);
        select.appendChild(option);
      }
      if (chosen) select.value = chosen;
      select.dataset.locale = t('app.name');
    }
  }

  focusFirst(): void {
    this.element.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
  }
}
