// 自機のシミュレーション。描画に依存しない純粋な演算 (2D 座標系)。
import {
  ENERGY_MAX,
  ENERGY_REGEN_PER_SEC,
  FIELD_SIZE,
  INVULN_MS,
  MAX_HP,
  PLAYER_SPEED,
  TRAIL_BOOST_MUL,
  type Appearance,
  type StatePayload,
  type Vec2,
} from '../../../shared/src/protocol';
import {
  isBlocked,
  resolveObstacles,
  steerAroundObstacles,
} from '../../../shared/src/obstacles';
import {
  classMovementFor,
  type ClassMovement,
} from '../../../shared/src/player-classes';

const BOUND = FIELD_SIZE / 2 - 1;
/** 障害物との衝突に使う自機の体半径 */
const BODY_RADIUS = 0.5;

/** タップ移動の到着減速: 残距離×この係数まで速度を落とす */
const ARRIVE_GAIN = 4;
/** これ未満の速度は停止とみなす (巡航クラスは停止しないので使わない) */
const STOP_EPS = 0.05;
/** 巡航クラスがタップ目標を「通過した」とみなす距離 (減速せず通り抜ける) */
const FLYBY_DIST = 2;

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
  /** クラス別の移動特性 (見た目プリセットから決まる) */
  private readonly movement: ClassMovement;
  /** 一時的な移動速度ブーストの残り時間 (秒)。スターダストトレイル用 */
  private boostLeft = 0;

  constructor(
    spawn: Vec2,
    private readonly name: string,
    private readonly appearance?: Appearance,
  ) {
    this.pos = { ...spawn };
    this.movement = classMovementFor(appearance?.s);
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

  /** 指定秒数のあいだ移動速度を TRAIL_BOOST_MUL 倍にする */
  boost(durationSec: number): void {
    this.boostLeft = Math.max(this.boostLeft, durationSec);
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

    const boostMul = this.boostLeft > 0 ? TRAIL_BOOST_MUL : 1;
    this.boostLeft = Math.max(0, this.boostLeft - dt);
    const maxSpeed = PLAYER_SPEED * this.movement.speedMul * boostMul;
    const cruiseSpeed = PLAYER_SPEED * this.movement.cruiseMul * boostMul;

    // 目標速度を決める (入力方向 or タップ地点への到着減速つき追従)
    let targetVx = 0;
    let targetVy = 0;
    if (move.x !== 0 || move.y !== 0) {
      this.target = null; // キー/スティック入力を優先し自動移動を解除
      targetVx = move.x * maxSpeed;
      targetVy = move.y * maxSpeed;
    } else if (this.target) {
      const dx = this.target.x - this.pos.x;
      const dy = this.target.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      // 巡航クラスは目標地点で止まれないため「通過」で解除する (フライバイ)
      if (d < (cruiseSpeed > 0 ? FLYBY_DIST : 0.15)) {
        this.target = null;
      } else {
        // 到着間際は減速して行き過ぎを防ぐ (巡航クラスは減速せず通過する)
        const speed =
          cruiseSpeed > 0 ? maxSpeed : Math.min(maxSpeed, d * ARRIVE_GAIN);
        // タップ移動も進路上の岩を接線方向へ避ける (正面での膠着防止)。
        // 目標地点より奥の岩は無視し、キー/スティックの手動操作には介入しない
        const dir = steerAroundObstacles(
          this.pos,
          { x: dx / d, y: dy / d },
          BODY_RADIUS,
          6,
          1,
          d,
        );
        targetVx = dir.x * speed;
        targetVy = dir.y * speed;
      }
    }

    // 巡航クラス: 入力も目標もない時は現在の向きへ飛び続ける。
    // 進路上の岩は自動で避ける (止まれないクラスが岩を擦り続けないように)
    if (cruiseSpeed > 0 && targetVx === 0 && targetVy === 0) {
      const dir = steerAroundObstacles(
        this.pos,
        { x: Math.cos(this.heading), y: Math.sin(this.heading) },
        BODY_RADIUS,
        8,
        1,
      );
      targetVx = dir.x * cruiseSpeed;
      targetVy = dir.y * cruiseSpeed;
    }

    // 慣性: 速度を目標速度へ指数的に追従させる。急な方向転換では
    // 速度ベクトルが徐々に回るため、軌跡が曲線を描く
    const k = Math.min(1, dt * this.movement.accelRate);
    this.vel.x += (targetVx - this.vel.x) * k;
    this.vel.y += (targetVy - this.vel.y) * k;

    // 巡航クラスは最低速度を割らない (減速はできるが完全停止はしない)
    if (cruiseSpeed > 0) {
      const sp = Math.hypot(this.vel.x, this.vel.y);
      if (sp < cruiseSpeed) {
        if (sp > 0.01) {
          const scale = cruiseSpeed / sp;
          this.vel.x *= scale;
          this.vel.y *= scale;
        } else {
          this.vel.x = Math.cos(this.heading) * cruiseSpeed;
          this.vel.y = Math.sin(this.heading) * cruiseSpeed;
        }
      }
    }

    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (cruiseSpeed === 0 && speed < STOP_EPS) {
      this.vel.x = 0;
      this.vel.y = 0;
      return false;
    }
    const nextX = this.pos.x + this.vel.x * dt;
    const nextY = this.pos.y + this.vel.y * dt;
    this.pos.x = clamp(nextX, -BOUND, BOUND);
    this.pos.y = clamp(nextY, -BOUND, BOUND);
    if (cruiseSpeed > 0) {
      // 止まれないクラスが外周へ正面衝突したまま永久停止しないよう反射する
      if (this.pos.x !== nextX) this.vel.x = -this.vel.x;
      if (this.pos.y !== nextY) this.vel.y = -this.vel.y;
    }
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
