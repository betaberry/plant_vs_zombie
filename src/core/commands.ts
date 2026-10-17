// Single entry point for world-state mutations (AR-01): every change goes through dispatch().
import type { DamageInfo, DamageResult, IAttackable } from '../logic/attackable';
import type { Vec3Like } from './events';

export type GameCommand =
  | { type: 'damage'; target: IAttackable; amount: number; info: DamageInfo }
  /** guardWave: guard mode wave spawn (difficulty health scaling, boss flag); jitter: spawn offset override. */
  | { type: 'spawn'; spawnerId: string | null; pos: Vec3Like; ambush: boolean; patrolRoute?: string; zombieType?: string; guardWave?: { boss: boolean }; jitter?: number }
  | { type: 'plant'; plantType: string; pos: Vec3Like; yaw: number }
  | { type: 'shovel'; plantId: string }
  | { type: 'pickup'; pickupId: string }
  | { type: 'purchase'; itemId: string }
  | { type: 'useItem'; itemId: string };

export interface CommandResults {
  damage: DamageResult;
  spawn: boolean;
  plant: { ok: boolean; reason?: string };
  shovel: boolean;
  pickup: boolean;
  purchase: { ok: boolean; reason?: string };
  useItem: boolean;
}

type CommandOf<T extends GameCommand['type']> = Extract<GameCommand, { type: T }>;
type Handler<T extends GameCommand['type']> = (cmd: CommandOf<T>) => CommandResults[T];

export class CommandBus {
  private handlers: { [K in GameCommand['type']]?: Handler<K> } = {};
  /** Recent commands, for the debug panel. */
  readonly recent: string[] = [];

  register<T extends GameCommand['type']>(type: T, handler: Handler<T>): void {
    (this.handlers as Record<string, unknown>)[type] = handler;
  }

  dispatch<T extends GameCommand['type']>(cmd: CommandOf<T>): CommandResults[T] {
    const handler = this.handlers[cmd.type as T] as Handler<T> | undefined;
    if (!handler) throw new Error(`no handler registered for command "${cmd.type}"`);
    if (cmd.type !== 'damage') {
      this.recent.push(cmd.type);
      if (this.recent.length > 8) this.recent.shift();
    }
    return handler(cmd);
  }
}
