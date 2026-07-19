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
const INTERP_DELAY_MS = 140;

export const NPC_HIT_RADIUS = 0.72;

export interface NpcTarget {
  id: string;
  pos: Vec2;
}

export interface NpcAttack {
  targetId: string;
  targetPos: Vec2;
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

  update(dt: number, now: number, targets: readonly NpcTarget[]): NpcAttack | null {
    if (!this.alive) {
      if (now >= this.respawnAt) this.spawn(now);
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

    const desiredSpeed = this.mode === 'attack' ? NPC_SPEED * 0.7 : NPC_SPEED;
    const k = Math.min(1, dt * 4);
    this.vel.x += (dx * desiredSpeed - this.vel.x) * k;
    this.vel.y += (dy * desiredSpeed - this.vel.y) * k;
    this.pos.x = clamp(this.pos.x + this.vel.x * dt);
    this.pos.y = clamp(this.pos.y + this.vel.y * dt);
    if (Math.hypot(this.vel.x, this.vel.y) > 0.1) {
      this.heading = Math.atan2(this.vel.y, this.vel.x);
    }

    if (nearest && nearestDist <= ATTACK_RANGE && now >= this.nextAttackAt) {
      this.nextAttackAt = now + 2_400 + this.random() * 1_200;
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
    this.buf.push({ t: now, x: state.x, y: state.y, h: state.h });
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
      out.x = a.x;
      out.y = a.y;
      out.h = a.h;
      return out;
    }
    const b = this.buf[1];
    const k = Math.min(Math.max((renderTime - a.t) / Math.max(b.t - a.t, 1), 0), 1);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    out.h = a.h + dh * k;
    return out;
  }
}
