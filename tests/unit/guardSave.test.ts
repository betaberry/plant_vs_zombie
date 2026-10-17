// Guard mode save (FR11): own key, round trip, isolation from the practice save, version and corruption handling.
import { describe, expect, it, vi } from 'vitest';
import {
  GUARD_SAVE_KEY,
  deleteGuardSave,
  hasGuardSave,
  readGuardSave,
  writeGuardSave,
  type GuardSaveData,
} from '../../src/logic/guardSave';
import { SAVE_KEY, createMemoryStorage, readSave, writeSave, type SaveData } from '../../src/logic/save';

function sampleGuard(): GuardSaveData {
  return {
    version: 1,
    difficulty: 'hard',
    characterId: 'pea_gunner',
    wave: 7,
    coreHealth: 4321,
    sun: 640,
    items: { medkit: 2, nut_wall_seed: 1 },
    magAmmo: 12,
    reserveAmmo: 90,
    upgrades: { damageBonus: 0.2, sunBonus: 0 },
    ownedEquipment: ['sun_boost'],
    potion: { itemId: 'power_potion', remainingSeconds: 17.5 },
    plants: [{ type: 'nut_wall', pos: [16, 0, 3], yaw: 0.5, health: 1200 }],
    playTimeSeconds: 845,
    savedAt: 99,
  };
}

function samplePractice(): SaveData {
  return {
    version: 1, characterId: 'sunflower', sun: 50, items: {}, magAmmo: 0, reserveAmmo: 0,
    upgrades: { damageBonus: 0, sunBonus: 0 }, ownedEquipment: [], plants: [], kills: 3, playTimeSeconds: 10,
    stats: { deaths: 0, sunEarned: 20, plantsPlanted: 0 }, tutorialDone: false, savedAt: 1,
  };
}

describe('guard save (FR11)', () => {
  it('round-trips every FR11.2 field under its own key', () => {
    const storage = createMemoryStorage();
    expect(writeGuardSave(storage, sampleGuard())).toEqual({ ok: true });
    expect(GUARD_SAVE_KEY).toBe('pvz3d.guard.save.v1');
    expect(storage.getItem(GUARD_SAVE_KEY)).not.toBeNull();
    const r = readGuardSave(storage);
    expect(r.status).toBe('ok');
    expect(r.data).toEqual(sampleGuard());
    expect(hasGuardSave(storage)).toBe(true);
  });

  it('never touches the practice save and vice versa (FR11.1)', () => {
    const storage = createMemoryStorage();
    writeSave(storage, samplePractice());
    writeGuardSave(storage, sampleGuard());
    expect(GUARD_SAVE_KEY).not.toBe(SAVE_KEY);
    expect(readSave(storage).data).toEqual(samplePractice());
    deleteGuardSave(storage);
    expect(readGuardSave(storage).status).toBe('none');
    expect(readSave(storage).data).toEqual(samplePractice());
  });

  it('reports an incompatible version without data', () => {
    const storage = createMemoryStorage();
    storage.setItem(GUARD_SAVE_KEY, JSON.stringify({ ...sampleGuard(), version: 2 }));
    expect(readGuardSave(storage)).toEqual({ status: 'incompatible', data: null, foundVersion: 2 });
    expect(hasGuardSave(storage)).toBe(false);
  });

  it('does not throw on corrupt JSON or a bad shape (unknown difficulty, wave 0)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createMemoryStorage();
    storage.setItem(GUARD_SAVE_KEY, '{not json');
    expect(() => readGuardSave(storage)).not.toThrow();
    expect(readGuardSave(storage).status).toBe('corrupt');
    storage.setItem(GUARD_SAVE_KEY, JSON.stringify({ ...sampleGuard(), difficulty: 'insane' }));
    expect(readGuardSave(storage).status).toBe('corrupt');
    storage.setItem(GUARD_SAVE_KEY, JSON.stringify({ ...sampleGuard(), wave: 0 }));
    expect(readGuardSave(storage).status).toBe('corrupt');
    warn.mockRestore();
  });

  it('surfaces a storage write failure instead of throwing', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = { ...createMemoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(writeGuardSave(storage, sampleGuard())).toEqual({ ok: false, error: 'QuotaExceededError' });
    err.mockRestore();
  });
});
