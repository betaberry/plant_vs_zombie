// Typed event bus used to decouple logic from UI / audio / render.
import type { HitZone } from '../logic/hitzone';

export type Vec3Like = { x: number; y: number; z: number };

export interface GameEvents {
  sunChanged: { sun: number; delta: number; capped: boolean };
  floatText: { text: string; kind: 'gain' | 'spend' | 'info' | 'warn' };
  banner: { text: string; kind?: 'info' | 'warn' | 'danger' };
  hitMarker: { kill: boolean };
  /** armor: the bullet landed on armour (metal → clank instead of the flesh sound). */
  zombieHit: { pos: Vec3Like; zone: HitZone; damage: number; ice: boolean; armor?: 'metal' | 'soft' | null };
  /** typeId / sunDrop: Revision 2 per-type kill reward (plant kills included). */
  zombieKilled: { pos: Vec3Like; headshot: boolean; byPlant: boolean; typeId: string; sunDrop: number };
  /** Revision 2 (Step 28): a hit landed on armour; metal armour clanks. */
  armorHit: { pos: Vec3Like; kind: string; metal: boolean; source: string };
  /** Revision 2 (Step 28): a newspaper zombie lost its paper and roars. */
  zombieRage: { pos: Vec3Like };
  /** Revision 2 (Step 28): a dropped armour prop hit the ground for the first time. */
  propLanded: { pos: Vec3Like; metal: boolean };
  /** Revision 2: a zombie's armour (cone, bucket, newspaper, screen door, helmet) was destroyed. */
  armorBroken: { pos: Vec3Like; zombieId: string; typeId: string; kind: string; dropProp: string | null; metal: boolean };
  playerHurt: { amount: number; from: Vec3Like | null };
  playerDied: Record<string, never>;
  playerRespawned: Record<string, never>;
  weaponFired: { pos: Vec3Like; ice: boolean };
  worldHit: { pos: Vec3Like; material: string };
  plantHurt: { type: string; pos: Vec3Like };
  frost: { pos: Vec3Like };
  vineRoot: { pos: Vec3Like };
  dryFire: { reserveEmpty: boolean };
  reloadStart: Record<string, never>;
  reloadDone: Record<string, never>;
  ammoDepleted: Record<string, never>;
  potionDrunk: { id: string; replaced: boolean };
  plantPlaced: { type: string; pos: Vec3Like };
  plantDestroyed: { type: string; pos: Vec3Like };
  plantShoveled: { type: string; pos: Vec3Like };
  plantFired: { pos: Vec3Like; ice: boolean };
  explosion: { pos: Vec3Like; radius: number };
  purchase: { itemId: string; ok: boolean; reason?: string };
  plantRejected: { reason: string };
  zombieGroan: { pos: Vec3Like };
  zombieAttack: { pos: Vec3Like };
  footstep: { pos: Vec3Like; running: boolean };
  pickup: { item: string };
  saved: { ok: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(name: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[events] handler for "${String(name)}" failed:`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
