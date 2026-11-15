/**
 * Everything the career does while the city runs: paying out, wearing the car down, daily rewards,
 * achievements, side jobs, rumours, and noticing when the car has stopped somewhere worth stopping.
 */

import { JOBS, JOB_BY_ID, RUMOURS_PER_RIVAL, type JobDef, type NpcId } from '../config/achievements';
import { ATMOSPHERE } from '../config/atmosphere';
import { PROGRESS } from '../config/progression';
import { RIVALS } from '../config/rivals';
import type { EventBus } from '../core/events';
import { formatNumber, t, tList } from '../i18n';
import { claimDaily, earn, levelFor, spend, wearFrom } from '../progression/economy';
import { ProgressTracker } from '../progression/progress-tracker';
import { currentTier, type ResultChange } from '../race/ring-ladder';
import { getCareer, saveCareer } from '../save/career';
import { ProgressHud } from '../ui/progress-hud';
import type { CityHud } from '../ui/city-hud';
import { POINTS_OF_INTEREST } from '../world/city/city-map';
import type { StallSpot } from '../world/city/city-props';
import type { CityWorld } from '../world/city/city-world';

/** What the career needs the rest of the game to do. */
export interface CareerHost {
  phone(from: string, text: string, seconds: number): void;
  routeTo(poiId: string): void;
  clearRoute(): void;
  policeActive(): boolean;
  racing(): boolean;
  /** Some offer of a race is already on the plate. */
  raceOffered(): boolean;
  /** The car's condition or parts changed, so its numbers must be worked out again. */
  carChanged(): void;
  /** Fills the nitro, mends any puncture, and marks this spot as where to start next time. */
  restCar(): void;
  enterGarage(): void;
  enterStall(stall: StallSpot, index: number): void;
}

type Stop = { kind: 'garage' } | { kind: 'tea'; stall: StallSpot; index: number };

const SECONDS_BETWEEN_OFFER_CHECKS = 0.2;

export class CareerDirector {
  readonly tracker: ProgressTracker;
  readonly hud: ProgressHud;
  private readonly teaStalls: StallSpot[];
  private offer: Stop | null = null;
  private offerTimer = 0;
  private pendingCash = 0;
  private pendingRep = 0;
  private greeted = false;
  private rainMetres = 0;

  constructor(
    bus: EventBus,
    uiRoot: HTMLElement,
    private readonly world: CityWorld,
    private readonly cityHud: CityHud,
    private readonly host: CareerHost,
  ) {
    this.teaStalls = world.props.stalls.filter((stall) => stall.isTea);
    this.hud = new ProgressHud(uiRoot);
    this.hud.onPrompt = () => this.acceptStop();
    this.tracker = new ProgressTracker(bus, getCareer, saveCareer);
    this.tracker.onAchievement = (achievement) => {
      this.hud.showAchievement(t(`ach.${achievement.id}.title`), achievement.cash);
    };
    this.tracker.onLevelUp = (level) => this.hud.showLevelUp(level, PROGRESS.levelUpCash);
    this.tracker.onJobDone = (job) => {
      this.host.phone(t(`adda.npc.${job.npc}.name`), t(`adda.job.${job.id}.done`, { cash: formatNumber(job.cash) }), 8);
      if (job.kind === 'goto') this.host.clearRoute();
    };
    this.tracker.onJobFailed = (job) => {
      this.host.phone(t(`adda.npc.${job.npc}.name`), t('adda.jobLate'), 7);
      this.host.clearRoute();
    };

    const wear = (strength: number, soft: boolean): void => {
      wearFrom(getCareer(), strength, soft);
      this.host.carChanged();
      saveCareer();
    };
    bus.on('impact', ({ strength }) => wear(strength, false));
    bus.on('trafficHit', ({ strength, soft }) => wear(strength, soft));
    bus.on('policeContact', ({ pit }) => wear(pit ? 0.6 : 0.15, false));
    bus.on('potholeHit', () => {
      wear(ATMOSPHERE.potholeWear, false);
      this.tracker.count('potholes');
    });
  }

  // ---------- Pay ----------

  /** Stunts in free roam turn into a little money and a little standing. A race pays its own way. */
  payRoam(points: number): void {
    if (this.host.racing()) return;
    this.pendingCash += points * PROGRESS.roamCashPerPoint;
    this.pendingRep += points * PROGRESS.roamRepPerPoint;
    const cash = Math.floor(this.pendingCash);
    const rep = Math.floor(this.pendingRep);
    if (cash < 1 && rep < 1) return;
    this.pendingCash -= cash;
    this.pendingRep -= rep;
    this.pay(cash, rep);
  }

  payEscape(points: number): void {
    this.pay(Math.round(points * PROGRESS.escapeCashPerPoint), Math.round(points * PROGRESS.roamRepPerPoint));
  }

  /** Takes an arrest's fine. @returns what was actually paid */
  payFine(fine: number): number {
    const career = getCareer();
    const paid = Math.min(career.cash, Math.round(fine * PROGRESS.fineCashPerPoint));
    spend(career, paid);
    saveCareer();
    return paid;
  }

  private pay(cash: number, rep: number): void {
    const result = earn(getCareer(), cash, rep);
    if (result.levelUp !== null) this.hud.showLevelUp(result.levelUp, PROGRESS.levelUpCash);
    this.tracker.check();
    saveCareer();
  }

  /** After a race has written its result into the career. */
  afterRace(change: ResultChange): void {
    if (change.levelUp !== null) this.hud.showLevelUp(change.levelUp, PROGRESS.levelUpCash);
    this.tracker.check();
    saveCareer();
  }

  // ---------- Start of a drive ----------

  /** Runs when a drive begins: the day's reward, and any job still in hand. */
  greet(): void {
    const career = getCareer();
    this.hud.setAddaMode(career.addaMode);
    const active = career.job ? JOB_BY_ID.get(career.job.id) : undefined;
    if (active?.place) this.host.routeTo(active.place);
    if (this.greeted) return;
    this.greeted = true;
    const daily = claimDaily(career, new Date());
    if (!daily) return;
    this.tracker.check();
    saveCareer();
    this.host.phone(t('ring.phoneFrom'), t('adda.daily', { cash: formatNumber(daily.cash), streak: formatNumber(daily.streak) }), 8);
  }

  // ---------- Each frame ----------

  /** Runs once per rendered frame, driving or not. */
  frame(dt: number, x: number, z: number, speed: number, domActive: boolean, driving: boolean, rain = 0): void {
    const career = getCareer();
    this.hud.update(dt);
    this.cityHud.setMoney(career.cash, levelFor(career.ringPoints), career.condition);
    if (!driving) return;
    this.tracker.frame(dt, speed, domActive, !this.host.racing());
    if (rain > 0.5) {
      this.rainMetres += speed * dt;
      if (this.rainMetres >= 500) {
        this.tracker.count('rainKilometres', this.rainMetres / 1000);
        this.rainMetres = 0;
      }
    }
    this.updateJob(x, z);
    this.offerTimer -= dt;
    if (this.offerTimer <= 0) {
      this.offerTimer = SECONDS_BETWEEN_OFFER_CHECKS;
      this.updateOffer(x, z, speed);
    }
  }

  private updateJob(x: number, z: number): void {
    const career = getCareer();
    const active = career.job;
    const job = active ? JOB_BY_ID.get(active.id) : undefined;
    if (!active || !job) {
      this.hud.showJob(null, null, null);
      return;
    }
    const goal = t(`adda.job.${job.id}.goal`);
    if (job.kind === 'goto') {
      this.hud.showJob(goal, null, active.secondsLeft);
      const poi = POINTS_OF_INTEREST.find((candidate) => candidate.id === job.place);
      if (poi) {
        const network = this.world.network;
        const node = network.nodes[network.nodeIndex(poi.node)];
        if (Math.hypot(node.x - x, node.z - z) < PROGRESS.jobArriveRadius) this.tracker.arrivedAtJobPlace();
      }
    } else {
      this.hud.showJob(goal, this.tracker.jobShare(), null);
    }
  }

  private updateOffer(x: number, z: number, speed: number): void {
    const kmh = speed * 3.6;
    let found: Stop | null = null;
    if (!this.host.racing() && !this.host.policeActive() && !this.host.raceOffered()) {
      const home = this.world.garageHome;
      if (kmh < PROGRESS.garage.enterSpeedKmh && Math.hypot(home.x - x, home.z - z) < PROGRESS.garage.enterRadius) {
        found = { kind: 'garage' };
      } else if (kmh < PROGRESS.tea.enterSpeedKmh) {
        let best: number = PROGRESS.tea.enterRadius;
        this.teaStalls.forEach((stall, index) => {
          const distance = Math.hypot(stall.x - x, stall.z - z);
          if (distance < best) {
            best = distance;
            found = { kind: 'tea', stall, index };
          }
        });
      }
    }
    this.offer = found;
    const kind = (found as Stop | null)?.kind ?? null;
    this.hud.setPrompt(kind === 'garage' ? 'adda.prompt.garage' : kind === 'tea' ? 'adda.prompt.tea' : null);
  }

  /** Takes up the stop on offer. @returns false if there was none */
  acceptStop(): boolean {
    const offer = this.offer;
    if (!offer) return false;
    this.offer = null;
    this.hud.setPrompt(null);
    if (offer.kind === 'garage') this.host.enterGarage();
    else this.host.enterStall(offer.stall, offer.index);
    return true;
  }

  // ---------- At the tea stall ----------

  /** A cup of tea: a rest for the driver and a look at the car. @returns what it did, in words */
  teaPoured(): string[] {
    const career = getCareer();
    const price = Math.min(career.cash, PROGRESS.tea.price);
    spend(career, price);
    const mended = career.condition < PROGRESS.tea.repairTo;
    career.condition = Math.max(career.condition, PROGRESS.tea.repairTo);
    this.host.restCar();
    this.host.carChanged();
    this.tracker.count('teas');
    saveCareer();
    const facts = [t('adda.tea.nitro'), t('adda.tea.saved')];
    if (mended) facts.unshift(t('adda.tea.mended'));
    return facts;
  }

  /** The next rumour about whoever the player is racing next. */
  rumour(): string | null {
    const career = getCareer();
    if (career.champion) return null;
    const rival = RIVALS.find((candidate) => candidate.rank === currentTier(career));
    if (!rival) return null;
    const lines = tList(`adda.rumour.${rival.id}`);
    for (let i = 0; i < RUMOURS_PER_RIVAL; i++) {
      const key = `${rival.id}:${i}`;
      if (career.clues.includes(key)) continue;
      career.clues.push(key);
      this.tracker.count('rumours');
      saveCareer();
      return lines[i] ?? null;
    }
    return null;
  }

  /** Whichever job this person has not had done yet, or the first again. */
  jobFor(npc: NpcId): JobDef | null {
    const jobs = JOBS.filter((job) => job.npc === npc);
    return jobs.find((job) => !getCareer().jobsDone.includes(job.id)) ?? jobs[0] ?? null;
  }

  jobInHand(): boolean {
    return getCareer().job !== null;
  }

  acceptJob(id: string): void {
    if (!this.tracker.acceptJob(id)) return;
    const job = JOB_BY_ID.get(id);
    if (job?.place) this.host.routeTo(job.place);
  }

  /** Gives up the job in hand, from the ledger. */
  dropJob(): void {
    const job = getCareer().job ? JOB_BY_ID.get(getCareer().job?.id ?? '') : undefined;
    this.tracker.dropJob();
    if (job?.kind === 'goto') this.host.clearRoute();
  }
}
