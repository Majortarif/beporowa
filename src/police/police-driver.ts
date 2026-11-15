/**
 * Turns "go there at this speed" into throttle, brake and steering for a police car, using
 * the same controls a player has. It looks ahead along a route, slows for corners, feels for walls
 * with short rays, steers around traffic, and reverses out when it gets stuck.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { POLICE } from '../config/police-tuning';
import { clamp, dampFactor } from '../core/math';
import { createIntent, type Intent } from '../input/intent';
import { GROUP_WHEEL_RAY, type PhysicsWorld } from '../physics/physics-world';
import type { VehicleController } from '../vehicle/vehicle-controller';

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** The numbers that shape how a driver drives. */
export type DriverTuning = typeof POLICE.driver;

export class PoliceDriver {
  readonly intent: Intent = createIntent();
  /** How the road ahead looks after the last followRoute: metres of straight before the next real bend. */
  straightAhead = 0;
  /** The speed the road allowed on the last followRoute, m/s. */
  allowedSpeed = 0;
  /** Throw the car sideways into tight corners. */
  driftCorners = false;
  /** Flat x, z values of the road to follow. */
  route: number[] = [];
  private routeIndex = 0;
  private steer = 0;
  private stuckSeconds = 0;
  private reverseSeconds = 0;
  private whiskerSide = 0;
  private whiskerSlow = 1;
  private whiskerTimer = 0;
  private readonly ray: RAPIER.Ray;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly car: VehicleController,
    /** Public so that a racer's corner speed can change during a race. */
    readonly tuning: DriverTuning = { ...POLICE.driver },
  ) {
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  setRoute(points: number[]): void {
    this.route = points;
    this.routeIndex = 0;
  }

  reset(): void {
    this.route = [];
    this.routeIndex = 0;
    this.steer = 0;
    this.stuckSeconds = 0;
    this.reverseSeconds = 0;
    this.whiskerSide = 0;
    this.whiskerSlow = 1;
  }

  /** Finds the nearest point on the route again, after the car has been moved. */
  relocate(x: number, z: number): void {
    const route = this.route;
    let best = this.routeIndex;
    let bestDistance = Infinity;
    // Only near where it was: a many-lap route passes this same spot once per lap.
    const from = Math.max(0, this.routeIndex - 60);
    const to = Math.min(route.length - 1, this.routeIndex + 60);
    for (let i = from; i < to; i += 2) {
      const dx = route[i] - x;
      const dz = route[i + 1] - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    this.routeIndex = best;
  }

  /** Heading of the car, as rotation about +Y. */
  private heading(): number {
    const q = this.car.quaternion;
    return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
  }

  /** Follows the route. Returns false once it has run out of road. */
  followRoute(dt: number, maxSpeed: number, avoidSide: number, avoidSlow: number, nitro: boolean, lateral = 0): boolean {
    const route = this.route;
    if (route.length < 4) return false;
    const config = this.tuning;
    const position = this.car.position;
    const speed = this.car.telemetry.speed;

    // Walk forward to the point nearest the car.
    let best = this.routeIndex;
    let bestDistance = Infinity;
    const end = Math.min(route.length, this.routeIndex + 40);
    for (let i = this.routeIndex; i < end; i += 2) {
      const dx = route[i] - position.x;
      const dz = route[i + 1] - position.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    this.routeIndex = best;

    const spacing = config.routePointSpacing;
    const lookPoints = Math.round((config.lookAheadBase + speed * config.lookAheadPerSpeed) / spacing);
    const lookIndex = Math.min(route.length - 2, best + lookPoints * 2);
    if (best >= route.length - 4 && bestDistance < 100) return false;

    // How fast the road ahead allows: the tightest bend within braking reach.
    let allowed = maxSpeed;
    let straight = 22 * spacing;
    for (let i = best + 2; i + 4 < route.length && i < best + 44; i += 2) {
      const ax = route[i] - route[i - 2];
      const az = route[i + 1] - route[i - 1];
      const bx = route[i + 2] - route[i];
      const bz = route[i + 3] - route[i + 1];
      const turn = Math.abs(wrapAngle(Math.atan2(bx, bz) - Math.atan2(ax, az)));
      if (turn < 0.02) continue;
      const radius = spacing / turn;
      // Drivers know a wet road when they see one, and take the same bend slower.
      const corner = Math.sqrt(config.cornerLateral * this.physics.weatherGrip * radius);
      const distance = ((i - best) / 2) * spacing;
      if (turn > 0.09 && distance < straight) straight = distance;
      allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * config.cornerBrake * distance));
    }
    this.straightAhead = straight;
    this.allowedSpeed = allowed;
    let targetX = route[lookIndex];
    let targetZ = route[lookIndex + 1];
    if (lateral !== 0 && lookIndex + 3 < route.length) {
      // Aim to one side of the line: left of travel is (tz, -tx).
      const tx = route[lookIndex + 2] - route[lookIndex];
      const tz = route[lookIndex + 3] - route[lookIndex + 1];
      const length = Math.hypot(tx, tz) || 1;
      targetX += (tz / length) * lateral;
      targetZ -= (tx / length) * lateral;
    }
    this.driveToward(dt, targetX, targetZ, allowed, avoidSide, avoidSlow, nitro);
    return true;
  }

  /** Drives straight at a point, for when the target is in plain sight. */
  driveToward(dt: number, targetX: number, targetZ: number, targetSpeed: number, avoidSide: number, avoidSlow: number, nitro: boolean): void {
    const config = this.tuning;
    const position = this.car.position;
    const telemetry = this.car.telemetry;
    const intent = this.intent;
    const speed = telemetry.speed;
    const heading = this.heading();

    this.updateWhiskers(dt, heading, speed);

    const error = wrapAngle(Math.atan2(targetX - position.x, targetZ - position.z) - heading);
    // A positive error means the target is on the car's left, and positive steer means right.
    const steerTarget = clamp(-error * config.steerGain + this.whiskerSide * config.whiskerSteer + avoidSide * config.avoidSteer, -1, 1);
    this.steer += (steerTarget - this.steer) * dampFactor(config.steerSmoothing, dt);
    intent.steer = this.steer;

    let wanted = targetSpeed * this.whiskerSlow * avoidSlow;
    // A big heading error means slowing right down. Otherwise the turning circle stays wider than
    // the distance to the target, and the car orbits it for ever.
    const turning = Math.abs(error);
    if (turning > config.turnSlowFrom) {
      const t = clamp((turning - config.turnSlowFrom) / (config.turnSlowTo - config.turnSlowFrom), 0, 1);
      wanted = Math.min(wanted, config.turnSlowTop + (config.turnSlowSpeed - config.turnSlowTop) * t);
    }

    intent.handbrake = Math.abs(error) > config.handbrakeError && speed > config.handbrakeMinSpeed;
    if (this.driftCorners && speed > 15 && speed > wanted + 2 && Math.abs(error) > 0.22) intent.handbrake = true;
    intent.nitro = nitro && Math.abs(error) < config.nitroMinError && speed < wanted;

    // Stuck against something: back up with the wheel turned, then try again.
    if (this.reverseSeconds > 0) {
      this.reverseSeconds -= dt;
      intent.throttle = 0;
      intent.brake = 1;
      intent.handbrake = false;
      intent.steer = -this.steer * config.reverseSteer;
      return;
    }
    if (speed < 1.4 && wanted > 3) {
      this.stuckSeconds += dt;
      if (this.stuckSeconds > config.stuckSeconds) {
        this.stuckSeconds = 0;
        this.reverseSeconds = config.reverseSeconds;
      }
    } else {
      this.stuckSeconds = 0;
    }

    if (wanted < 0.5) {
      intent.throttle = 0;
      intent.brake = speed > 0.3 ? 1 : 0;
    } else if (speed < wanted - 0.5) {
      intent.throttle = 1;
      intent.brake = 0;
    } else if (speed > wanted + 2) {
      intent.throttle = 0;
      intent.brake = clamp((speed - wanted) / 6, 0.2, 1);
    } else {
      intent.throttle = 0.25;
      intent.brake = 0;
    }
  }

  /** Stands still. */
  hold(): void {
    const intent = this.intent;
    intent.throttle = 0;
    intent.brake = this.car.telemetry.speed > 0.5 ? 1 : 0;
    intent.steer = 0;
    intent.handbrake = false;
    intent.nitro = false;
  }

  /** Short rays ahead that find walls before the car does. */
  private updateWhiskers(dt: number, heading: number, speed: number): void {
    this.whiskerTimer -= dt;
    if (this.whiskerTimer > 0) return;
    this.whiskerTimer = 0.07;
    const config = this.tuning;
    const length = config.whiskerBase + speed * config.whiskerPerSpeed;
    const center = this.castWhisker(heading, length);
    const left = this.castWhisker(heading + config.whiskerAngle, length * 0.8);
    const right = this.castWhisker(heading - config.whiskerAngle, length * 0.8);

    this.whiskerSide = 0;
    this.whiskerSlow = 1;
    if (left < 1 || right < 1 || center < 1) {
      // Positive means steer right, away from a wall on the left.
      this.whiskerSide = clamp((1 - left) - (1 - right), -1, 1);
      if (center < 1) {
        if (Math.abs(this.whiskerSide) < 0.05) this.whiskerSide = left > right ? -1 : 1;
        this.whiskerSlow = Math.max(config.whiskerSlow, center);
      }
    }
  }

  /** Fraction of the ray that is clear: 1 means nothing was hit. */
  private castWhisker(angle: number, length: number): number {
    const position = this.car.position;
    const ray = this.ray;
    ray.origin.x = position.x;
    ray.origin.y = position.y;
    ray.origin.z = position.z;
    ray.dir.x = Math.sin(angle);
    ray.dir.y = 0;
    ray.dir.z = Math.cos(angle);
    const hit = this.physics.world.castRay(ray, length, true, undefined, GROUP_WHEEL_RAY, undefined, this.car.body);
    return hit ? hit.timeOfImpact / length : 1;
  }
}
