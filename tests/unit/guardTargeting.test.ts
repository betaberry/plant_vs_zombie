// Guard mode target rules (FR7): default core, aggro, proximity radii, blocked wall, aggro timeout / transfer, LOD.
import { describe, expect, it } from 'vitest';
import {
  aggroAfterPlantDestroyed,
  chooseGuardTarget,
  guardLodDistance,
  type GuardPlant,
  type GuardTargetContext,
} from '../../src/logic/guardTargeting';
import { chooseZombieTarget } from '../../src/logic/targeting';
import { config } from './helpers';

const cfg = config();
const rules = cfg.zombies.basic_zombie!.targeting;
const radii = cfg.challenge.targeting;
const origin = { x: 0, y: 0, z: 0 };
const at = (x: number, z = 0) => ({ x, y: 0, z });

function ctx(over: Partial<GuardTargetContext> = {}): GuardTargetContext {
  return {
    zombiePos: origin,
    players: [{ id: 'p1', pos: at(30), alive: true, secondsSinceSeen: 0 }],
    plants: [],
    aggro: null,
    blockingWallId: null,
    rules,
    radii,
    ...over,
  };
}

const plant = (id: string, kind: GuardPlant['kind'], x: number, alive = true): GuardPlant => ({ id, kind, pos: at(x), alive });

describe('chooseGuardTarget (FR7)', () => {
  it('marches on the core by default (FR7.1)', () => {
    expect(chooseGuardTarget(ctx()).decision).toEqual({ action: 'ATTACK_CORE' });
  });

  it('fights back against the player who shot it, even far away (FR7.2)', () => {
    const r = chooseGuardTarget(ctx({ aggro: { kind: 'player', id: 'p1' } }));
    expect(r.decision).toEqual({ action: 'CHASE_PLAYER', playerId: 'p1', reason: 'aggro' });
    expect(r.aggro).toEqual({ kind: 'player', id: 'p1' });
    const byPlant = chooseGuardTarget(ctx({ aggro: { kind: 'plant', id: 'pea' }, plants: [plant('pea', 'shooter', 15)] }));
    expect(byPlant.decision).toEqual({ action: 'ATTACK_PLANT', plantId: 'pea', reason: 'aggro' });
  });

  it('turns to a player at 12 m but not at 13 m (FR7.3)', () => {
    expect(chooseGuardTarget(ctx({ players: [{ id: 'p1', pos: at(12), alive: true, secondsSinceSeen: 0 }] })).decision)
      .toEqual({ action: 'CHASE_PLAYER', playerId: 'p1', reason: 'proximity' });
    expect(chooseGuardTarget(ctx({ players: [{ id: 'p1', pos: at(13), alive: true, secondsSinceSeen: 0 }] })).decision)
      .toEqual({ action: 'ATTACK_CORE' });
    expect(chooseGuardTarget(ctx({ players: [{ id: 'p1', pos: at(5), alive: false, secondsSinceSeen: 0 }] })).decision)
      .toEqual({ action: 'ATTACK_CORE' });
  });

  it('turns to a plant within 8 m and picks whichever is nearest (FR7.3)', () => {
    expect(chooseGuardTarget(ctx({ plants: [plant('pea', 'shooter', 8)] })).decision).toEqual({ action: 'ATTACK_PLANT', plantId: 'pea', reason: 'proximity' });
    expect(chooseGuardTarget(ctx({ plants: [plant('pea', 'shooter', 8.5)] })).decision).toEqual({ action: 'ATTACK_CORE' });
    const both = ctx({ players: [{ id: 'p1', pos: at(10), alive: true, secondsSinceSeen: 0 }], plants: [plant('sun', 'sunflower', -6)] });
    expect(chooseGuardTarget(both).decision).toEqual({ action: 'ATTACK_PLANT', plantId: 'sun', reason: 'proximity' });
  });

  it('breaks a blocking nut wall only when there is no detour, and walks past walls otherwise (FR7.4)', () => {
    const wall = plant('wall', 'wall', 2);
    expect(chooseGuardTarget(ctx({ plants: [wall], blockingWallId: 'wall' })).decision).toEqual({ action: 'BREAK', plantId: 'wall' });
    expect(chooseGuardTarget(ctx({ plants: [wall], blockingWallId: null })).decision).toEqual({ action: 'ATTACK_CORE' });
    expect(chooseGuardTarget(ctx({ plants: [plant('wall', 'wall', 2, false)], blockingWallId: 'wall' })).decision).toEqual({ action: 'ATTACK_CORE' });
  });

  it('drops player aggro after 8 s unseen or beyond 40 m and goes back to the core', () => {
    const unseen = chooseGuardTarget(ctx({ aggro: { kind: 'player', id: 'p1' }, players: [{ id: 'p1', pos: at(30), alive: true, secondsSinceSeen: 8.1 }] }));
    expect(unseen.decision).toEqual({ action: 'ATTACK_CORE' });
    expect(unseen.aggro).toBeNull();
    const far = chooseGuardTarget(ctx({ aggro: { kind: 'player', id: 'p1' }, players: [{ id: 'p1', pos: at(41), alive: true, secondsSinceSeen: 0 }] }));
    expect(far.decision).toEqual({ action: 'ATTACK_CORE' });
    const gonePlant = chooseGuardTarget(ctx({ aggro: { kind: 'plant', id: 'pea' }, plants: [plant('pea', 'shooter', 3, false)] }));
    expect(gonePlant.decision).toEqual({ action: 'ATTACK_CORE' });
  });

  it('leaves practice mode on the original player-first rules (FR7.6)', () => {
    const practice = chooseZombieTarget({
      zombiePos: origin, hasAggro: true, plants: [], blockingWallId: null, currentPlantId: null, rules,
      player: { pos: at(30), alive: true, perceivedNow: true, secondsSinceSeen: 0, reachable: true },
    });
    expect(practice).toEqual({ action: 'CHASE_PLAYER' });
  });
});

describe('aggro transfer and LOD (FR7.5 / FR7.7)', () => {
  it('transfers aggro to the plant owner when the targeted plant is destroyed', () => {
    expect(aggroAfterPlantDestroyed(null, 'pea', 'pea', 'p1')).toEqual({ kind: 'player', id: 'p1' });
    expect(aggroAfterPlantDestroyed({ kind: 'plant', id: 'pea' }, null, 'pea', null)).toBeNull();
    expect(aggroAfterPlantDestroyed({ kind: 'player', id: 'p1' }, 'other', 'pea', 'p2')).toEqual({ kind: 'player', id: 'p1' });
  });

  it('uses the nearer of player and core for LOD', () => {
    expect(guardLodDistance(at(50), at(-150), origin)).toBe(50);
    expect(guardLodDistance(at(50), at(45), origin)).toBe(5);
  });
});
