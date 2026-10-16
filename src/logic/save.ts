// localStorage save game (FR-SAV-01..06). Storage is injected so tests use an in-memory map.

export const SAVE_KEY = 'pvz3d.save.v1';
export const SAVE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedPlant {
  type: string;
  pos: [number, number, number];
  yaw: number;
  health: number;
}

export interface SaveStats {
  deaths: number;
  sunEarned: number;
  plantsPlanted: number;
}

export interface SaveData {
  version: number;
  characterId: string;
  sun: number;
  items: Record<string, number>;
  magAmmo: number;
  reserveAmmo: number;
  upgrades: { damageBonus: number; sunBonus: number };
  ownedEquipment: string[];
  plants: SavedPlant[];
  kills: number;
  playTimeSeconds: number;
  stats: SaveStats;
  tutorialDone: boolean;
  savedAt: number;
}

export type ReadResult =
  | { status: 'ok'; data: SaveData }
  | { status: 'none'; data: null }
  | { status: 'corrupt'; data: null }
  | { status: 'incompatible'; data: null; foundVersion: unknown };

export type WriteResult = { ok: true } | { ok: false; error: string };

export function serializeSave(data: SaveData): string {
  return JSON.stringify({ ...data, version: SAVE_VERSION });
}

function isSaveShape(v: unknown): v is SaveData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.characterId === 'string' &&
    typeof o.sun === 'number' &&
    typeof o.items === 'object' && o.items !== null &&
    Array.isArray(o.plants) &&
    typeof o.kills === 'number' &&
    typeof o.playTimeSeconds === 'number'
  );
}

export function writeSave(storage: StorageLike, data: SaveData): WriteResult {
  try {
    storage.setItem(SAVE_KEY, serializeSave(data));
    return { ok: true };
  } catch (err) {
    // Quota exceeded / storage disabled: surface the error to the caller (UI shows a banner).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[save] 写入存档失败:', message);
    return { ok: false, error: message };
  }
}

export function readSave(storage: StorageLike): ReadResult {
  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch (err) {
    console.error('[save] 读取存档失败:', err);
    return { status: 'none', data: null };
  }
  if (text === null) return { status: 'none', data: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn('[save] 存档 JSON 损坏，忽略');
    return { status: 'corrupt', data: null };
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  if (version !== SAVE_VERSION) return { status: 'incompatible', data: null, foundVersion: version };
  if (!isSaveShape(parsed)) return { status: 'corrupt', data: null };
  return { status: 'ok', data: parsed };
}

export function deleteSave(storage: StorageLike): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch (err) {
    console.error('[save] 删除存档失败:', err);
  }
}

/** In-memory StorageLike (tests, and fallback when localStorage is unavailable). */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Returns window.localStorage when usable, otherwise an in-memory fallback. */
export function resolveBrowserStorage(): { storage: StorageLike; persistent: boolean } {
  try {
    const ls = globalThis.localStorage;
    const probe = '__pvz3d_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { storage: ls, persistent: true };
  } catch {
    console.warn('[save] localStorage 不可用，存档仅保存在内存中');
    return { storage: createMemoryStorage(), persistent: false };
  }
}
