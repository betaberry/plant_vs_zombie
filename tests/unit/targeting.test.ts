import { describe, expect, it } from 'vitest';
import { chooseZombieTarget, type TargetContext, type TargetPlant } from '../../src/logic/targeting';
import { config } from './helpers';

const rules = config().zombies.basic_zombie.targeting;
const at = (x: number, z: number) => ({ x, y: 0, z });

function plant(id: string, kind: TargetPlant['kind'], x: number, z: number, attacking = false): TargetPlant {
  return { id, kind, pos: at(x, z), alive: true, attackingThisZombie: attacking };
}

function ctx(over: Partial<TargetContext> & { plants?: TargetPlant[] } = {}): TargetContext {
  return {
    zombiePos: at(0, 0),
    hasAggro: true,
    player: { pos: at(15, 0), alive: true, perceivedNow: true, secondsSinceSeen: 0, reachable: true },
    plants: [],
    blockingWallId: null,
    currentPlantId: null,
    rules,
    ...over,
  };
}

describe('chooseZombieTarget (8.3)', () => {
  it('ignores distant plants and heads for the player (TC-AGG-01)', () => {
    const c = ctx({ plants: [plant('ps', 'shooter', -12, 0), plant('sf', 'sunflower', 0, 12)] });
    expect(chooseZombieTarget(c)).toEqual({ action: 'CHASE_PLAYER' });
  });

  it('breaks a nut wall that blocks the path (TC-AGG-02)', () => {
    const c = ctx({ plants: [plant('w1', 'wall', 1, 0)], blockingWallId: 'w1' });
    expect(chooseZombieTarget(c)).toEqual({ action: 'BREAK', plantId: 'w1' });
  });

  it('attacks a pea shooter within 20 m when the player is unreachable (TC-AGG-03)', () => {
    const player = { pos: at(25, 0), alive: true, perceivedNow: true, secondsSinceSeen: 0, reachable: false };
    const c = ctx({ player, plants: [plant('ps', 'shooter', 0, 18)] });
    expect(chooseZombieTarget(c)).toMatchObject({ action: 'ATTACK_PLANT', plantId: 'ps', reason: 'shooter_player_unreachable' });
  });

  it('attacks a shooter within 8 m only while it is attacking this zombie (FR-AGG-04)', () => {
    expect(chooseZombieTarget(ctx({ plants: [plant('ps', 'shooter', 6, 0, false)] }))).toEqual({ action: 'CHASE_PLAYER' });
    expect(chooseZombieTarget(ctx({ plants: [plant('ps', 'shooter', 6, 0, true)] }))).toMatchObject({ action: 'ATTACK_PLANT', plantId: 'ps' });
  });

  it('smashes a sunflower plant within 3 m even while the player is perceived 30 m away (TC-AGG-04/05)', () => {
    const player = { pos: at(30, 0), alive: true, perceivedNow: true, secondsSinceSeen: 0, reachable: true };
    const c = ctx({ player, plants: [plant('sf', 'sunflower', 2, 1)] });
    expect(chooseZombieTarget(c)).toMatchObject({ action: 'ATTACK_PLANT', plantId: 'sf', reason: 'sunflower_nearby' });
    const far = ctx({ player, plants: [plant('sf', 'sunflower', 3.5, 0)] });
    expect(chooseZombieTarget(far)).toEqual({ action: 'CHASE_PLAYER' });
  });

  it('gives up the plant after losing the player for 8 s or beyond 40 m (TC-AGG-06)', () => {
    const plants = [plant('sf', 'sunflower', 1, 0)];
    const hidden = { pos: at(20, 0), alive: true, perceivedNow: false, secondsSinceSeen: 8.1, reachable: true };
    expect(chooseZombieTarget(ctx({ plants, currentPlantId: 'sf', player: hidden }))).toEqual({ action: 'WANDER', reason: 'player_lost' });
    const far = { pos: at(41, 0), alive: true, perceivedNow: true, secondsSinceSeen: 0, reachable: true };
    expect(chooseZombieTarget(ctx({ plants, currentPlantId: 'sf', player: far }))).toEqual({ action: 'WANDER', reason: 'player_lost' });
    expect(chooseZombieTarget(ctx({ hasAggro: false, plants }))).toEqual({ action: 'WANDER', reason: 'no_aggro' });
  });
});
