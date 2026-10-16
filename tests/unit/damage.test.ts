import { describe, expect, it } from 'vitest';
import { computeGunDamage, explosionDamage, hitsToKill, incomingDamage } from '../../src/logic/damage';
import { classifyHitZone } from '../../src/logic/hitzone';
import { config } from './helpers';

const cfg = config();
const gun = cfg.weapons.pea_gun;
const zombie = cfg.zombies.basic_zombie;
const base = { gun, distance: 10, potionMultiplier: 1, permanentBonus: 0 };

describe('damage & hit zones (7.3, 7.6.1)', () => {
  it('a headshot deals 68 (TC-WPN-02)', () => {
    const zone = classifyHitZone(1.65, 0, zombie);
    expect(zone).toBe('head');
    expect(computeGunDamage({ ...base, zone })).toBe(68);
  });

  it('three torso shots kill a 100 HP zombie (KPI-01)', () => {
    const torso = computeGunDamage({ ...base, zone: classifyHitZone(1.2, 0.05, zombie) });
    expect(torso).toBe(34);
    expect(hitsToKill(zombie.health, torso)).toBe(3);
  });

  it('power potion gives 51 per torso shot and +20% upgrade stacks multiplicatively', () => {
    expect(computeGunDamage({ ...base, zone: 'torso', potionMultiplier: 1.5 })).toBeCloseTo(51, 6);
    expect(computeGunDamage({ ...base, zone: 'torso', permanentBonus: 0.2 })).toBeCloseTo(40.8, 6);
  });

  it('beyond the 80 m range damage is halved; limbs take ×0.75', () => {
    expect(computeGunDamage({ ...base, zone: 'torso', distance: 81 })).toBe(17);
    expect(computeGunDamage({ ...base, zone: 'torso', distance: 80 })).toBe(34);
    expect(classifyHitZone(0.5, 0, zombie)).toBe('limb');
    expect(classifyHitZone(1.2, 0.4, zombie)).toBe('limb');
    expect(computeGunDamage({ ...base, zone: 'limb' })).toBe(25.5);
  });

  it('explosions fall off linearly and invulnerability blocks incoming damage', () => {
    const bomb = cfg.plants.plants.bomb_flower;
    expect(explosionDamage(bomb.explosionDamageCenter!, bomb.explosionDamageEdge!, bomb.explosionRadius!, 0)).toBe(200);
    expect(explosionDamage(200, 60, 5, 5)).toBe(60);
    expect(explosionDamage(200, 60, 5, 2.5)).toBe(130);
    expect(explosionDamage(200, 60, 5, 5.01)).toBe(0);
    expect(incomingDamage(10, 1, true)).toBe(0);
    expect(incomingDamage(10, 1, false)).toBe(10);
  });
});
