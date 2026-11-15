/**
 * The tea stall: a cup being poured, then whoever is sitting there. Each talk is a short tree of
 * lines from the language files, and anyone can be asked for a rumour or for a bit of work.
 */

import { NPC_IDS, TALK_SHAPE, type JobDef, type NpcId } from '../config/achievements';
import { PROGRESS } from '../config/progression';
import { formatInteger, formatNumber, onI18nChange, t } from '../i18n';
import { npcPortraitUrl } from './rival-portraits';

export interface AddaHost {
  /** The cup is ready, so it does the car and the save good. @returns what the stall did, in words */
  teaPoured(): string[];
  /** Hears a new rumour, if there is one. @returns the words, or null */
  rumour(): string | null;
  /** The work this person has going. */
  jobFor(npc: NpcId): JobDef | null;
  jobInHand(): boolean;
  acceptJob(id: string): void;
  leave(): void;
}

const NPCS_AT_A_STALL = 3;

/** A kettle pouring into a glass, painted flat. Timing comes from CSS, so it can be turned off. */
const TEA_ART = `
  <svg class="tea-art" viewBox="0 0 240 200" aria-hidden="true">
    <g class="tea-kettle">
      <path d="M60 28h60l10 48H50z" fill="#8c9198" stroke="#1b1410" stroke-width="4" stroke-linejoin="round"/>
      <path d="M126 44l36-12 8 10-40 22z" fill="#8c9198" stroke="#1b1410" stroke-width="4" stroke-linejoin="round"/>
      <path d="M50 42c-24 0-24 34 4 30" fill="none" stroke="#1b1410" stroke-width="6"/>
      <rect x="70" y="16" width="40" height="12" fill="#d8402b" stroke="#1b1410" stroke-width="4"/>
    </g>
    <path class="tea-stream" d="M170 44q10 40 2 86" fill="none" stroke="#b5651d" stroke-width="7" stroke-linecap="round"/>
    <g>
      <path d="M144 122h56l-8 66h-40z" fill="#efe3c8" fill-opacity=".55" stroke="#1b1410" stroke-width="4" stroke-linejoin="round"/>
      <path class="tea-fill" d="M148 150h48l-5 36h-38z" fill="#b5651d"/>
    </g>
    <g class="tea-steam" fill="none" stroke="#efe3c8" stroke-width="4" stroke-linecap="round">
      <path d="M160 112q-8-12 0-22t0-22"/>
      <path d="M184 112q8-12 0-22t0-22"/>
    </g>
  </svg>`;

type Phase = 'tea' | 'done' | 'talk';

export class AddaScreen {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly leave: HTMLButtonElement;
  private phase: Phase = 'tea';
  private stallIndex = 0;
  private facts: string[] = [];
  private npc: NpcId = 'mokbul';
  private node: string | null = 'open';
  private line = '';
  private offered: JobDef | null = null;
  private timer = 0;

  constructor(private readonly host: AddaHost) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-adda';
    this.element.innerHTML = `
      <div class="adda-panel board">
        <h2 class="menu-title adda-title"></h2>
        <div class="adda-body" aria-live="polite"></div>
        <button type="button" class="plaque plaque-tomato adda-leave"></button>
      </div>`;
    this.title = this.element.querySelector('.adda-title') as HTMLElement;
    this.body = this.element.querySelector('.adda-body') as HTMLElement;
    this.leave = this.element.querySelector('.adda-leave') as HTMLButtonElement;
    this.leave.addEventListener('click', () => this.host.leave());
    onI18nChange(() => this.render());
  }

  /** Opens at a stall, with the kettle already on. */
  show(stallIndex: number): void {
    this.stallIndex = stallIndex;
    this.phase = 'tea';
    this.render();
    window.clearTimeout(this.timer);
    if (document.documentElement.dataset.reduceMotion === '1') {
      this.finishTea();
      return;
    }
    this.timer = window.setTimeout(() => this.finishTea(), PROGRESS.tea.seconds * 1000);
  }

  /** Stops the kettle, if the player leaves while it pours. */
  hide(): void {
    window.clearTimeout(this.timer);
    if (this.phase === 'tea') this.finishTea(false);
  }

  private finishTea(show = true): void {
    window.clearTimeout(this.timer);
    this.facts = this.host.teaPoured();
    this.phase = 'done';
    if (show) this.render();
  }

  private npcsHere(): NpcId[] {
    const people: NpcId[] = [];
    for (let i = 0; i < NPCS_AT_A_STALL; i++) people.push(NPC_IDS[(this.stallIndex + i) % NPC_IDS.length]);
    return people;
  }

  private talkTo(npc: NpcId): void {
    this.npc = npc;
    this.node = 'open';
    this.offered = null;
    this.line = t(`adda.npc.${npc}.talk.open.line`);
    this.phase = 'talk';
    this.render();
  }

  private render(): void {
    this.title.textContent = t(this.phase === 'talk' ? `adda.npc.${this.npc}.name` : 'adda.title');
    this.leave.textContent = t('adda.leave');
    this.leave.hidden = this.phase === 'tea';
    this.body.replaceChildren();
    if (this.phase === 'tea') this.renderTea();
    else if (this.phase === 'done') this.renderPeople();
    else this.renderTalk();
    this.element.querySelector<HTMLElement>('.adda-body button, .adda-leave')?.focus({ preventScroll: true });
  }

  private button(text: string, tone: string, handler: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `plaque ${tone}`;
    button.textContent = text;
    button.addEventListener('click', handler);
    return button;
  }

  private renderTea(): void {
    const art = document.createElement('div');
    art.className = 'tea-stage';
    art.style.setProperty('--tea-seconds', `${PROGRESS.tea.seconds}s`);
    art.innerHTML = TEA_ART;
    const words = document.createElement('p');
    words.className = 'adda-line';
    words.textContent = t('adda.tea.pouring', { price: formatNumber(PROGRESS.tea.price) });
    this.body.append(art, words, this.button(t('adda.tea.skip'), 'plaque-soot', () => this.finishTea()));
  }

  private renderPeople(): void {
    const list = document.createElement('ul');
    list.className = 'adda-facts';
    for (const fact of this.facts) {
      const item = document.createElement('li');
      item.textContent = fact;
      list.appendChild(item);
    }
    const who = document.createElement('p');
    who.className = 'adda-who';
    who.textContent = t('adda.who');
    const people = document.createElement('div');
    people.className = 'adda-people';
    for (const npc of this.npcsHere()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'adda-person';
      const face = document.createElement('img');
      face.alt = '';
      face.src = npcPortraitUrl(npc);
      const name = document.createElement('strong');
      name.textContent = t(`adda.npc.${npc}.name`);
      const role = document.createElement('span');
      role.textContent = t(`adda.npc.${npc}.role`);
      button.append(face, name, role);
      button.addEventListener('click', () => this.talkTo(npc));
      people.appendChild(button);
    }
    this.body.append(list, who, people);
  }

  private renderTalk(): void {
    const talk = document.createElement('div');
    talk.className = 'adda-talk';
    const face = document.createElement('img');
    face.className = 'adda-face';
    face.alt = '';
    face.src = npcPortraitUrl(this.npc);
    const line = document.createElement('p');
    line.className = 'adda-line';
    line.textContent = this.line;
    talk.append(face, line);
    this.body.appendChild(talk);

    const replies = document.createElement('div');
    replies.className = 'adda-replies';
    if (this.offered) {
      const job = this.offered;
      replies.append(
        this.button(t('adda.jobAccept', { cash: formatNumber(job.cash) }), 'plaque-teal', () => {
          this.host.acceptJob(job.id);
          this.offered = null;
          this.node = null;
          this.line = t('adda.jobTaken', { goal: t(`adda.job.${job.id}.goal`) });
          this.render();
        }),
        this.button(t('adda.jobDecline'), 'plaque-soot', () => {
          this.offered = null;
          this.line = t('adda.jobDeclined');
          this.render();
        }),
      );
    } else {
      const node = TALK_SHAPE.find((candidate) => candidate.id === this.node);
      for (const reply of node?.replies ?? []) {
        replies.appendChild(
          this.button(t(`adda.npc.${this.npc}.talk.${node?.id}.${reply.id}`), 'plaque-indigo', () => {
            this.node = reply.next;
            if (reply.next) this.line = t(`adda.npc.${this.npc}.talk.${reply.next}.line`);
            this.render();
          }),
        );
      }
      replies.append(
        this.button(t('adda.askRumour'), 'plaque-marigold', () => this.askRumour()),
        this.button(t('adda.askJob'), 'plaque-teal', () => this.askJob()),
        this.button(t('adda.askOther'), 'plaque-soot', () => {
          this.phase = 'done';
          this.render();
        }),
      );
    }
    this.body.appendChild(replies);
  }

  private askRumour(): void {
    this.node = null;
    this.line = this.host.rumour() ?? t('adda.noRumour');
    this.render();
  }

  private askJob(): void {
    this.node = null;
    if (this.host.jobInHand()) {
      this.line = t('adda.jobBusy');
      this.render();
      return;
    }
    const job = this.host.jobFor(this.npc);
    if (!job) {
      this.line = t('adda.noJob');
      this.render();
      return;
    }
    this.offered = job;
    this.line = t(`adda.job.${job.id}.offer`);
    if (job.seconds) this.line += ` ${t('adda.jobTime', { seconds: formatInteger(job.seconds) })}`;
    this.render();
  }
}
