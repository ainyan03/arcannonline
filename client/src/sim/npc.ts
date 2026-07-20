import {
  FIELD_SIZE,
  NPC_MAX_HP,
  NPC_RESPAWN_MS,
  type NpcMode,
  type NpcStatePayload,
  type Vec2,
} from '../../../shared/src/protocol';
import { mulberry32 } from './danmaku/rng';

const NPC_SPEED = 3.6;
const NPC_BOUND = FIELD_SIZE / 2 - 4;
const CHASE_RANGE = 80;
const ATTACK_RANGE = 27;
const DESIRED_RANGE = 11;
/**
 * スナップショットの遅延再生量。送信間隔 (NPC_STATE_INTERVAL_MS=200ms) より
 * 長くしないと補間の挟み込みが成立せず、200ms ごとのステップ移動になる
 */
const INTERP_DELAY_MS = 280;
/** 未来側スナップショット未着時に速度で外挿する上限 */
const EXTRAPOLATE_MAX_MS = 200;

/**
 * プレイヤー弾が敵に当たる判定半径。見た目よりやや大きめにして、
 * リモートNPCの表示遅延 (補間280ms) や担当ピア側との位置ずれがあっても
 * 「狙って撃ったのにすり抜ける」体感を減らす
 */
export const NPC_HIT_RADIUS = 1.2;

export interface NpcTarget {
  id: string;
  pos: Vec2;
}

export interface NpcAttack {
  targetId: string;
  targetPos: Vec2;
}

/** ウェーブ制からの敵挙動の調整。省略時は基準挙動 (常時再出現・強さ1) */
export interface NpcWaveMod {
  /** 小休止フェーズ中は倒された敵が再出現しない */
  respawnPaused: boolean;
  /** 強さ (1 = 基準)。攻撃間隔が 1/n 倍、移動速度が緩やかに上がる */
  aggression: number;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v: number): number {
  return Math.min(Math.max(v, -NPC_BOUND), NPC_BOUND);
}

/** 担当クライアントだけが進める小型敵AI。 */
export class LocalNpcSim {
  readonly pos: Vec2 = { x: 0, y: 0 };
  readonly vel: Vec2 = { x: 0, y: 0 };
  heading = 0;
  hp = NPC_MAX_HP;
  mode: NpcMode = 'spawn';

  private readonly random: () => number;
  private readonly orbitSign: number;
  private waypoint: Vec2 = { x: 0, y: 0 };
  private seq = 0;
  private respawnAt = 0;
  private spawnUntil = 0;
  private nextAttackAt = 0;

  constructor(
    readonly id: string,
    now: number,
  ) {
    this.random = mulberry32(hashString(id));
    this.orbitSign = this.random() < 0.5 ? -1 : 1;
    this.spawn(now);
  }

  get alive(): boolean {
    return this.mode !== 'dead';
  }

  update(
    dt: number,
    now: number,
    targets: readonly NpcTarget[],
    wave?: NpcWaveMod,
  ): NpcAttack | null {
    if (!this.alive) {
      if (!wave?.respawnPaused && now >= this.respawnAt) this.spawn(now);
      return null;
    }
    if (now < this.spawnUntil) {
      this.mode = 'spawn';
      this.vel.x = 0;
      this.vel.y = 0;
      return null;
    }

    let nearest: NpcTarget | null = null;
    let nearestDist = Infinity;
    for (const target of targets) {
      const d = Math.hypot(target.pos.x - this.pos.x, target.pos.y - this.pos.y);
      if (d < nearestDist) {
        nearest = target;
        nearestDist = d;
      }
    }

    let dx: number;
    let dy: number;
    if (nearest && nearestDist <= CHASE_RANGE) {
      this.mode = nearestDist <= ATTACK_RANGE ? 'attack' : 'chase';
      const tx = nearest.pos.x - this.pos.x;
      const ty = nearest.pos.y - this.pos.y;
      const inv = nearestDist > 0.001 ? 1 / nearestDist : 0;
      if (nearestDist > DESIRED_RANGE + 2) {
        dx = tx * inv;
        dy = ty * inv;
      } else {
        // 近距離では周回し、静止した射撃台にならないようにする。
        dx = -ty * inv * this.orbitSign;
        dy = tx * inv * this.orbitSign;
      }
    } else {
      this.mode = 'wander';
      dx = this.waypoint.x - this.pos.x;
      dy = this.waypoint.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) {
        this.pickWaypoint();
        dx = this.waypoint.x - this.pos.x;
        dy = this.waypoint.y - this.pos.y;
      }
      const inv = Math.hypot(dx, dy);
      if (inv > 0.001) {
        dx /= inv;
        dy /= inv;
      }
    }

    const aggression = wave?.aggression ?? 1;
    // 速度は攻撃頻度ほど尖らせない (最終波でも +40% 程度に収める)
    const speedMul = 1 + (aggression - 1) * 0.4;
    const desiredSpeed =
      (this.mode === 'attack' ? NPC_SPEED * 0.7 : NPC_SPEED) * speedMul;
    const k = Math.min(1, dt * 4);
    this.vel.x += (dx * desiredSpeed - this.vel.x) * k;
    this.vel.y += (dy * desiredSpeed - this.vel.y) * k;
    this.pos.x = clamp(this.pos.x + this.vel.x * dt);
    this.pos.y = clamp(this.pos.y + this.vel.y * dt);
    if (Math.hypot(this.vel.x, this.vel.y) > 0.1) {
      this.heading = Math.atan2(this.vel.y, this.vel.x);
    }

    if (nearest && nearestDist <= ATTACK_RANGE && now >= this.nextAttackAt) {
      this.nextAttackAt = now + (2_400 + this.random() * 1_200) / aggression;
      return {
        targetId: nearest.id,
        targetPos: { x: nearest.pos.x, y: nearest.pos.y },
      };
    }
    return null;
  }

  /** @returns 今回のダメージで撃破されたか */
  takeHit(damage: number, now: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - Math.max(damage, 0));
    if (this.hp > 0) return false;
    this.mode = 'dead';
    this.vel.x = 0;
    this.vel.y = 0;
    this.respawnAt = now + NPC_RESPAWN_MS;
    return true;
  }

  makeState(): NpcStatePayload {
    return {
      id: this.id,
      seq: this.seq++,
      x: this.pos.x,
      y: this.pos.y,
      vx: this.vel.x,
      vy: this.vel.y,
      h: this.heading,
      hp: this.hp,
      mode: this.mode,
      ts: Date.now(),
    };
  }

  private spawn(now: number): void {
    const angle = this.random() * Math.PI * 2;
    const radius = 14 + this.random() * 20;
    this.pos.x = Math.cos(angle) * radius;
    this.pos.y = Math.sin(angle) * radius;
    this.vel.x = 0;
    this.vel.y = 0;
    this.hp = NPC_MAX_HP;
    this.mode = 'spawn';
    this.spawnUntil = now + 900;
    this.nextAttackAt = now + 1_800 + this.random() * 1_200;
    this.pickWaypoint();
  }

  private pickWaypoint(): void {
    const angle = this.random() * Math.PI * 2;
    const radius = 12 + this.random() * 72;
    this.waypoint = {
      x: clamp(Math.cos(angle) * radius),
      y: clamp(Math.sin(angle) * radius),
    };
  }
}

interface NpcSnapshot {
  t: number;
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
}

export interface RemoteNpcSample {
  x: number;
  y: number;
  h: number;
  visible: boolean;
}

/** 他ピアが担当するNPCの非順序スナップショット補間。 */
export class RemoteNpcSim {
  lastSeenAt: number;
  lastX = 0;
  lastY = 0;
  hp = NPC_MAX_HP;
  mode: NpcMode = 'spawn';

  private lastSeq = -1;
  private readonly buf: NpcSnapshot[] = [];
  private readonly sampleTmp: RemoteNpcSample = { x: 0, y: 0, h: 0, visible: false };

  constructor(
    readonly id: string,
    now: number,
  ) {
    this.lastSeenAt = now;
  }

  push(state: NpcStatePayload, now: number): void {
    this.lastSeenAt = now;
    if (state.seq <= this.lastSeq) return;
    this.lastSeq = state.seq;
    if (this.mode === 'dead' && state.mode !== 'dead') this.buf.length = 0;
    this.hp = state.hp;
    this.mode = state.mode;
    this.lastX = state.x;
    this.lastY = state.y;
    this.buf.push({
      t: now,
      x: state.x,
      y: state.y,
      h: state.h,
      vx: state.vx,
      vy: state.vy,
    });
    if (this.buf.length > 20) this.buf.shift();
  }

  sample(now: number): RemoteNpcSample {
    const out = this.sampleTmp;
    const renderTime = now - INTERP_DELAY_MS;
    while (this.buf.length >= 2 && this.buf[1].t <= renderTime) this.buf.shift();
    if (this.buf.length === 0) {
      out.visible = false;
      return out;
    }
    const a = this.buf[0];
    out.visible = this.mode !== 'dead';
    if (this.buf.length === 1) {
      // 未来側のスナップショットが届くまでは速度で短時間だけ外挿し、
      // 5Hz の受信間隔でも停止して見えないようにする
      const dt =
        Math.min(Math.max(renderTime - a.t, 0), EXTRAPOLATE_MAX_MS) / 1000;
      out.x = a.x + a.vx * dt;
      out.y = a.y + a.vy * dt;
      out.h = a.h;
      return out;
    }
    const b = this.buf[1];
    const span = Math.max(b.t - a.t, 1);
    const k = Math.min(Math.max((renderTime - a.t) / span, 0), 1);
    // Hermite 補間: スナップショットの速度も拘束に使い、5Hz でも旋回や
    // 加減速が曲線として滑らかに再現されるようにする
    const s = span / 1000;
    const k2 = k * k;
    const k3 = k2 * k;
    const h00 = 2 * k3 - 3 * k2 + 1;
    const h10 = k3 - 2 * k2 + k;
    const h01 = -2 * k3 + 3 * k2;
    const h11 = k3 - k2;
    out.x = h00 * a.x + h10 * s * a.vx + h01 * b.x + h11 * s * b.vx;
    out.y = h00 * a.y + h10 * s * a.vy + h01 * b.y + h11 * s * b.vy;
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    out.h = a.h + dh * k;
    return out;
  }
}
