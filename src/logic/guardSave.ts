// Guard mode save game (FR11). Separate key from the practice save (pvz3d.save.v1) so the two modes
// never overwrite each other. Saved between waves: loading restarts the saved wave (its zombies are not saved).
// Pure: storage is injected (tests use createMemoryStorage from ./save).
import type { DifficultyId } from '../config/types';
import type { SavedPlant, StorageLike, WriteResult } from './save';

export const GUARD_SAVE_KEY = 'pvz3d.guard.save.v1';
export const GUARD_SAVE_VERSION = 1;

export interface SavedPotion {
  itemId: string;
  remainingSeconds: number;
}

export interface GuardSaveData {
  version: number;
  difficulty: DifficultyId;
  characterId: string;
  /** Wave (1-based) the player is on; a load restarts it from its countdown. */
  wave: number;
  coreHealth: number;
  sun: number;
  items: Record<string, number>;
  magAmmo: number;
  reserveAmmo: number;
  upgrades: { damageBonus: number; sunBonus: number };
  ownedEquipment: string[];
  potion: SavedPotion | null;
  plants: SavedPlant[];
  playTimeSeconds: number;
  savedAt: number;
}

export type GuardReadResult =
  | { status: 'ok'; data: GuardSaveData }
  | { status: 'none'; data: null }
  | { status: 'corrupt'; data: null }
  | { status: 'incompatible'; data: null; foundVersion: unknown };

const DIFFICULTIES = new Set<string>(['easy', 'standard', 'hard']);

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isGuardShape(v: unknown): v is GuardSaveData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const potionOk = o.potion === null || (typeof o.potion === 'object' && typeof (o.potion as Record<string, unknown>).itemId === 'string'
    && isNum((o.potion as Record<string, unknown>).remainingSeconds));
  return (
    DIFFICULTIES.has(String(o.difficulty)) &&
    typeof o.characterId === 'string' &&
    isNum(o.wave) && Number.isInteger(o.wave) && o.wave >= 1 &&
    isNum(o.coreHealth) && o.coreHealth > 0 &&
    isNum(o.sun) &&
    typeof o.items === 'object' && o.items !== null &&
    Array.isArray(o.plants) &&
    Array.isArray(o.ownedEquipment) &&
    typeof o.upgrades === 'object' && o.upgrades !== null &&
    potionOk
  );
}

export function writeGuardSave(storage: StorageLike, data: GuardSaveData): WriteResult {
  try {
    storage.setItem(GUARD_SAVE_KEY, JSON.stringify({ ...data, version: GUARD_SAVE_VERSION }));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[guardSave] 写入守卫模式存档失败:', message);
    return { ok: false, error: message };
  }
}

export function readGuardSave(storage: StorageLike): GuardReadResult {
  let text: string | null;
  try {
    text = storage.getItem(GUARD_SAVE_KEY);
  } catch (err) {
    console.error('[guardSave] 读取守卫模式存档失败:', err);
    return { status: 'none', data: null };
  }
  if (text === null) return { status: 'none', data: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn('[guardSave] 守卫模式存档 JSON 损坏，忽略');
    return { status: 'corrupt', data: null };
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  if (version !== GUARD_SAVE_VERSION) return { status: 'incompatible', data: null, foundVersion: version };
  if (!isGuardShape(parsed)) return { status: 'corrupt', data: null };
  return { status: 'ok', data: parsed };
}

/** FR11.4: after victory or「重新开始」. */
export function deleteGuardSave(storage: StorageLike): void {
  try {
    storage.removeItem(GUARD_SAVE_KEY);
  } catch (err) {
    console.error('[guardSave] 删除守卫模式存档失败:', err);
  }
}

export function hasGuardSave(storage: StorageLike): boolean {
  return readGuardSave(storage).status === 'ok';
}
