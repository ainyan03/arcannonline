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
  private target: Vec2 | null = null;

  constructor(
    spawn: Vec2,
    private readonly name: string,
  ) {
    this.pos = { ...spawn };
  }

  /** 指定地点への自動移動を開始する (キー入力があると解除される) */
  setTarget(x: number, y: number): void {
    this.target = {
      x: clamp(x, -BOUND, BOUND),
      y: clamp(y, -BOUND, BOUND),
    };
  }

  /** @returns 位置または向きが変化したか */
  update(dt: number, move: Vec2): boolean {
    let mx = move.x;
    let my = move.y;
    if (mx !== 0 || my !== 0) {
      this.target = null; // キー入力を優先し自動移動を解除
    } else if (this.target) {
      const dx = this.target.x - this.pos.x;
      const dy = this.target.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.3) {
        this.target = null;
      } else {
        mx = dx / d;
        my = dy / d;
      }
    }
    this.vel.x = mx * PLAYER_SPEED;
    this.vel.y = my * PLAYER_SPEED;
    if (mx === 0 && my === 0) return false;
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -BOUND, BOUND);
    this.pos.y = clamp(this.pos.y + this.vel.y * dt, -BOUND, BOUND);
    this.heading = Math.atan2(my, mx);
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
