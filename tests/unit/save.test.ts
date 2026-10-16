import { describe, expect, it } from 'vitest';
import {
  SAVE_KEY,
  createMemoryStorage,
  deleteSave,
  readSave,
  writeSave,
  type SaveData,
  type StorageLike,
} from '../../src/logic/save';

function sampleSave(): SaveData {
  return {
    version: 1,
    characterId: 'sunflower',
    sun: 245,
    items: { medkit: 1, nut_wall_seed: 2 },
    magAmmo: 0,
    reserveAmmo: 0,
    upgrades: { damageBonus: 0, sunBonus: 0.2 },
    ownedEquipment: ['sun_boost'],
    plants: [
      { type: 'pea_shooter_plant', pos: [10, 0, -4], yaw: 1.2, health: 300 },
      { type: 'pea_shooter_plant', pos: [-3.5, 0, 6.25], yaw: -0.4, health: 180 },
    ],
    kills: 7,
    playTimeSeconds: 321.5,
    stats: { deaths: 1, sunEarned: 900, plantsPlanted: 2 },
    tutorialDone: true,
    savedAt: 1234,
  };
}

describe('save (FR-SAV-01..06)', () => {
  it('round-trips every FR-SAV-02 field including plant positions (TC-SAV-01)', () => {
    const storage = createMemoryStorage();
    expect(writeSave(storage, sampleSave())).toEqual({ ok: true });
    const result = readSave(storage);
    expect(result.status).toBe('ok');
    expect(result.data).toEqual(sampleSave());
    expect(result.data!.plants.map((p) => p.pos)).toEqual([[10, 0, -4], [-3.5, 0, 6.25]]);
  });

  it('reports an incompatible version instead of loading it', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ ...sampleSave(), version: 99 }));
    const result = readSave(storage);
    expect(result.status).toBe('incompatible');
    expect(result.data).toBeNull();
  });

  it('does not throw on corrupt JSON and returns no data', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(() => readSave(storage)).not.toThrow();
    expect(readSave(storage).data).toBeNull();
    expect(readSave(createMemoryStorage()).status).toBe('none');
  });

  it('surfaces storage write failures and deletes saves', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
    };
    const res = writeSave(failing, sampleSave());
    expect(res.ok).toBe(false);
    const storage = createMemoryStorage();
    writeSave(storage, sampleSave());
    deleteSave(storage);
    expect(readSave(storage).status).toBe('none');
  });
});
