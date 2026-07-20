// 自機のシミュレーション。描画に依存しない純粋な演算 (2D 座標系)。
import {
  ENERGY_MAX,
  ENERGY_REGEN_PER_SEC,
  FIELD_SIZE,
  INVULN_MS,
  MAX_HP,
  PLAYER_SPEED,
  type Appearance,
  type StatePayload,
  type Vec2,
} from '../../../shared/src/protocol';
import {
  isBlocked,
  resolveObstacles,
  steerAroundObstacles,
} from '../../../shared/src/obstacles';

const BOUND = FIELD_SIZE / 2 - 1;
/** 障害物との衝突に使う自機の体半径 */
const BODY_RADIUS = 0.5;

/** 速度が目標速度へ追従する速さ (1/s)。小さいほど慣性が強く柔らかい動き */
const ACCEL_RATE = 8;
/** タップ移動の到着減速: 残距離×この係数まで速度を落とす */
const ARRIVE_GAIN = 4;
/** これ未満の速度は停止とみなす */
const STOP_EPS = 0.05;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class LocalPlayerSim {
  readonly pos: Vec2;
  heading = 0;
  hp = MAX_HP;
  /** この時刻まで無敵 (リスポーン直後) */
  invulnUntil = 0;
  /** 発射コスト用エネルギー (時間回復) */
  energy = ENERGY_MAX;

  private readonly vel: Vec2 = { x: 0, y: 0 };
  private seq = 0;
  private target: Vec2 | null = null;

  constructor(
    spawn: Vec2,
    private readonly name: string,
    private readonly appearance?: Appearance,
  ) {
    this.pos = { ...spawn };
  }

  /**
   * 被弾処理 (自己申告制: 判定は自分のクライアントだけが行う)。
   * @returns HP が尽きたか
   */
  takeHit(damage: number, now: number): boolean {
    if (now < this.invulnUntil) return false;
    this.hp = Math.max(0, this.hp - damage);
    return this.hp <= 0;
  }

  /** 指定地点で復活し、しばらく無敵になる */
  respawn(x: number, y: number, now: number): void {
    this.pos.x = clamp(x, -BOUND, BOUND);
    this.pos.y = clamp(y, -BOUND, BOUND);
    this.hp = MAX_HP;
    this.energy = ENERGY_MAX;
    this.invulnUntil = now + INVULN_MS;
    this.target = null;
  }

  /** 指定地点への自動移動を開始する (キー入力があると解除される) */
  setTarget(x: number, y: number): void {
    this.target = {
      x: clamp(x, -BOUND, BOUND),
      y: clamp(y, -BOUND, BOUND),
    };
  }

  /** エネルギーを消費する。足りなければ消費せず false を返す */
  trySpendEnergy(cost: number): boolean {
    if (this.energy < cost) return false;
    this.energy -= cost;
    return true;
  }

  /** 発射イベントへ固定保存するため、現在速度のコピーを返す。 */
  getVelocity(): Vec2 {
    return { ...this.vel };
  }

  /** @returns 位置または向きが変化したか */
  update(dt: number, move: Vec2): boolean {
    this.energy = Math.min(this.energy + ENERGY_REGEN_PER_SEC * dt, ENERGY_MAX);

    // 目標速度を決める (入力方向 or タップ地点への到着減速つき追従)
    let targetVx = 0;
    let targetVy = 0;
    if (move.x !== 0 || move.y !== 0) {
      this.target = null; // キー/スティック入力を優先し自動移動を解除
      targetVx = move.x * PLAYER_SPEED;
      targetVy = move.y * PLAYER_SPEED;
    } else if (this.target) {
      const dx = this.target.x - this.pos.x;
      const dy = this.target.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.15) {
        this.target = null;
      } else {
        // 到着間際は減速して行き過ぎ (目標地点の周回) を防ぐ
        const speed = Math.min(PLAYER_SPEED, d * ARRIVE_GAIN);
        // タップ移動も進路上の岩を接線方向へ避ける (正面での膠着防止)。
        // キー/スティックの手動操作には介入しない
        const dir = steerAroundObstacles(
          this.pos,
          { x: dx / d, y: dy / d },
          BODY_RADIUS,
          6,
          1,
        );
        targetVx = dir.x * speed;
        targetVy = dir.y * speed;
      }
    }

    // 慣性: 速度を目標速度へ指数的に追従させる。急な方向転換では
    // 速度ベクトルが徐々に回るため、軌跡が曲線を描く
    const k = Math.min(1, dt * ACCEL_RATE);
    this.vel.x += (targetVx - this.vel.x) * k;
    this.vel.y += (targetVy - this.vel.y) * k;

    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed < STOP_EPS) {
      this.vel.x = 0;
      this.vel.y = 0;
      return false;
    }
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -BOUND, BOUND);
    this.pos.y = clamp(this.pos.y + this.vel.y * dt, -BOUND, BOUND);
    if (
      resolveObstacles(this.pos, BODY_RADIUS) &&
      this.target &&
      isBlocked(this.target.x, this.target.y, BODY_RADIUS)
    ) {
      // 目標地点が障害物の中: 押し付け続けても到達しないため自動移動を解除
      this.target = null;
    }
    // 向きは実際の速度ベクトルから求める (旋回も滑らかになる)
    if (speed > 0.5) {
      this.heading = Math.atan2(this.vel.y, this.vel.x);
    }
    return true;
  }

  makeState(): StatePayload {
    return {
      n: this.name,
      seq: this.seq++,
      ts: Date.now(),
      hp: this.hp,
      ap: this.appearance,
      x: this.pos.x,
      y: this.pos.y,
      vx: this.vel.x,
      vy: this.vel.y,
      h: this.heading,
    };
  }
}
