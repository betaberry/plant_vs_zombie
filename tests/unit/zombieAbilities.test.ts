import { describe, expect, it } from 'vitest';
import {
  abilityMoveSpeed, canBeRooted, createAbilityState, findVaultTarget, isCharging, isRaging, onArmorBroken, startVault, stepRage, stepVault,
  type VaultCandidate,
} from '../../src/logic/zombieAbilities';
import { config } from './helpers';

const cfg = config();
const pole = cfg.zombies.pole_vaulter_zombie!;
const paper = cfg.zombies.newspaper_zombie!;
const football = cfg.zombies.football_zombie!;
const at = (x: number, z: number) => ({ x, y: 0, z });
// yaw 0 faces -Z.
const wall = (z: number, id = 'nut_1'): VaultCandidate => ({ id, pos: at(0, z), alive: true });

describe('pole vault (Revision 2)', () => {
  it('vaults over a nut wall within 2 m ahead exactly once, then chases at 1.4', () => {
    const s = createAbilityState(pole.abilities);
    expect(abilityMoveSpeed(pole, s, 'chase')).toBe(3.0);
    const target = findVaultTarget(s, pole.abilities, at(0, 0), 0, [wall(-1.8)]);
    expect(target?.id).toBe('nut_1');
    expect(startVault(s, pole.abilities, at(0, 0), target!)).toBe(true);
    // Lands landingDistance beyond the wall along the approach line.
    expect(s.vault!.to!.z).toBeCloseTo(-1.8 - pole.abilities!.poleVault!.landingDistance, 6);
    const mid = stepVault(s, pole.abilities, 0.5)!;
    expect(mid.progress).toBeCloseTo(0.5, 6);
    expect(mid.landed).toBe(false);
    const end = stepVault(s, pole.abilities, 0.6)!;
    expect(end.landed).toBe(true);
    expect(end.pos.z).toBeCloseTo(s.vault!.to!.z, 6);
    // Pole dropped: slower chase, and no second vault.
    expect(abilityMoveSpeed(pole, s, 'chase')).toBe(1.4);
    expect(findVaultTarget(s, pole.abilities, at(0, -3.3), 0, [wall(-5, 'nut_2')])).toBeNull();
    expect(startVault(s, pole.abilities, at(0, -3.3), wall(-5, 'nut_2'))).toBe(false);
    expect(stepVault(s, pole.abilities, 0.1)).toBeNull();
  });

  it('ignores plants beyond 2 m, behind it, or already destroyed', () => {
    const s = createAbilityState(pole.abilities);
    expect(findVaultTarget(s, pole.abilities, at(0, 0), 0, [wall(-2.5)])).toBeNull();
    expect(findVaultTarget(s, pole.abilities, at(0, 0), 0, [wall(1.5)])).toBeNull();
    expect(findVaultTarget(s, pole.abilities, at(0, 0), 0, [{ ...wall(-1), alive: false }])).toBeNull();
    // Picks the nearest of two candidates ahead.
    expect(findVaultTarget(s, pole.abilities, at(0, 0), 0, [wall(-1.9, 'far'), wall(-1.2, 'near')])?.id).toBe('near');
    // Types without the ability never vault.
    const basic = cfg.zombies.basic_zombie!;
    expect(findVaultTarget(createAbilityState(basic.abilities), basic.abilities, at(0, 0), 0, [wall(-1)])).toBeNull();
  });

  it('cannot be rooted by a vine while in mid-vault', () => {
    const s = createAbilityState(pole.abilities);
    expect(canBeRooted(s)).toBe(true);
    startVault(s, pole.abilities, at(0, 0), wall(-1.5));
    stepVault(s, pole.abilities, 0.3);
    expect(canBeRooted(s)).toBe(false);
    stepVault(s, pole.abilities, 1);
    expect(canBeRooted(s)).toBe(true);
  });
});

describe('newspaper rage (Revision 2)', () => {
  it('runs at 3.2 only 0.6 s after the newspaper is destroyed', () => {
    const s = createAbilityState(paper.abilities);
    expect(abilityMoveSpeed(paper, s, 'chase')).toBe(1.0);
    expect(onArmorBroken(s)).toBe(true);
    expect(isRaging(s)).toBe(true);
    // Stomping / roaring in place during the rage.
    expect(abilityMoveSpeed(paper, s, 'chase')).toBe(0);
    expect(stepRage(s, paper.abilities, 0.5)).toBe(false);
    expect(abilityMoveSpeed(paper, s, 'chase')).toBe(0);
    expect(stepRage(s, paper.abilities, 0.1)).toBe(true);
    expect(abilityMoveSpeed(paper, s, 'chase')).toBe(3.2);
    expect(abilityMoveSpeed(paper, s, 'wander')).toBe(paper.abilities!.newspaperRage!.wanderSpeedAfter);
  });

  it('rages only once and never for types without the ability', () => {
    const s = createAbilityState(paper.abilities);
    onArmorBroken(s);
    stepRage(s, paper.abilities, 1);
    expect(onArmorBroken(s)).toBe(false);
    expect(abilityMoveSpeed(paper, s, 'chase')).toBe(3.2);
    const bucket = cfg.zombies.buckethead_zombie!;
    const b = createAbilityState(bucket.abilities);
    expect(onArmorBroken(b)).toBe(false);
    expect(abilityMoveSpeed(bucket, b, 'chase')).toBe(1.2);
  });
});

describe('football charge (Revision 2)', () => {
  it('charges at chase speed while far and slows for the tackle when close', () => {
    const s = createAbilityState(football.abilities);
    expect(abilityMoveSpeed(football, s, 'chase', 10)).toBe(2.6);
    expect(isCharging(football, 'chase', 10)).toBe(true);
    expect(abilityMoveSpeed(football, s, 'chase', 2)).toBe(football.abilities!.charge!.approachSpeed);
    expect(isCharging(football, 'chase', 2)).toBe(false);
    expect(isCharging(football, 'wander', 10)).toBe(false);
  });
});
