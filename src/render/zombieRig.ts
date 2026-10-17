// Hierarchical instanced zombie rig (plan Step 23; FR5.1, NFR1).
// One InstancedMesh per part type (PART_TYPES.length draw calls for all zombies together); every
// zombie owns one instance per body slot, positioned each frame from a ZombiePoseAnimator pose.
import * as THREE from 'three';
import type { ZombieAccessory, ZombiePaletteKey, ZombieTypeVisualDef, ZombieVisualConfig } from '../config/types';
import { createRng } from '../core/rng';
import { DEG } from '../logic/math';
import { hipHeight, type Pose, type PoseTraits } from '../logic/zombiePose';
import { InstancePool } from './instancing';
import { toonMaterial } from './renderer';
import { ACCESSORY_PART_TYPES, buildZombieGeometries, PART_TYPES, type AccessoryPart, type PartType } from './zombieGeometry';

/** Joint frame each accessory hangs from. */
const ACCESSORY_FRAME: Record<AccessoryPart, 'head' | 'spine' | 'forearmR'> = {
  cone: 'head', coneDented: 'head', bucket: 'head', helmet: 'head',
  shoulderPads: 'spine', newspaper: 'spine', screendoor: 'spine', pole: 'forearmR',
  telephonePole: 'forearmR', impRider: 'spine',
};
/** Rig parts instantiated for one configured accessory (the cone also gets its dented twin). */
const ACCESSORY_PARTS: Record<ZombieAccessory, AccessoryPart[]> = {
  cone: ['cone', 'coneDented'], bucket: ['bucket'], helmet: ['helmet'], shoulderPads: ['shoulderPads'],
  pole: ['pole'], newspaper: ['newspaper'], screendoor: ['screendoor'], telephonePole: ['telephonePole'], impRider: ['impRider'],
};
export function accessoryParts(a: ZombieAccessory): readonly AccessoryPart[] {
  return ACCESSORY_PARTS[a];
}

type Slot = { part: PartType; color: ZombiePaletteKey };
const SLOTS = {
  torso: { part: 'torso', color: 'jacket' },
  shirt: { part: 'shirt', color: 'shirt' },
  tie: { part: 'tie', color: 'tie' },
  pelvis: { part: 'pelvis', color: 'trousers' },
  upperArmL: { part: 'upperArm', color: 'jacket' },
  upperArmR: { part: 'upperArm', color: 'jacket' },
  forearmL: { part: 'forearm', color: 'jacket' },
  forearmR: { part: 'forearm', color: 'jacket' },
  handL: { part: 'hand', color: 'skin' },
  handR: { part: 'hand', color: 'skin' },
  thighL: { part: 'thigh', color: 'trousers' },
  thighR: { part: 'thigh', color: 'trousers' },
  shinL: { part: 'shin', color: 'trousers' },
  shinR: { part: 'shin', color: 'trousers' },
  shoeL: { part: 'shoe', color: 'shoe' },
  shoeR: { part: 'shoe', color: 'shoe' },
  neck: { part: 'neck', color: 'skin' },
  head: { part: 'head', color: 'skin' },
  eyes: { part: 'eyes', color: 'eyes' },
  jaw: { part: 'jaw', color: 'skin' },
  teethU: { part: 'teeth', color: 'teeth' },
  teethL: { part: 'teeth', color: 'teeth' },
  hair: { part: 'hair', color: 'hair' },
} as const satisfies Record<string, Slot>;
export type SlotName = keyof typeof SLOTS;
const SLOT_NAMES = Object.keys(SLOTS) as SlotName[];

/** Small parts hidden inside the silhouette skip the shadow pass (saves shadow draw calls). */
const NO_SHADOW = new Set<PartType>(['shirt', 'tie', 'eyes', 'teeth', 'hair']);
const PALETTE_KEYS: ZombiePaletteKey[] = ['jacket', 'shirt', 'tie', 'trousers', 'skin', 'hair', 'shoe', 'teeth', 'eyes'];

export interface ZombieLook {
  height: number;
  build: number;
  buildDepth: number;
  colors: Record<ZombiePaletteKey, string>;
  /** −1 left forearm missing, +1 right, 0 both arms. */
  missingArm: -1 | 0 | 1;
  traits: PoseTraits;
  /** Revision 2: accessories this zombie type wears / carries. */
  accessories: ZombieAccessory[];
}

/**
 * Seeded per-zombie variation: height ±5 %, build, palette, missing arm, head tilt, limp. The type look
 * (Revision 2) swaps palettes (football jersey…), adds accessories and can forbid the torn-off arm;
 * the number of PRNG draws is the same for every type, so seeds stay comparable.
 */
export function rollZombieLook(seed: number, v: ZombieVisualConfig, type?: ZombieTypeVisualDef): ZombieLook {
  const rng = createRng(seed);
  const vv = v.variation;
  // Guard mode types scale the whole rig (gargantuar ×2, imp ×0.6); same PRNG draw count for every type.
  const height = rng.range(vv.heightScale[0], vv.heightScale[1]) * (type?.bodyScale ?? 1);
  const build = rng.range(vv.buildScale[0], vv.buildScale[1]);
  const buildDepth = build * rng.range(0.95, 1.12);
  const colors = {} as Record<ZombiePaletteKey, string>;
  for (const k of PALETTE_KEYS) colors[k] = rng.pick(type?.palette?.[k] ?? v.palettes[k]);
  const side = (): -1 | 1 => (rng.next() < 0.5 ? -1 : 1);
  const rolledArm = rng.next() < vv.missingArmChance ? side() : 0;
  const missingArm = type && !type.allowMissingArm ? 0 : rolledArm;
  const headTilt = (rng.next() < vv.headTiltChance ? rng.range(-vv.headTiltMaxDeg, vv.headTiltMaxDeg) : rng.range(-2, 2)) * DEG;
  const limpSide = rng.next() < vv.limpChance ? side() : 0;
  const gaitOffset = rng.range(0, Math.PI * 2);
  return {
    height, build, buildDepth, colors, missingArm, accessories: [...(type?.accessories ?? [])],
    traits: { seed: (seed ^ 0x9e3779b9) >>> 0, limpSide, headTilt, gaitOffset },
  };
}

export interface RigInstance {
  readonly ids: Record<SlotName, number>;
  readonly local: Record<SlotName, THREE.Matrix4>;
  readonly look: ZombieLook;
  /** Accessory instance ids (only the parts this zombie owns). */
  readonly acc: Partial<Record<AccessoryPart, number>>;
  /** Accessory parts currently shown (armour intact, pole still carried, cone dent state…). */
  readonly accShown: Set<AccessoryPart>;
  /** Last written world matrix of every owned accessory (dropped props start from here). */
  readonly accWorld: Partial<Record<AccessoryPart, THREE.Matrix4>>;
  /** Hair is hidden under a bucket / helmet / cone. */
  hairShown: boolean;
  hidden: boolean;
  tintKey: string;
}

const ONE = new THREE.Vector3(1, 1, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class ZombieRig {
  private readonly pools: Record<PartType, InstancePool>;
  private readonly e = new THREE.Euler();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly loc = new THREE.Matrix4();
  private readonly out = new THREE.Matrix4();
  private readonly sc = new THREE.Matrix4();
  private readonly m = {
    rootA: new THREE.Matrix4(), root: new THREE.Matrix4(), scale: new THREE.Matrix4(), pelvis: new THREE.Matrix4(),
    spine: new THREE.Matrix4(), tie: new THREE.Matrix4(), neck: new THREE.Matrix4(), head: new THREE.Matrix4(), jaw: new THREE.Matrix4(),
    sh: new THREE.Matrix4(), el: new THREE.Matrix4(), hip: new THREE.Matrix4(), knee: new THREE.Matrix4(), ankle: new THREE.Matrix4(),
  };

  constructor(scene: THREE.Scene, private readonly cfg: ZombieVisualConfig, capacity: number) {
    const geos = buildZombieGeometries(cfg);
    const perZombie = new Map<PartType, number>();
    for (const s of SLOT_NAMES) perZombie.set(SLOTS[s].part, (perZombie.get(SLOTS[s].part) ?? 0) + 1);
    const material = toonMaterial('#ffffff', { vertexColors: true });
    this.pools = {} as Record<PartType, InstancePool>;
    const accessorySet = new Set<PartType>(ACCESSORY_PART_TYPES);
    for (const part of PART_TYPES) {
      // Accessory pools also hold the tumbling dropped props.
      const count = accessorySet.has(part) ? capacity + cfg.droppedProps.maxActive : capacity * (perZombie.get(part) ?? 1);
      const pool = new InstancePool(geos[part], material, count, !NO_SHADOW.has(part));
      this.pools[part] = pool;
      scene.add(pool.mesh);
    }
  }

  /** Zombie draw calls in the main pass: one per part type (body + accessories), independent of the zombie count. */
  get drawCalls(): number {
    return PART_TYPES.length;
  }

  /** Accessory pool access for the dropped-prop renderer (same InstancedMesh → no extra draw call). */
  pool(part: AccessoryPart): InstancePool {
    return this.pools[part];
  }

  acquire(look: ZombieLook): RigInstance | null {
    const ids = {} as Record<SlotName, number>;
    const acc: Partial<Record<AccessoryPart, number>> = {};
    const fail = (): null => {
      for (const r of SLOT_NAMES) if (ids[r] !== undefined && ids[r] >= 0) this.pools[SLOTS[r].part].release(ids[r]);
      for (const [part, id] of Object.entries(acc) as [AccessoryPart, number][]) this.pools[part].release(id);
      return null;
    };
    for (const s of SLOT_NAMES) {
      ids[s] = this.pools[SLOTS[s].part].acquire(look.colors[SLOTS[s].color]);
      if (ids[s] < 0) return fail();
    }
    const accShown = new Set<AccessoryPart>();
    const accWorld: Partial<Record<AccessoryPart, THREE.Matrix4>> = {};
    for (const a of look.accessories) {
      for (const part of ACCESSORY_PARTS[a]) {
        const id = this.pools[part].acquire('#ffffff');
        if (id < 0) return fail();
        acc[part] = id;
        accWorld[part] = new THREE.Matrix4();
        if (part !== 'coneDented') accShown.add(part);
      }
    }
    return { ids, local: this.slotMatrices(look), look, acc, accShown, accWorld, hairShown: true, hidden: true, tintKey: '' };
  }

  release(inst: RigInstance): void {
    for (const s of SLOT_NAMES) this.pools[SLOTS[s].part].release(inst.ids[s]);
    for (const [part, id] of Object.entries(inst.acc) as [AccessoryPart, number][]) this.pools[part].release(id);
  }

  hide(inst: RigInstance): void {
    if (inst.hidden) return;
    for (const s of SLOT_NAMES) this.pools[SLOTS[s].part].setMatrix(inst.ids[s], HIDDEN);
    for (const [part, id] of Object.entries(inst.acc) as [AccessoryPart, number][]) this.pools[part].setMatrix(id, HIDDEN);
    inst.hidden = true;
  }

  /** Show / hide one owned accessory part (armour broken → plain zombie look, pole dropped, cone dented). */
  setAccessoryShown(inst: RigInstance, part: AccessoryPart, shown: boolean): void {
    if (inst.acc[part] === undefined) return;
    if (shown) inst.accShown.add(part);
    else inst.accShown.delete(part);
  }

  /** Tint every slot toward `color` by t (hit flash / frost / rooted); skipped when nothing changed. */
  tint(inst: RigInstance, color: THREE.Color | null, t: number): void {
    const key = color ? `${color.getHexString()}:${t.toFixed(2)}` : '';
    if (key === inst.tintKey) return;
    inst.tintKey = key;
    for (const s of SLOT_NAMES) {
      if (SLOTS[s].part === 'eyes' || SLOTS[s].part === 'teeth') continue;
      this.pools[SLOTS[s].part].tint(inst.ids[s], color, t);
    }
    for (const [part, id] of Object.entries(inst.acc) as [AccessoryPart, number][]) this.pools[part].tint(id, color, t);
  }

  /** Per-slot fixed transforms derived from the look (build widths, stump, lower teeth flip). */
  private slotMatrices(look: ZombieLook): Record<SlotName, THREE.Matrix4> {
    const b = look.build;
    const bd = look.buildDepth;
    const local = {} as Record<SlotName, THREE.Matrix4>;
    for (const s of SLOT_NAMES) local[s] = new THREE.Matrix4();
    local.torso.makeScale(b, 1, bd);
    local.shirt.makeScale(b, 1, bd);
    local.pelvis.makeScale(b, 1, bd);
    for (const s of ['upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'thighL', 'thighR', 'shinL', 'shinR'] as const) local[s].makeScale(b, 1, b);
    local.teethU.makeTranslation(0, 0.058, -0.04);
    local.teethL.compose(new THREE.Vector3(0, 0, -0.01), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), ONE);
    if (look.missingArm !== 0) {
      const side = look.missingArm < 0 ? 'L' : 'R';
      local[`upperArm${side}`].makeScale(b, 0.6, b); // torn-off stump
      local[`forearm${side}`].copy(HIDDEN);
      local[`hand${side}`].copy(HIDDEN);
    }
    return local;
  }

  /** out = parent · T(x,y,z) · R(yaw, rx, rz) with Euler order YXZ. */
  private joint(parent: THREE.Matrix4, x: number, y: number, z: number, ry: number, rx: number, rz: number, out: THREE.Matrix4): THREE.Matrix4 {
    this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ'));
    this.loc.compose(this.v.set(x, y, z), this.q, ONE);
    return out.multiplyMatrices(parent, this.loc);
  }

  private put(inst: RigInstance, slot: SlotName, jointM: THREE.Matrix4): void {
    this.pools[SLOTS[slot].part].setMatrix(inst.ids[slot], this.out.multiplyMatrices(jointM, inst.local[slot]));
  }

  /** Write all instance matrices for one zombie standing at (x, y, z) facing `yaw` in pose `p`. */
  write(inst: RigInstance, x: number, y: number, z: number, yaw: number, p: Pose): void {
    const P = this.cfg.proportions;
    const { build: b, buildDepth: bd, height: h } = inst.look;
    const m = this.m;
    this.joint(m.rootA.identity(), x, y + p.liftY, z, yaw + p.rootYaw, 0, 0, m.rootA);
    this.joint(m.rootA, 0, 0, -p.rootFwd * h, 0, -p.rootPitch, -p.rootRoll, m.root);
    m.root.multiply(m.scale.makeScale(h, h, h));
    this.joint(m.root, 0, hipHeight(P) + p.rootY, 0, p.pelvisYaw, -p.pelvisPitch, -p.pelvisRoll, m.pelvis);
    this.put(inst, 'pelvis', m.pelvis);
    this.legs(inst, p, b);
    this.joint(m.pelvis, 0, P.spineOffset, 0, p.spineYaw, -p.spinePitch, -p.spineRoll, m.spine);
    this.put(inst, 'torso', m.spine);
    this.put(inst, 'shirt', m.spine);
    const tieZ = -(P.torsoRadius * P.torsoDepthRatio * 0.9 + 0.045) * bd;
    this.put(inst, 'tie', this.joint(m.spine, 0, P.torsoLength * 0.86, tieZ, 0, p.tieSwing, 0, m.tie));
    this.joint(m.spine, 0, P.torsoLength, 0.015, 0, -p.neckPitch, 0, m.neck);
    this.put(inst, 'neck', m.neck);
    this.joint(m.neck, 0, P.neckLength, 0, p.headYaw, -p.headPitch, -p.headRoll, m.head);
    for (const s of ['head', 'eyes', 'teethU'] as const) this.put(inst, s, m.head);
    if (inst.hairShown) this.put(inst, 'hair', m.head);
    else this.pools.hair.setMatrix(inst.ids.hair, HIDDEN);
    this.joint(m.head, 0, 0.035, -0.02, 0, -p.jawOpen, 0, m.jaw);
    this.put(inst, 'jaw', m.jaw);
    this.put(inst, 'teethL', m.jaw);
    this.arms(inst, p, b);
    this.accessories(inst);
    inst.hidden = false;
  }

  /** Accessories follow their joint frame (head / spine / right forearm); hidden ones collapse to scale 0. */
  private accessories(inst: RigInstance): void {
    const m = this.m;
    for (const [part, id] of Object.entries(inst.acc) as [AccessoryPart, number][]) {
      const frame = ACCESSORY_FRAME[part];
      // arms() runs the right side last, so m.el holds the right elbow frame here.
      const jointM = frame === 'head' ? m.head : frame === 'spine' ? m.spine : m.el;
      const world = inst.accWorld[part]!;
      if (frame === 'spine') world.multiplyMatrices(jointM, this.sc.makeScale(inst.look.build, 1, 1));
      else world.copy(jointM);
      this.pools[part].setMatrix(id, inst.accShown.has(part) ? world : HIDDEN);
    }
  }

  private arms(inst: RigInstance, p: Pose, b: number): void {
    const P = this.cfg.proportions;
    const m = this.m;
    for (const side of [-1, 1] as const) {
      const L = side < 0;
      const shY = P.torsoLength - P.shoulderDrop;
      const roll = L ? -p.shoulderLRoll : p.shoulderRRoll;
      this.joint(m.spine, side * P.shoulderHalfWidth * b, shY, 0.01, 0, L ? p.shoulderLPitch : p.shoulderRPitch, roll, m.sh);
      this.put(inst, L ? 'upperArmL' : 'upperArmR', m.sh);
      this.joint(m.sh, 0, -P.upperArmLength, 0, 0, L ? p.elbowL : p.elbowR, 0, m.el);
      this.put(inst, L ? 'forearmL' : 'forearmR', m.el);
      this.put(inst, L ? 'handL' : 'handR', m.el);
    }
  }

  private legs(inst: RigInstance, p: Pose, b: number): void {
    const P = this.cfg.proportions;
    const m = this.m;
    for (const side of [-1, 1] as const) {
      const L = side < 0;
      const roll = L ? -p.hipLRoll : p.hipRRoll;
      this.joint(m.pelvis, side * P.hipHalfWidth * b, 0, 0, 0, L ? p.hipLPitch : p.hipRPitch, roll, m.hip);
      this.put(inst, L ? 'thighL' : 'thighR', m.hip);
      this.joint(m.hip, 0, -P.thighLength, 0, 0, -(L ? p.kneeL : p.kneeR), 0, m.knee);
      this.put(inst, L ? 'shinL' : 'shinR', m.knee);
      this.joint(m.knee, 0, -P.shinLength, 0, 0, -(L ? p.ankleL : p.ankleR), 0, m.ankle);
      this.put(inst, L ? 'shoeL' : 'shoeR', m.ankle);
    }
  }
}
