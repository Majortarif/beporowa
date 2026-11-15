/**
 * Records every physics step's worth of driving into the buffer, and plays it back by writing the old
 * positions into the objects that are drawn. The real state is put aside first, and put back after.
 */

import type { PerspectiveCamera } from 'three';
import { Quaternion, Vector3 } from 'three';
import type { VehicleRig } from '../animation/vehicle-rig';
import type { AudioEngine } from '../audio/audio-engine';
import type { VehicleFx } from '../fx/vehicle-fx';
import type { TrafficSystem } from '../traffic/traffic-system';
import type { VehicleController, VehicleTelemetry } from '../vehicle/vehicle-controller';
import { PLAYER_FIELDS as F, PLAYER_SIZE, ReplayBuffer, type ReplayEvent } from './replay-buffer';
import { pace, planShots, poseFor, shotAt, type CameraChoice, type CarView, type Shot, type ShotPose } from './replay-director';

const HZ = 15;
const SCRATCH = { x: 0, y: 0, z: 0, w: 1 };
const POSITION = { x: 0, y: 0, z: 0 };

/** The parts of a police car or a racer that drawing it depends on. */
export interface ReplayActor {
  active: boolean;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevQx: number;
  prevQy: number;
  prevQz: number;
  prevQw: number;
  currX: number;
  currY: number;
  currZ: number;
  currQx: number;
  currQy: number;
  currQz: number;
  currQw: number;
}

interface SavedTraffic {
  alive: Uint8Array;
  type: Uint8Array;
  variant: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  v: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
}

export class ReplayPlayer {
  readonly buffer: ReplayBuffer;
  active = false;
  playing = true;
  /** How fast the player has asked for. */
  speed = 1;
  camera: CameraChoice = 'auto';
  time = 0;
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  private shots: Shot[] = [];
  private currentShot: Shot | null = null;
  private readonly anchor: CarView = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  private readonly car: CarView = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  private readonly pose: ShotPose = { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0, fov: 60 };
  private readonly located: [number, number, number] = [0, 0, 0];
  private readonly values = new Float32Array(PLAYER_SIZE);
  private readonly saved: number[][] = [];
  private savedTraffic: SavedTraffic | null = null;
  private readonly fakeTelemetry: Partial<VehicleTelemetry> = {};
  private lastEventIndex = 0;
  private readonly trafficOut = { x: 0, y: 0, z: 0, yaw: 0, type: 0, variant: 0 };
  private spin = 0;

  constructor(
    seconds: number,
    private readonly actors: readonly ReplayActor[],
    private readonly traffic: TrafficSystem,
    private readonly player: VehicleController,
  ) {
    this.buffer = new ReplayBuffer(seconds, HZ, actors.length, traffic.capacity);
  }

  /** Whether there is enough to be worth watching. */
  get ready(): boolean {
    return this.buffer.duration > 3;
  }

  /** Runs each physics step while driving. */
  record(dt: number): void {
    const slot = this.buffer.advance(dt);
    if (slot < 0) return;
    const car = this.player;
    const telemetry = car.telemetry;
    const position = car.position;
    const q = car.quaternion;
    const out = this.buffer.playerSlot(slot);
    out[F.x] = position.x;
    out[F.y] = position.y;
    out[F.z] = position.z;
    out[F.qx] = q.x;
    out[F.qy] = q.y;
    out[F.qz] = q.z;
    out[F.qw] = q.w;
    out[F.steer] = telemetry.steerAngle;
    out[F.speed] = telemetry.speed;
    out[F.rpm] = telemetry.rpm;
    out[F.throttle] = telemetry.throttle;
    out[F.brake] = telemetry.brake;
    out[F.nitro] = telemetry.nitroActive ? 1 : 0;
    out[F.drifting] = telemetry.drifting ? 1 : 0;
    out[F.reversing] = telemetry.reversing ? 1 : 0;
    out[F.slip] = telemetry.maxSlip;
    out[F.lateral] = telemetry.lateralAccel;
    out[F.longitudinal] = telemetry.longitudinalAccel;
    for (let i = 0; i < 4; i++) out[F.wheel0 + i] = car.wheels[i].springLength;

    this.actors.forEach((actor, index) => {
      this.buffer.writeActor(slot, index, actor.active, actor.currX, actor.currY, actor.currZ, actor.currQx, actor.currQy, actor.currQz, actor.currQw);
    });
    const traffic = this.traffic;
    for (let agent = 0; agent < traffic.capacity; agent++) {
      this.buffer.writeTraffic(slot, agent, traffic.alive[agent] === 1, traffic.x[agent], traffic.y[agent], traffic.z[agent], traffic.yaw[agent], traffic.type[agent], traffic.variant[agent]);
    }
  }

  /** Starts watching. The world underneath is left exactly where it was, to come back to. */
  enter(): void {
    this.active = true;
    this.playing = true;
    this.speed = 1;
    this.camera = 'auto';
    this.time = this.buffer.startTime;
    this.shots = planShots(this.buffer.startTime, this.buffer.endTime, Math.floor(this.buffer.endTime * 10) + 3);
    this.currentShot = null;
    this.lastEventIndex = 0;
    this.saved.length = 0;
    for (const actor of this.actors) {
      this.saved.push([actor.active ? 1 : 0, actor.prevX, actor.prevY, actor.prevZ, actor.prevQx, actor.prevQy, actor.prevQz, actor.prevQw, actor.currX, actor.currY, actor.currZ, actor.currQx, actor.currQy, actor.currQz, actor.currQw]);
    }
    const t = this.traffic;
    this.savedTraffic = {
      alive: t.alive.slice(),
      type: t.type.slice(),
      variant: t.variant.slice(),
      x: t.x.slice(),
      y: t.y.slice(),
      z: t.z.slice(),
      yaw: t.yaw.slice(),
      v: t.v.slice(),
      tx: t.tx.slice(),
      tz: t.tz.slice(),
    };
  }

  /** Stops watching and puts everything back. */
  exit(): void {
    this.active = false;
    this.actors.forEach((actor, index) => {
      const s = this.saved[index];
      actor.active = s[0] > 0.5;
      actor.prevX = s[1];
      actor.prevY = s[2];
      actor.prevZ = s[3];
      actor.prevQx = s[4];
      actor.prevQy = s[5];
      actor.prevQz = s[6];
      actor.prevQw = s[7];
      actor.currX = s[8];
      actor.currY = s[9];
      actor.currZ = s[10];
      actor.currQx = s[11];
      actor.currQy = s[12];
      actor.currQz = s[13];
      actor.currQw = s[14];
    });
    const saved = this.savedTraffic;
    if (saved) {
      const t = this.traffic;
      t.alive.set(saved.alive);
      t.type.set(saved.type);
      t.variant.set(saved.variant);
      t.x.set(saved.x);
      t.y.set(saved.y);
      t.z.set(saved.z);
      t.yaw.set(saved.yaw);
      t.v.set(saved.v);
      t.tx.set(saved.tx);
      t.tz.set(saved.tz);
    }
    this.savedTraffic = null;
  }

  /** Jumps to a share of the way through. */
  seek(share: number): void {
    this.time = this.buffer.startTime + (this.buffer.endTime - this.buffer.startTime) * share;
    this.lastEventIndex = 0;
  }

  get progress(): number {
    const span = this.buffer.endTime - this.buffer.startTime;
    return span > 0 ? (this.time - this.buffer.startTime) / span : 0;
  }

  /** Moves the film on, and sets everything in the world to where it was. */
  update(dt: number, camera: PerspectiveCamera, rig: VehicleRig, fx: VehicleFx, audio: AudioEngine): void {
    const buffer = this.buffer;
    if (this.playing) {
      const slowed = this.camera === 'auto' ? pace(buffer.events, this.time) : 1;
      this.time += dt * this.speed * slowed;
      if (this.time > buffer.endTime) {
        this.time = buffer.startTime;
        this.lastEventIndex = 0;
      }
    }
    buffer.locate(this.time, this.located);
    const [a, b, blend] = this.located;
    for (let field = 0; field < PLAYER_SIZE; field++) this.values[field] = buffer.playerValue(a, b, blend, field);
    buffer.playerRotation(a, b, blend, SCRATCH);
    this.position.set(this.values[F.x], this.values[F.y], this.values[F.z]);
    this.quaternion.set(SCRATCH.x, SCRATCH.y, SCRATCH.z, SCRATCH.w);

    const stepDt = this.playing ? dt * this.speed : 0;
    this.spin += (this.values[F.speed] / 0.32) * stepDt;
    rig.applyReplay(stepDt, this.position, this.quaternion, this.values, this.player, this.spin);

    this.applyActors(a, b, blend);
    this.applyTraffic(a, b, blend);
    this.placeCamera(camera);
    this.playSound(audio);
    if (this.playing) this.playEffects(stepDt, fx);
  }

  private applyActors(a: number, b: number, blend: number): void {
    const buffer = this.buffer;
    this.actors.forEach((actor, index) => {
      actor.active = buffer.actorActive(a, b, index);
      if (!actor.active) return;
      buffer.actorPosition(a, b, blend, index, POSITION);
      buffer.actorRotation(a, b, blend, index, SCRATCH);
      actor.prevX = actor.currX = POSITION.x;
      actor.prevY = actor.currY = POSITION.y;
      actor.prevZ = actor.currZ = POSITION.z;
      actor.prevQx = actor.currQx = SCRATCH.x;
      actor.prevQy = actor.currQy = SCRATCH.y;
      actor.prevQz = actor.currQz = SCRATCH.z;
      actor.prevQw = actor.currQw = SCRATCH.w;
    });
  }

  private applyTraffic(a: number, b: number, blend: number): void {
    const t = this.traffic;
    const out = this.trafficOut;
    for (let agent = 0; agent < t.capacity; agent++) {
      const there = this.buffer.trafficAt(a, b, blend, agent, out);
      t.alive[agent] = there ? 1 : 0;
      if (!there) continue;
      t.x[agent] = out.x;
      t.y[agent] = out.y;
      t.z[agent] = out.z;
      t.yaw[agent] = out.yaw;
      t.type[agent] = out.type;
      t.variant[agent] = out.variant;
      t.v[agent] = 0;
    }
  }

  private carAt(time: number, out: CarView): void {
    const located: [number, number, number] = [0, 0, 0];
    this.buffer.locate(time, located);
    const [a, b, blend] = located;
    out.x = this.buffer.playerValue(a, b, blend, F.x);
    out.y = this.buffer.playerValue(a, b, blend, F.y);
    out.z = this.buffer.playerValue(a, b, blend, F.z);
    this.buffer.playerRotation(a, b, blend, SCRATCH);
    const fx = 2 * (SCRATCH.x * SCRATCH.z + SCRATCH.w * SCRATCH.y);
    const fz = 1 - 2 * (SCRATCH.x * SCRATCH.x + SCRATCH.y * SCRATCH.y);
    const length = Math.hypot(fx, fz) || 1;
    out.fx = fx / length;
    out.fz = fz / length;
  }

  private placeCamera(camera: PerspectiveCamera): void {
    const chosen = shotAt(this.shots, this.time);
    if (!chosen) return;
    const kind = this.camera === 'auto' ? chosen.kind : this.camera;
    if (chosen !== this.currentShot) {
      this.currentShot = chosen;
      // A trackside camera stands where the car is about to be.
      this.carAt(chosen.from + (chosen.to - chosen.from) * 0.55, this.anchor);
    }
    this.carAt(this.time, this.car);
    const pose = poseFor(kind, this.car, this.anchor, this.time, chosen, this.pose);
    camera.position.set(pose.x, Math.max(pose.y, 0.25), pose.z);
    camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  private playSound(audio: AudioEngine): void {
    const f = this.fakeTelemetry;
    const v = this.values;
    f.rpm = v[F.rpm];
    f.throttle = this.playing ? v[F.throttle] : 0;
    f.brake = v[F.brake];
    f.reversing = v[F.reversing] > 0.5;
    f.speed = v[F.speed];
    f.maxSlip = this.playing ? v[F.slip] : 0;
    f.nitroActive = this.playing && v[F.nitro] > 0.5;
    audio.update(f as VehicleTelemetry, false);
  }

  private playEffects(dt: number, fx: VehicleFx): void {
    const v = this.values;
    if (v[F.slip] > 0.32) fx.replaySmoke(dt, v[F.x], v[F.y] - 0.5, v[F.z], v[F.slip]);
    const events = this.buffer.events;
    while (this.lastEventIndex < events.length && events[this.lastEventIndex].time < this.time - 0.5) this.lastEventIndex++;
    for (let i = this.lastEventIndex; i < events.length; i++) {
      const event: ReplayEvent = events[i];
      if (event.time > this.time) break;
      this.lastEventIndex = i + 1;
      if (event.kind === 'impact') fx.burstSparks(event.x, event.y, event.z, event.strength);
      if (event.kind === 'splash') fx.splash(event.x, event.y, event.z, event.strength);
    }
  }
}
