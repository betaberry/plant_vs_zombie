// Smooth low-poly zombie part geometry with baked vertex-colour shading and details (plan Step 23).
// Every part is built in its joint's local frame (origin = joint pivot, zombie faces −Z, right = +X).
// Vertex colours are multiplied by the per-instance palette colour, so they only darken / tint.
import * as THREE from 'three';
import type { ZombieProportions, ZombieVisualConfig } from '../config/types';
import { createRng } from '../core/rng';

export const BODY_PART_TYPES = [
  'torso', 'shirt', 'tie', 'pelvis', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'shoe',
  'neck', 'head', 'eyes', 'jaw', 'teeth', 'hair',
] as const;
/**
 * Revision 2 accessories (plan Step 28): one InstancedMesh each, shared by every zombie that wears one
 * and by the dropped props. `coneDented` is the damaged cone swapped in below half armour.
 */
export const ACCESSORY_PART_TYPES = ['cone', 'coneDented', 'bucket', 'helmet', 'shoulderPads', 'pole', 'newspaper', 'screendoor'] as const;
export const PART_TYPES = [...BODY_PART_TYPES, ...ACCESSORY_PART_TYPES] as const;
export type PartType = (typeof PART_TYPES)[number];
export type AccessoryPart = (typeof ACCESSORY_PART_TYPES)[number];

type Shade = (v: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Cheap smooth-ish 3D value pattern in −1..1 for skin blotches, dirt and wear. */
const pattern = (x: number, y: number, z: number, f: number): number =>
  Math.sin(x * f * 1.7 + y * f * 0.9) * Math.sin(y * f * 1.3 - z * f * 1.1) * Math.sin(z * f * 1.9 + x * f * 0.7);

/** Move vertices, then recompute smooth normals. */
function displace(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    fn(tmpV);
    pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Bake a vertex colour attribute (default white) and drop attributes the merge does not need. */
function paint(g: THREE.BufferGeometry, shade?: Shade): THREE.BufferGeometry {
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    tmpN.fromBufferAttribute(nor, i);
    tmpC.setRGB(1, 1, 1);
    shade?.(tmpV, tmpN, tmpC);
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Merge indexed geometries that all carry position / normal / color. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    const g = p.index ? p : p.setIndex([...Array(p.getAttribute('position').count).keys()]);
    vCount += g.getAttribute('position').count;
    iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const n = g.getAttribute('position').count;
    pos.set((g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array, vo * 3);
    nor.set((g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array, vo * 3);
    col.set((g.getAttribute('color') as THREE.BufferAttribute).array as Float32Array, vo * 3);
    const src = g.index!;
    for (let i = 0; i < src.count; i++) idx[io + i] = src.getX(i) + vo;
    vo += n;
    io += src.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const v2 = (pts: [number, number][]): THREE.Vector2[] => pts.map(([x, y]) => new THREE.Vector2(x, y));

/** Tapered tube hanging down from the origin (limb segment). */
function limb(rTop: number, rBottom: number, length: number, radial: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, radial, 2, false);
  g.translate(0, -length / 2, 0);
  return g;
}

function ball(r: number, sx: number, sy: number, sz: number, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  return g;
}

/** Patch with a darker stitched border; returns the colour multiplier for a vertex. */
function patchShade(v: THREE.Vector3, cx: number, cy: number, cz: number, size: number, c: THREE.Color): void {
  const d = Math.max(Math.abs(v.x - cx), Math.abs(v.y - cy), Math.abs(v.z - cz) * 0.5);
  if (d > size * 1.15) return;
  if (d > size) c.multiplyScalar(0.45);
  else c.multiply(tmpPatch);
}
const tmpPatch = new THREE.Color(0.92, 0.82, 0.6);

// ---------------------------------------------------------------- body

function torso(P: ZombieProportions, segs: number): THREE.BufferGeometry {
  const L = P.torsoLength;
  const r = P.torsoRadius;
  const prof: [number, number][] = [
    [0, -0.13], [0.8, -0.13], [0.86, -0.08], [0.9, 0.05], [0.95, 0.35], [1.0, 0.62],
    [1.0, 0.78], [0.9, 0.9], [0.62, 0.97], [0.3, 1.0], [0, 1.0],
  ];
  const g = new THREE.LatheGeometry(v2(prof.map(([pr, py]) => [pr * r, py * L])), segs);
  displace(g, (v) => {
    const h = v.y / L;
    v.z *= P.torsoDepthRatio;
    v.z += 0.07 * Math.max(0, h - 0.3) ** 2; // hunched upper back
    if (v.z < 0 && h < 0.4) v.z -= 0.02 * Math.sin(Math.PI * Math.max(0, (h + 0.13) / 0.53)); // belly
    // Ragged, torn hem.
    if (h < -0.125 && Math.hypot(v.x, v.z) > 0.02) v.y -= 0.04 * hash(Math.round(Math.atan2(v.x, v.z) * 10));
  });
  return paint(g, (v, n, c) => {
    const h = v.y / L;
    c.setScalar(0.7 + 0.3 * smooth(-0.15, 0.6, h));
    c.multiplyScalar(0.86 + 0.14 * Math.abs(n.z));
    // Lapels: darker edges framing the shirt opening.
    const ax = Math.abs(v.x);
    if (v.z < 0 && h > 0.25 && ax > 0.055 && ax < 0.1 - (h - 0.25) * 0.06) c.multiplyScalar(0.62);
    // Pocket line, patches with stitching and moth holes.
    if (v.z < 0 && Math.abs(h - 0.18) < 0.012 && ax > 0.08 && ax < 0.17) c.multiplyScalar(0.55);
    patchShade(v, -0.13, L * 0.4, 0.1, 0.06, c);
    patchShade(v, 0.12, L * 0.05, -0.1, 0.04, c);
    if (pattern(v.x, v.y, v.z, 40) > 0.55) c.multiplyScalar(0.4);
    if (pattern(v.x, v.y, v.z, 9) > 0.35) c.multiplyScalar(0.85);
  });
}

function shirt(P: ZombieProportions, w: number, h: number): THREE.BufferGeometry {
  const L = P.torsoLength;
  const frontZ = -P.torsoRadius * P.torsoDepthRatio * 0.9;
  const panel = ball(1, 1, 1, 1, w, h);
  displace(panel, (v) => {
    const t = (v.y + 1) / 2;
    v.x *= 0.1 * (0.35 + 0.65 * t);
    v.y *= 0.19;
    v.z *= 0.04;
    v.y += L * 0.62;
    v.z += frontZ;
  });
  const collar = (side: number): THREE.BufferGeometry => {
    const g = new THREE.ConeGeometry(0.04, 0.075, 4, 1);
    g.scale(1, 1, 0.35);
    g.rotateZ(Math.PI + side * 0.6);
    g.rotateY(side * 0.35);
    g.translate(side * 0.05, L * 0.93, frontZ + 0.02);
    return g;
  };
  const shade: Shade = (v, _n, c) => {
    c.setScalar(0.82 + 0.18 * smooth(L * 0.4, L * 0.85, v.y));
    if (pattern(v.x, v.y, v.z, 25) > 0.45) c.multiply(new THREE.Color(0.82, 0.74, 0.55)); // grime stains
  };
  return merge([paint(panel, shade), paint(collar(-1), shade), paint(collar(1), shade)]);
}

function tie(): THREE.BufferGeometry {
  const knot = ball(0.024, 1, 0.9, 0.6, 8, 6);
  const blade = new THREE.LatheGeometry(v2([[0, 0], [0.018, -0.02], [0.014, -0.04], [0.034, -0.22], [0, -0.27]]), 4);
  blade.rotateY(Math.PI / 4);
  blade.scale(1, 1, 0.35);
  const shade: Shade = (v, _n, c) => {
    if (Math.sin(v.y * 70 + v.x * 50) > 0.55) c.multiplyScalar(0.72);
    if (v.y < -0.24) c.multiplyScalar(0.8);
  };
  return merge([paint(knot, shade), paint(blade, shade)]);
}

function pelvis(P: ZombieProportions, w: number, h: number): THREE.BufferGeometry {
  const g = ball(1, P.hipHalfWidth + 0.09, 0.13, 0.15, w, h);
  g.translate(0, 0.02, 0);
  return paint(g, (v, n, c) => {
    c.setScalar(0.8 + 0.2 * Math.max(0, n.y));
    if (v.z < 0 && Math.abs(v.x) < 0.006) c.multiplyScalar(0.5); // fly seam
  });
}

function upperArm(P: ZombieProportions, radial: number, w: number, h: number): THREE.BufferGeometry {
  const U = P.upperArmLength;
  const ar = P.armRadius;
  const shade: Shade = (v, _n, c) => {
    c.setScalar(0.85 + 0.15 * Math.sin(v.y * 55));
    if (v.y < -U * 0.72 && v.z > 0.01) c.multiply(tmpPatch); // elbow patch
    if (pattern(v.x, v.y, v.z, 35) > 0.6) c.multiplyScalar(0.45);
  };
  return merge([paint(limb(ar, ar * 0.88, U, radial), shade), paint(ball(ar * 1.12, 1, 1, 1, w, h), shade)]);
}

function forearm(P: ZombieProportions, radial: number, w: number, h: number): THREE.BufferGeometry {
  const F = P.forearmLength;
  const ar = P.armRadius;
  const sleeve = limb(ar * 0.86, ar * 0.84, F * 0.8, radial);
  displace(sleeve, (v) => {
    if (v.y < -F * 0.79) v.y -= 0.03 * hash(Math.round(Math.atan2(v.x, v.z) * 3)); // frayed cuff
  });
  const shade: Shade = (v, _n, c) => {
    c.setScalar(0.88 + 0.12 * Math.sin(v.y * 48));
    if (v.y < -F * 0.7) c.multiplyScalar(0.65);
  };
  return merge([paint(sleeve, shade), paint(ball(ar * 0.9, 1, 1, 1, w, h), shade)]);
}

function hand(P: ZombieProportions): THREE.BufferGeometry {
  const y0 = -P.forearmLength * 0.8;
  const parts: THREE.BufferGeometry[] = [];
  const wrist = limb(0.03, 0.028, 0.06, 6);
  wrist.translate(0, y0 + 0.02, 0);
  parts.push(wrist);
  const palm = ball(1, 0.024, 0.05, 0.045, 8, 6);
  palm.translate(0, y0 - 0.06, 0);
  parts.push(palm);
  [-0.028, -0.009, 0.01, 0.029].forEach((z, i) => {
    const len = [0.055, 0.065, 0.062, 0.05][i]!;
    const f = new THREE.CapsuleGeometry(0.011, len, 1, 5, 1);
    f.translate(0, -len / 2, 0);
    f.rotateX(0.35 + i * 0.05); // claw curl, tips forward
    f.translate(0, y0 - 0.1, z);
    parts.push(f);
  });
  const thumb = new THREE.CapsuleGeometry(0.012, 0.045, 1, 5, 1);
  thumb.translate(0, -0.022, 0);
  thumb.rotateX(0.9);
  thumb.translate(0, y0 - 0.05, -0.04);
  parts.push(thumb);
  const tipY = y0 - 0.15;
  return merge(parts.map((g) => paint(g, (v, _n, c) => {
    if (v.y < tipY) c.multiplyScalar(0.45); // dirty claws
    if (pattern(v.x, v.y, v.z, 60) > 0.5) c.multiplyScalar(0.8);
  })));
}

function thigh(P: ZombieProportions, radial: number, w: number, h: number): THREE.BufferGeometry {
  const T = P.thighLength;
  const lr = P.legRadius;
  const shade: Shade = (v, _n, c) => {
    c.setScalar(0.84 + 0.16 * Math.sin(v.y * 40 + 1));
    if (v.z < -0.02 && v.y < -T * 0.78 && Math.abs(v.x) < 0.05) c.multiply(tmpPatch); // knee patch
    if (Math.abs(Math.abs(v.x) - lr * 0.9) < 0.006) c.multiplyScalar(0.6); // side seams
  };
  return merge([paint(limb(lr, lr * 0.8, T, radial), shade), paint(ball(lr, 1, 1, 1, w, h), shade)]);
}

function shin(P: ZombieProportions, radial: number, w: number, h: number): THREE.BufferGeometry {
  const S = P.shinLength;
  const lr = P.legRadius;
  const tube = limb(lr * 0.78, lr * 0.84, S - 0.01, radial);
  displace(tube, (v) => {
    if (v.y < -S + 0.02) v.y += 0.05 * hash(Math.round(Math.atan2(v.x, v.z) * 2.5)); // torn hem
  });
  const shade: Shade = (v, _n, c) => {
    c.setScalar(0.92 - 0.25 * smooth(-S * 0.6, -S, v.y));
    if (pattern(v.x, v.y, v.z, 30) > 0.5) c.multiplyScalar(0.55);
  };
  return merge([paint(tube, shade), paint(ball(lr * 0.8, 1, 1, 1, w, h), shade)]);
}

function shoe(P: ZombieProportions, w: number, h: number): THREE.BufferGeometry {
  const g = ball(1, 0.055, 0.04, 0.12, w, h);
  displace(g, (v) => {
    v.z -= 0.045;
    v.y -= P.ankleHeight * 0.5;
    if (v.z < -0.1) v.y += (-v.z - 0.1) * 0.5; // upturned toe
  });
  return paint(g, (v, _n, c) => {
    const sole = v.y < -P.ankleHeight * 0.5 - 0.022;
    c.setScalar(sole ? 0.45 : 0.95);
    if (!sole && v.y > -0.02 && Math.sin(v.z * 120) > 0.6 && Math.abs(v.x) < 0.02) c.multiplyScalar(0.5); // laces
    if (pattern(v.x, v.y, v.z, 45) > 0.5) c.multiplyScalar(0.8); // scuffs
  });
}

// ---------------------------------------------------------------- head

interface HeadFrame {
  R: number;
  hc: number;
  eyeL: THREE.Vector3;
  eyeR: THREE.Vector3;
}

function headFrame(P: ZombieProportions): HeadFrame {
  const R = P.headRadius;
  return { R, hc: P.headCenterOffset, eyeL: new THREE.Vector3(-0.056, 0.02, -R * 0.9), eyeR: new THREE.Vector3(0.056, 0.02, -R * 0.9) };
}

function neck(P: ZombieProportions, radial: number): THREE.BufferGeometry {
  const N = P.neckLength;
  const g = limb(0.046, 0.056, N + 0.06, radial);
  g.translate(0, N + 0.03, 0);
  return paint(g, (v, _n, c) => {
    c.setScalar(0.8 + 0.2 * smooth(0, N, v.y));
    if (v.z < 0 && Math.abs(Math.abs(v.x) - 0.022) < 0.006) c.multiplyScalar(0.7); // tendons
  });
}

function head(P: ZombieProportions, w: number, h: number): THREE.BufferGeometry {
  const f = headFrame(P);
  const { R } = f;
  const g = new THREE.SphereGeometry(1, w, h);
  const bell = (d: number, r: number): number => (d >= r ? 0 : (1 - d / r) ** 2);
  const nose = new THREE.Vector3(0, -0.025, -R * 1.02);
  displace(g, (v) => {
    v.set(v.x * R, v.y * R * 1.12, v.z * R * 1.02);
    const dir = tmpN.copy(v).normalize();
    let push = 0;
    push -= 0.024 * bell(v.distanceTo(f.eyeL), 0.05) + 0.024 * bell(v.distanceTo(f.eyeR), 0.05); // sunken sockets
    if (v.z < -R * 0.5 && Math.abs(v.x) < 0.1) push += 0.013 * bell(Math.abs(v.y - 0.06), 0.02); // brow ridge
    push += 0.026 * bell(v.distanceTo(nose), 0.038);
    if (v.y < -0.06 && v.z < -R * 0.4) push -= 0.02; // mouth cavity (shows when the jaw drops)
    push -= 0.01 * bell(Math.hypot(Math.abs(v.x) - 0.075, v.y + 0.045), 0.04) * (v.z < 0 ? 1 : 0); // hollow cheeks
    if (v.y > R) v.y = R + (v.y - R) * 0.75; // flat-ish skull top
    if (v.z > 0 && v.y > 0) v.z *= 1.06; // bulging back of the head
    v.addScaledVector(dir, push);
    v.y += f.hc;
  });
  const ear = (side: number): THREE.BufferGeometry => {
    const e = ball(0.036, 0.4, 1, 0.7, 8, 6);
    e.rotateZ(side * 0.25);
    e.translate(side * R * 0.98, f.hc + 0.005, 0.012);
    return e;
  };
  const sockets = [f.eyeL, f.eyeR].map((e) => e.clone().setY(e.y + f.hc));
  const scarA = new THREE.Vector2(0.03, f.hc + 0.13);
  const shadeHead: Shade = (v, n, c) => {
    const rel = v.y - f.hc;
    c.setScalar(0.92 + 0.08 * Math.max(0, n.y));
    if (n.y < -0.4) c.multiplyScalar(0.82);
    for (const s of sockets) {
      const d = v.distanceTo(s);
      if (d < 0.055) c.multiplyScalar(0.3 + 0.7 * smooth(0.02, 0.055, d));
    }
    if (v.z < -R * 0.5 && Math.abs(rel - 0.06) < 0.012) c.multiplyScalar(0.82);
    if (rel < -0.055 && v.z < -R * 0.35) c.multiply(new THREE.Color(0.32, 0.1, 0.1)); // mouth interior
    if (pattern(v.x, v.y, v.z, 18) > 0.35) c.multiplyScalar(0.8); // skin blotches
    if (pattern(v.x, v.y, v.z, 55) > 0.7) c.multiplyScalar(0.6);
    // Stitched scar across the right temple.
    const along = v.x - scarA.x;
    if (v.x > 0.02 && v.z < 0.05 && Math.abs(v.y - (scarA.y - along * 0.5)) < 0.006) c.multiplyScalar(0.45);
    if (v.x > 0.02 && v.z < 0.05 && Math.abs(v.y - (scarA.y - along * 0.5)) < 0.018 && Math.sin(along * 220) > 0.85) c.multiplyScalar(0.5);
  };
  return merge([paint(g, shadeHead), paint(ear(-1), (_v, _n, c) => c.setScalar(0.75)), paint(ear(1), (_v, _n, c) => c.setScalar(0.75))]);
}

function eyes(P: ZombieProportions, w: number, h: number): THREE.BufferGeometry {
  const f = headFrame(P);
  const one = (center: THREE.Vector3, r: number, look: THREE.Vector3): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(r, w, h);
    const lookN = look.clone().normalize();
    const d = new THREE.Vector3();
    paint(g, (v, _n, c) => {
      d.copy(v).normalize();
      const k = d.dot(lookN);
      if (k > 0.94) c.setScalar(0.06);
      else if (k > 0.89) c.setScalar(0.35);
      else if (d.y > 0.5) c.setRGB(0.6, 0.7, 0.48); // heavy droopy lids
      else if (pattern(v.x * 30, v.y * 30, v.z * 30, 1) > 0.6) c.setRGB(1, 0.62, 0.62); // bloodshot veins
    });
    g.translate(center.x, center.y + f.hc, center.z + 0.012);
    return g;
  };
  return merge([
    one(f.eyeL, 0.036, new THREE.Vector3(-0.2, 0.22, -1)),
    one(f.eyeR, 0.031, new THREE.Vector3(0.12, -0.18, -1)),
  ]);
}

/** Lower jaw in the jaw-joint frame (pivot below the ears, behind the mouth line). */
function jaw(w: number, h: number): THREE.BufferGeometry {
  const g = ball(1, 0.1, 0.045, 0.085, w, h);
  displace(g, (v) => {
    v.y -= 0.035;
    v.z -= 0.06;
    if (v.z < -0.1) v.y -= (-v.z - 0.1) * 0.35; // jutting chin
  });
  return paint(g, (v, n, c) => {
    if (n.y > 0.55) c.setRGB(0.5, 0.22, 0.22); // tongue / mouth floor
    else c.setScalar(0.85 + 0.15 * Math.max(0, -n.z));
    if (n.y < -0.3 && pattern(v.x, v.y, v.z, 90) > 0.4) c.multiplyScalar(0.6); // stubble
  });
}

/** A crooked row of teeth hanging down from y = 0 along an arc (one tooth missing). */
function teeth(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    if (i === 2) continue;
    const a = -0.65 + (1.3 * i) / (count - 1);
    const hgt = 0.018 + 0.008 * hash(i + 3);
    const b = new THREE.BoxGeometry(0.017, hgt, 0.01);
    b.translate(0, -hgt / 2, 0);
    b.rotateZ((hash(i) - 0.5) * 0.25);
    b.rotateY(-a);
    b.translate(Math.sin(a) * radius, 0, -Math.cos(a) * radius);
    parts.push(paint(b, (v, _n, c) => c.setScalar(v.y < -hgt * 0.7 ? 0.8 : 1)));
  }
  return merge(parts);
}

function hair(P: ZombieProportions): THREE.BufferGeometry {
  const f = headFrame(P);
  const rng = createRng(4242);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const tufts: [number, number][] = [[0.15, 0], [0.35, 1.2], [0.4, 2.6], [0.45, 4.1], [0.5, 5.3], [1.1, 1.6], [1.15, -1.6], [0.9, 3.0], [0.75, 0.6]];
  for (const [polar, az] of tufts) {
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
    const len = rng.range(0.05, 0.1);
    const g = new THREE.ConeGeometry(rng.range(0.01, 0.018), len, 5, 1);
    g.translate(0, len / 2, 0);
    g.rotateZ(rng.range(-0.5, 0.5));
    q.setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(dir.x * f.R * 0.95, f.hc + dir.y * f.R * 1.12 * 0.92, dir.z * f.R);
    parts.push(paint(g, (v, _n, c) => c.setScalar(0.7 + 0.3 * smooth(f.hc + f.R, f.hc + f.R * 1.6, v.y))));
  }
  return merge(parts);
}

// ---------------------------------------------------------------- accessories (Revision 2)
// Accessories bake their real colour into the vertex colours (instance colour stays white), so
// reflective bands, rust, print and frames can be brighter or different hues than the base colour.

const col = (hex: string): THREE.Color => new THREE.Color(hex);
const WHITE_BAND = new THREE.Color('#f5f5f0');
const DARK_METAL = new THREE.Color('#4a5055');

/** Head-frame height (above the head joint) where hats sit: just above the brow. */
const hatBase = (P: ZombieProportions): number => P.headCenterOffset + P.headRadius * 0.42;

/** Traffic cone with a reflective white band and a square base flange; `dented` crumples it. */
function cone(P: ZombieProportions, base: THREE.Color, segs: number, dented: boolean): THREE.BufferGeometry {
  const y0 = hatBase(P);
  const H = 0.36;
  const shell = new THREE.LatheGeometry(v2([[P.headRadius * 1.08, 0], [P.headRadius * 0.98, 0.03], [0.02, H], [0, H + 0.005]]), segs);
  displace(shell, (v) => {
    if (dented) {
      const t = v.y / H;
      v.x += 0.05 * t * t; // tip bent sideways
      const a = Math.atan2(v.x, v.z);
      const dent = Math.exp(-(((a - 0.9) / 0.5) ** 2 + ((t - 0.4) / 0.15) ** 2)) + 0.7 * Math.exp(-(((a + 2.2) / 0.4) ** 2 + ((t - 0.65) / 0.12) ** 2));
      v.x *= 1 - 0.28 * dent;
      v.z *= 1 - 0.28 * dent;
    }
    v.y += y0;
  });
  const flange = new THREE.BoxGeometry(0.36, 0.025, 0.36, 2, 1, 2);
  flange.translate(0, y0 - 0.005, 0);
  if (dented) flange.rotateZ(0.06);
  const shade: Shade = (v, n, c) => {
    const t = (v.y - y0) / H;
    c.copy(Math.abs(t - 0.5) < 0.09 || Math.abs(t - 0.28) < 0.04 ? WHITE_BAND : base);
    c.multiplyScalar(0.8 + 0.2 * Math.max(0, n.y + 0.5));
    if (dented && pattern(v.x, v.y, v.z, 30) > 0.4) c.multiplyScalar(0.62); // scuffs
  };
  return merge([paint(shell, shade), paint(flange, (_v, n, c) => c.copy(base).multiplyScalar(0.7 + 0.2 * Math.max(0, n.y)))]);
}

/** Galvanised bucket worn upside down: ribs, rim, rivets at the handle lugs, dents. */
function bucket(P: ZombieProportions, base: THREE.Color, segs: number): THREE.BufferGeometry {
  const y0 = P.headCenterOffset + 0.035;
  const H = 0.27;
  const rb = P.headRadius * 1.16;
  const rt = P.headRadius * 1.0;
  const g = new THREE.LatheGeometry(v2([[rb + 0.012, -0.012], [rb + 0.012, 0.012], [rb, 0.015], [rt, H], [rt * 0.4, H + 0.004], [0, H + 0.004]]), segs * 2);
  const dents: [number, number, number][] = [[0.7, 0.45, 0.022], [2.6, 0.7, 0.018], [-1.9, 0.3, 0.025]];
  displace(g, (v) => {
    const a = Math.atan2(v.x, v.z);
    const t = v.y / H;
    let push = 0;
    for (const [da, dt, depth] of dents) push += depth * Math.exp(-(((a - da) / 0.35) ** 2 + ((t - dt) / 0.16) ** 2));
    const r = Math.hypot(v.x, v.z);
    if (r > 0.01 && t > 0.05 && t < 0.98) {
      v.x *= (r - push) / r;
      v.z *= (r - push) / r;
    }
    v.y += y0;
  });
  const rivets = [-1, 1].map((side) => {
    const r = ball(0.012, 1, 1, 0.6, 6, 4);
    r.translate(side * (rb - 0.005), y0 + H * 0.3, 0);
    return r;
  });
  const shade: Shade = (v, n, c) => {
    const t = (v.y - y0) / H;
    c.copy(base).multiplyScalar(Math.min(1, 0.72 + 0.16 * Math.max(0, n.y + 0.3) + 0.12 * Math.abs(n.x)));
    if (Math.abs(t - 0.3) < 0.025 || Math.abs(t - 0.72) < 0.025) c.multiplyScalar(0.7); // pressed ribs
    if (t < 0.06) c.multiplyScalar(0.85);
    if (pattern(v.x, v.y, v.z, 22) > 0.5) c.lerp(new THREE.Color('#7a5a3a'), 0.35); // rust blotches
  };
  return merge([paint(g, shade), ...rivets.map((r) => paint(r, (_v, _n, c) => c.copy(DARK_METAL)))]);
}

/** Football helmet: shell with an open face, white centre stripe and a grey face mask. */
function helmet(P: ZombieProportions, base: THREE.Color, w: number, h: number): THREE.BufferGeometry {
  const R = P.headRadius * 1.22;
  const hc = P.headCenterOffset + 0.01;
  const top = new THREE.SphereGeometry(R, w, Math.max(4, Math.round(h * 0.5)), 0, Math.PI * 2, 0, Math.PI * 0.36);
  const back = new THREE.SphereGeometry(R, w, Math.max(3, Math.round(h * 0.4)), -Math.PI * 0.2, Math.PI * 1.4, Math.PI * 0.36, Math.PI * 0.3);
  for (const g of [top, back]) {
    g.scale(1, 1.08, 1.04);
    g.translate(0, hc, 0);
  }
  const shade: Shade = (v, n, c) => {
    c.copy(Math.abs(v.x) < 0.022 && v.y > hc ? WHITE_BAND : base);
    c.multiplyScalar(0.75 + 0.25 * Math.min(1, Math.max(0, n.y + 0.4)));
  };
  const bars = [0, 1].map((i) => {
    const t = new THREE.TorusGeometry(R * 0.82, 0.009, 4, 12, Math.PI * 0.75);
    t.rotateX(Math.PI / 2);
    t.rotateY(Math.PI * 0.125 + Math.PI);
    t.translate(0, hc - 0.05 - i * 0.045, -0.02);
    return t;
  });
  const mask = (g: THREE.BufferGeometry): THREE.BufferGeometry => paint(g, (_v, _n, c) => c.copy(col('#9e9e9e')));
  return merge([paint(top, shade), paint(back, shade), ...bars.map(mask)]);
}

/** Shoulder pads in the spine frame: two domes over the shoulders bridged by a chest plate, white trim. */
function shoulderPads(P: ZombieProportions, base: THREE.Color, w: number, h: number): THREE.BufferGeometry {
  const y = P.torsoLength - P.shoulderDrop * 0.3;
  const pads = [-1, 1].map((side) => {
    const g = ball(1, 0.14, 0.07, 0.15, w, h);
    g.rotateZ(-side * 0.35);
    g.translate(side * P.shoulderHalfWidth * 0.85, y, 0.01);
    return g;
  });
  const plate = ball(1, P.torsoRadius * 0.95, 0.09, P.torsoRadius * P.torsoDepthRatio * 1.15, w, h);
  plate.translate(0, y - 0.06, 0);
  const shade: Shade = (_v, n, c) => {
    c.copy(base).multiplyScalar(0.75 + 0.25 * Math.max(0, n.y));
    if (n.y < 0.15 && n.y > -0.3) c.copy(WHITE_BAND).multiplyScalar(0.9); // trim
  };
  return merge([...pads.map((g) => paint(g, shade)), paint(plate, shade)]);
}

/** Vaulting pole in the right forearm frame, running along the forearm axis through the hand. */
function pole(P: ZombieProportions, base: THREE.Color, radial: number): THREE.BufferGeometry {
  const handY = -P.forearmLength * 0.8 - 0.06;
  const L = 2.6;
  const g = new THREE.CylinderGeometry(0.022, 0.02, L, Math.max(5, Math.round(radial * 0.6)), 12);
  g.translate(0, handY - L * 0.31, 0); // ~0.5 m behind the hand, ~2.1 m sticking out in front
  return paint(g, (v, _n, c) => {
    c.copy(base);
    const fromHand = v.y - handY;
    if (Math.abs(fromHand) < 0.07 || Math.abs(fromHand + 0.35) < 0.06) c.multiplyScalar(0.4); // grip tape
    if (Math.sin(v.y * 9) > 0.8) c.multiplyScalar(0.88); // wood grain
  });
}

/** Open newspaper in the spine frame, held in front of the face; headline, columns and a photo in vertex colours. */
function newspaper(P: ZombieProportions, base: THREE.Color): THREE.BufferGeometry {
  const W = 0.56;
  const H = 0.38;
  const g = new THREE.BoxGeometry(W, H, 0.006, 28, 20, 1);
  displace(g, (v) => {
    v.z += Math.abs(v.x) * 0.45 + Math.sin((v.y / H) * Math.PI) * 0.01; // pages folded toward the reader
    v.y += P.torsoLength + 0.12;
    v.z -= 0.5;
  });
  const y0 = P.torsoLength + 0.12;
  const ink = col('#2b2b2b');
  return paint(g, (v, _n, c) => {
    c.copy(base);
    const x = v.x;
    const yy = (v.y - y0) / H + 0.5; // 0 bottom .. 1 top
    const page = x < 0 ? x + W / 2 : x;
    if (Math.abs(x) < 0.006) { c.multiplyScalar(0.7); return; } // centre fold
    if (yy > 0.82 && yy < 0.95) { c.lerp(ink, 0.85); return; } // headline
    if (x < -0.04 && x > -0.2 && yy > 0.4 && yy < 0.75) { c.lerp(ink, 0.55); return; } // photo
    const column = Math.floor(page / 0.065);
    const inGutter = page - column * 0.065 < 0.012;
    if (!inGutter && yy < 0.78 && yy > 0.06 && Math.sin(yy * 150) > 0.15) c.lerp(ink, 0.35); // text lines
  });
}

/** Screen door in the spine frame: metal frame, wire mesh, cross bar and a handle on the front. */
function screendoor(P: ZombieProportions, base: THREE.Color): THREE.BufferGeometry {
  const W = 0.62;
  const H = 1.32;
  const cy = 0.08;
  const z = -0.64;
  const frame = (w: number, h: number, x: number, y: number): THREE.BufferGeometry => {
    const b = new THREE.BoxGeometry(w, h, 0.035);
    b.translate(x, y, z);
    return paint(b, (_v, n, c) => c.copy(base).multiplyScalar(0.8 + 0.2 * Math.abs(n.z)));
  };
  const mesh = new THREE.BoxGeometry(W - 0.06, H - 0.06, 0.008, 24, 52, 1);
  mesh.translate(0, cy, z);
  const meshG = paint(mesh, (v, _n, c) => {
    c.copy(base).multiplyScalar(0.55);
    if (Math.sin(v.x * 140) > 0.55 || Math.sin(v.y * 140) > 0.55) c.multiplyScalar(1.6); // wires
    if (pattern(v.x, v.y, v.z, 12) > 0.45) c.multiplyScalar(0.8); // dents / grime
  });
  const handle = new THREE.BoxGeometry(0.03, 0.12, 0.03);
  handle.translate(W / 2 - 0.08, cy - 0.05, z - 0.04);
  void P;
  return merge([
    frame(W, 0.04, 0, cy + H / 2), frame(W, 0.04, 0, cy - H / 2), frame(0.04, H, -W / 2, cy), frame(0.04, H, W / 2, cy),
    frame(W, 0.03, 0, cy - 0.1), meshG, paint(handle, (_v, _n, c) => c.copy(col('#c9a227'))),
  ]);
}

/** Build every part geometry from the visual config. */
export function buildZombieGeometries(v: ZombieVisualConfig): Record<PartType, THREE.BufferGeometry> {
  const P = v.proportions;
  const s = v.segments;
  const sw = s.sphereWidth;
  const sh = s.sphereHeight;
  const small = Math.max(6, Math.round(sw * 0.5));
  const smallH = Math.max(4, Math.round(sh * 0.5));
  const a = v.accessoryColors;
  return {
    torso: torso(P, s.lathe),
    shirt: shirt(P, small, smallH),
    tie: tie(),
    pelvis: pelvis(P, small, smallH),
    upperArm: upperArm(P, s.radial, small, smallH),
    forearm: forearm(P, s.radial, small, smallH),
    hand: hand(P),
    thigh: thigh(P, s.radial, small, smallH),
    shin: shin(P, s.radial, small, smallH),
    shoe: shoe(P, small, smallH),
    neck: neck(P, s.radial),
    head: head(P, sw, sh),
    eyes: eyes(P, small, smallH),
    jaw: jaw(small, smallH),
    teeth: teeth(0.11),
    hair: hair(P),
    cone: cone(P, col(a.cone), s.lathe, false),
    coneDented: cone(P, col(a.cone), s.lathe, true),
    bucket: bucket(P, col(a.bucket), s.lathe),
    helmet: helmet(P, col(a.helmet), sw, sh),
    shoulderPads: shoulderPads(P, col(a.shoulderPads), small, smallH),
    pole: pole(P, col(a.pole), s.radial),
    newspaper: newspaper(P, col(a.newspaper)),
    screendoor: screendoor(P, col(a.screendoor)),
  };
}
