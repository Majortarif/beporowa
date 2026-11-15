import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config/tuning';

export type SurfaceKind = 'road' | 'shoulder' | 'dirt' | 'plaza' | 'flood';

/** Collision groups are (memberships << 16) | filter. Traffic has its own membership bit. */
const TRAFFIC_BIT = 0x0004;
export const GROUP_TRAFFIC = (TRAFFIC_BIT << 16) | 0xffff;
/** Wheel rays see the world but not traffic, so tyres never climb onto a bus. */
export const GROUP_WHEEL_RAY = (0xffff << 16) | (0xffff & ~TRAFFIC_BIT);

/** Loads the WASM physics engine. Safe to call more than once. */
export async function loadPhysicsEngine(): Promise<void> {
  await RAPIER.init();
}

/** Thin wrapper over a Rapier world that also remembers which surface each collider is. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  private readonly surfaces = new Map<number, SurfaceKind>();
  /** Lets the world mark a part of a collider as another surface, like the drift yard. */
  surfaceOverride: ((x: number, z: number) => SurfaceKind | null) | null = null;
  /** Whether water is standing here. Only ground-level road can flood. */
  floodAt: ((x: number, z: number, y: number) => boolean) | null = null;
  /** How well tyres hold in this weather, as a share of dry. */
  weatherGrip = 1;

  constructor(fixedDt: number) {
    this.world = new RAPIER.World({ x: 0, y: -TUNING.physics.gravity, z: 0 });
    this.world.timestep = fixedDt;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  addFixedTrimesh(vertices: Float32Array, indices: Uint32Array, surface: SurfaceKind): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.3)
      .setRestitution(0.05);
    const collider = this.world.createCollider(desc, body);
    this.surfaces.set(collider.handle, surface);
    return collider;
  }

  addFixedCuboid(
    halfX: number,
    halfY: number,
    halfZ: number,
    x: number,
    y: number,
    z: number,
    surface: SurfaceKind = 'dirt',
    yaw = 0,
  ): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
    const desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ).setFriction(0.25).setRestitution(0.1);
    const collider = this.world.createCollider(desc, body);
    this.surfaces.set(collider.handle, surface);
    return collider;
  }

  surfaceAt(colliderHandle: number, x: number, z: number, y = 0): SurfaceKind {
    const surface = this.surfaces.get(colliderHandle) ?? 'dirt';
    if (surface === 'road' && y < 1.2 && this.floodAt?.(x, z, y)) return 'flood';
    if (surface === 'dirt' && this.surfaceOverride) {
      return this.surfaceOverride(x, z) ?? surface;
    }
    return surface;
  }

  step(): void {
    this.world.step(this.eventQueue);
  }
}
