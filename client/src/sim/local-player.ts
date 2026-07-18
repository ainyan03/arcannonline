// 自機のシミュレーション。描画に依存しない純粋な演算 (2D 座標系)。
import {
  FIELD_SIZE,
  PLAYER_SPEED,
  type StatePayload,
  type Vec2,
} from '../../../shared/src/protocol';

const BOUND = FIELD_SIZE / 2 - 1;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class LocalPlayerSim {
  readonly pos: Vec2;
  heading = 0;

  private readonly vel: Vec2 = { x: 0, y: 0 };
  private seq = 0;

  constructor(
    spawn: Vec2,
    private readonly name: string,
  ) {
    this.pos = { ...spawn };
  }

  /** @returns 位置または向きが変化したか */
  update(dt: number, move: Vec2): boolean {
    this.vel.x = move.x * PLAYER_SPEED;
    this.vel.y = move.y * PLAYER_SPEED;
    if (move.x === 0 && move.y === 0) return false;
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -BOUND, BOUND);
    this.pos.y = clamp(this.pos.y + this.vel.y * dt, -BOUND, BOUND);
    this.heading = Math.atan2(move.y, move.x);
    return true;
  }

  makeState(): StatePayload {
    return {
      n: this.name,
      seq: this.seq++,
      x: this.pos.x,
      y: this.pos.y,
      vx: this.vel.x,
      vy: this.vel.y,
      h: this.heading,
    };
  }
}
